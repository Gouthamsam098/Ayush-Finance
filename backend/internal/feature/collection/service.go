package collection

import (
	"context"
	"log/slog"
	"strconv"
	"time"

	"github.com/anush-capitals/lms-backend/internal/audit"
	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/anush-capitals/lms-backend/internal/feature/loan"
	"github.com/anush-capitals/lms-backend/internal/logger"
	"github.com/jackc/pgx/v5"
)

const (
	defaultFeedLimit = 100
	maxFeedLimit     = 500
)

// Clock returns the current time; injected so date validation is testable.
type Clock func() time.Time

// LoanGateway is the slice of the loan repository this feature needs: fetch a
// loan to validate a payment against it, and flip its status for auto-close /
// auto-reopen when its balance crosses zero. Declared as an interface so the
// dependency is explicit and the service stays testable.
type LoanGateway interface {
	FindByID(ctx context.Context, id int64) (*domain.Loan, error)
	SetStatus(ctx context.Context, id int64, status domain.LoanStatus) (*domain.Loan, error)
	// SetStatusTx is the transactional variant, used so a payment and the
	// loan-status change it causes commit atomically.
	SetStatusTx(ctx context.Context, tx pgx.Tx, id int64, status domain.LoanStatus) (*domain.Loan, error)
}

// Auditor records the money trail. Optional (nil-safe) so the service can be
// constructed in tests without a database.
type Auditor interface {
	RecordTx(ctx context.Context, tx pgx.Tx, e audit.Entry) error
}

// UserLoader resolves the posting user, to attribute a payment to them.
type UserLoader func(ctx context.Context, id int64) (*domain.User, error)

// Service holds collection business logic: validation against the parent loan,
// status gating, and the (soft) overpayment signal.
type Service struct {
	repo   *Repository
	loans  LoanGateway
	now    Clock
	audits Auditor
	users  UserLoader
}

func NewService(repo *Repository, loans *loan.Repository, audits Auditor, users UserLoader) *Service {
	return &Service{repo: repo, loans: loans, now: time.Now, audits: audits, users: users}
}

// maxRemarkRunes mirrors the collection remark limit (domain validation).
const maxRemarkRunes = 300

// fitRemark joins a remark and its suffix, trimming the remark so the result
// always passes the 300-character limit (an over-long agent note must never
// make an approval impossible).
func fitRemark(base, suffix string) string {
	room := maxRemarkRunes - len([]rune(suffix))
	if r := []rune(base); len(r) > room {
		base = string(r[:room])
	}
	return base + suffix
}

// originalCollector returns the collector shared by every receipt being
// replaced, or nil when they are mixed, unattributed or not on this loan (the
// edit is then credited to the editor, as before).
func (s *Service) originalCollector(ctx context.Context, loanID int64, ids []int64) *domain.Collector {
	var kept *domain.Collector
	for _, id := range ids {
		c, err := s.repo.FindByID(ctx, id)
		if err != nil || c.LoanID != loanID || c.CollectorType == nil {
			return nil
		}
		name := ""
		if c.CollectorName != nil {
			name = *c.CollectorName
		}
		cur := &domain.Collector{Type: domain.CollectorType(*c.CollectorType), Name: name, UserID: c.CollectorUserID}
		if kept == nil {
			kept = cur
			continue
		}
		sameUser := (kept.UserID == nil && cur.UserID == nil) ||
			(kept.UserID != nil && cur.UserID != nil && *kept.UserID == *cur.UserID)
		if kept.Type != cur.Type || kept.Name != cur.Name || !sameUser {
			return nil
		}
	}
	return kept
}

// staffCollector attributes a directly-entered payment to the staff user who
// posted it. Best-effort: an unresolvable user leaves the payment unattributed
// rather than failing it.
func (s *Service) staffCollector(ctx context.Context, postedBy *int64) *domain.Collector {
	if postedBy == nil || s.users == nil {
		return nil
	}
	u, err := s.users(ctx, *postedBy)
	if err != nil {
		return nil
	}
	return domain.StaffCollector(u)
}

// logger returns the request-scoped logger (carrying request_id) so a money
// inconsistency can be traced back to the exact request that caused it. Falls
// back to the default logger outside an HTTP request.
func (s *Service) logger(ctx context.Context) *slog.Logger {
	return logger.FromContext(ctx)
}

// syncLoanStatus auto-closes a loan whose balance has reached zero, or reopens a
// CLOSED loan whose balance has re-appeared (e.g. a settlement payment was
// edited down or deleted). Called after every collection mutation so the loan's
// status always reflects its real outstanding.
//
// Failure here is deliberately non-fatal to the collection write — the payment
// is already persisted and must not be lost — but it is NOT silent: a failed
// sync leaves the loan's status disagreeing with its real balance (e.g. a
// settled loan still ACTIVE), which is a money-reporting inconsistency someone
// has to notice. Every failure path is logged with the loan id.
//
// KNOWN LIMITATION (documented, not yet fixed): the read-then-write here is not
// serialised against a concurrent payment on the same loan, because the feature
// layer has no transaction plumbing. Two simultaneous settlements can both read
// a pre-settlement balance and reach inconsistent conclusions. Fixing it
// properly requires threading a pgx.Tx through the collection and loan
// repositories and taking `SELECT ... FOR UPDATE` on the loans row — see
// DEPLOYMENT.md's outstanding-risks table.
func (s *Service) syncLoanStatus(ctx context.Context, loanID int64) {
	l, err := s.loans.FindByID(ctx, loanID)
	if err != nil {
		s.logger(ctx).Warn("loan status sync skipped: loan lookup failed",
			"loan_id", loanID, "error", err)
		return
	}
	collected, err := s.repo.SumByLoan(ctx, loanID)
	if err != nil {
		s.logger(ctx).Warn("loan status sync skipped: collected sum failed",
			"loan_id", loanID, "error", err)
		return
	}
	// Status-independent, so a CLOSED loan whose payments were deleted or edited
	// down is seen to have a balance again and reopens. IsFullyPaid() reads the
	// status through Outstanding(), which returns 0 for a CLOSED interest-only or
	// EMI loan — that made the reopen branch below unreachable for every type
	// except DAILY_COLLECTION.
	fullyPaid := l.HasNoBalanceIgnoringStatus(collected, s.now())
	switch {
	case fullyPaid && l.Status == domain.StatusActive:
		if _, err := s.loans.SetStatus(ctx, loanID, domain.StatusClosed); err != nil {
			s.logger(ctx).Error("loan is fully paid but auto-close FAILED — status now disagrees with balance",
				"loan_id", loanID, "error", err)
		}
	case !fullyPaid && l.Status == domain.StatusClosed:
		if _, err := s.loans.SetStatus(ctx, loanID, domain.StatusActive); err != nil {
			s.logger(ctx).Error("loan has a balance again but auto-reopen FAILED — status now disagrees with balance",
				"loan_id", loanID, "error", err)
		}
	}
}

// Record validates and persists a payment against a loan. The loan must exist
// and be ACTIVE. Overpayment is allowed (early settlement / advance) — the UI
// warns; the server does not block. postedBy is the authenticated operator.
//
// The whole operation runs in ONE transaction that starts by taking a row lock
// on the loan, which fixes two defects at once:
//
//   - Atomicity: the payment insert and the resulting auto-close/auto-reopen
//     commit together. Previously the insert could succeed and the status update
//     fail, leaving a settled loan marked ACTIVE with no error surfaced.
//   - Serialisation: two concurrent payments on the same loan can no longer both
//     read a pre-payment balance and reach inconsistent conclusions; the second
//     waits for the first to commit and then sees its money.
//
// idempotencyKey (optional, from the Idempotency-Key header) makes a retry safe:
// replaying the same key returns the payment that was already recorded instead
// of creating a second one.
func (s *Service) Record(ctx context.Context, in domain.CollectionInput, postedBy *int64, idempotencyKey string) (*domain.Collection, error) {
	// Resolve who posted it BEFORE opening the transaction: the lookup needs its
	// own pool connection, and taking one while holding the tx (and the loan
	// lock) can starve the pool under concurrent payments.
	collector := s.staffCollector(ctx, postedBy)
	tx, err := s.repo.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	// Rollback is a no-op once the tx has been committed, so this is safe to
	// defer unconditionally and guarantees no connection is leaked on any path.
	defer func() { _ = tx.Rollback(ctx) }()

	// Lock FIRST: everything read below must not change under us.
	if err := LockLoanForUpdate(ctx, tx, in.LoanID); err != nil {
		return nil, err
	}

	l, err := s.loans.FindByID(ctx, in.LoanID)
	if err != nil {
		return nil, err
	}
	if l.Status != domain.StatusActive {
		return nil, domain.NewConflict("Cannot record a payment on a closed loan")
	}
	// The collected-so-far split feeds the date rule: a payment may be dated
	// through the loan's NEXT scheduled due slot (daily → tomorrow, monthly →
	// next cycle date), which is derived from what has already been paid.
	collected, err := s.repo.SumByLoanTx(ctx, tx, in.LoanID)
	if err != nil {
		return nil, err
	}
	if err := in.Validate(l, collected, s.now()); err != nil {
		return nil, err
	}
	c, inserted, err := s.repo.CreateTx(ctx, tx, in, postedBy, idempotencyKey, collector)
	if err != nil {
		return nil, err
	}
	if !inserted {
		// Replay of an already-recorded payment: nothing changed, so do NOT
		// re-run the status sync or write another audit row (that would imply
		// several payments where only one exists). Return the original as-is.
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return c, nil
	}

	// Recompute inside the same transaction so the status reflects this payment.
	after, err := s.repo.SumByLoanTx(ctx, tx, in.LoanID)
	if err != nil {
		return nil, err
	}
	if l.IsFullyPaid(after, s.now()) && l.Status == domain.StatusActive {
		if _, err := s.loans.SetStatusTx(ctx, tx, in.LoanID, domain.StatusClosed); err != nil {
			return nil, err // roll back the payment too rather than desync
		}
	}

	// Audit inside the transaction: a recorded payment and its trail entry commit
	// together, so the ledger can never contain money with no record of who put
	// it there. Only non-sensitive fields are stored.
	if s.audits != nil {
		if err := s.audits.RecordTx(ctx, tx, audit.Entry{
			EntityType: audit.EntityCollection,
			EntityID:   c.ID,
			Action:     audit.ActionPost,
			After: map[string]any{
				"receipt_no": c.ReceiptNo,
				"loan_id":    c.LoanID,
				"amount":     c.Amount.Rupees(),
				"date":       c.Date.Format("2006-01-02"),
				"mode":       string(c.Mode),
				"kind":       string(c.Kind),
			},
		}); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return c, nil
}

// Replace atomically swaps a set of a loan's payments for a new set: it soft-
// deletes `replaceIDs` and inserts `inputs`, all inside ONE transaction.
//
// It exists because the ledger's receipt-day edit rewrites a whole day's
// payments. Doing that as N separate HTTP calls has no atomicity: a dropped
// connection between the deletes and the inserts either destroys the day's
// money or leaves it double-counted. Here the loan row is locked once and the
// whole swap commits or rolls back as a unit — the ledger can never be observed
// mid-edit.
//
// Every input is validated against the loan; a failure anywhere aborts the lot.
func (s *Service) Replace(
	ctx context.Context, loanID int64, replaceIDs []int64,
	inputs []domain.CollectionInput, postedBy *int64,
) ([]*domain.Collection, error) {
	// Both attribution lookups run BEFORE the transaction (they use their own
	// pool connections). An edit rewrites the SAME money, so it keeps who
	// received it: a receipt a recovery agent collected (or a customer paid)
	// stays credited to them in Reports, not to the staff member correcting it.
	collector := s.staffCollector(ctx, postedBy)
	if kept := s.originalCollector(ctx, loanID, replaceIDs); kept != nil {
		collector = kept
	}
	tx, err := s.repo.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Lock FIRST — the reads and the status sync below must not race another
	// payment on the same loan.
	if err := LockLoanForUpdate(ctx, tx, loanID); err != nil {
		return nil, err
	}
	l, err := s.loans.FindByID(ctx, loanID)
	if err != nil {
		return nil, err
	}
	if l.Status != domain.StatusActive {
		return nil, domain.NewConflict("Cannot edit payments on a closed loan")
	}

	// Retire the originals first WITHIN the transaction, so the validation below
	// sees the schedule as it will actually be once they are gone. Nothing is
	// visible to anyone else until commit, so ordering here is safe.
	for _, id := range replaceIDs {
		if err := s.repo.SoftDeleteTx(ctx, tx, loanID, id); err != nil {
			return nil, err
		}
	}

	out := make([]*domain.Collection, 0, len(inputs))
	for _, in := range inputs {
		in.LoanID = loanID
		collected, err := s.repo.SumByLoanTx(ctx, tx, loanID)
		if err != nil {
			return nil, err
		}
		if err := in.Validate(l, collected, s.now()); err != nil {
			return nil, err
		}
		c, _, err := s.repo.CreateTx(ctx, tx, in, postedBy, "", collector)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}

	// Status sync inside the same transaction, exactly as Record does.
	after, err := s.repo.SumByLoanTx(ctx, tx, loanID)
	if err != nil {
		return nil, err
	}
	if l.IsFullyPaid(after, s.now()) && l.Status == domain.StatusActive {
		if _, err := s.loans.SetStatusTx(ctx, tx, loanID, domain.StatusClosed); err != nil {
			return nil, err
		}
	}

	// One audit row per written payment, committed with the money itself.
	if s.audits != nil {
		for _, c := range out {
			if err := s.audits.RecordTx(ctx, tx, audit.Entry{
				EntityType: audit.EntityCollection,
				EntityID:   c.ID,
				Action:     audit.ActionPost,
				After: map[string]any{
					"receipt_no": c.ReceiptNo,
					"loan_id":    c.LoanID,
					"amount":     c.Amount.Rupees(),
					"date":       c.Date.Format("2006-01-02"),
					"mode":       string(c.Mode),
					"kind":       string(c.Kind),
					"replaced":   replaceIDs,
				},
			}); err != nil {
				return nil, err
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}

// ListByLoan returns the payment ledger for a loan (validates the loan exists).
func (s *Service) ListByLoan(ctx context.Context, loanID int64) ([]*domain.Collection, error) {
	if _, err := s.loans.FindByID(ctx, loanID); err != nil {
		return nil, err
	}
	return s.repo.ListByLoan(ctx, loanID)
}

// Feed returns payments recorded on a calendar day (or the latest overall when
// date is empty) across all loans.
func (s *Service) Feed(ctx context.Context, date string, limit int) ([]*domain.Collection, error) {
	if limit <= 0 {
		limit = defaultFeedLimit
	}
	if limit > maxFeedLimit {
		limit = maxFeedLimit
	}
	return s.repo.ListByDate(ctx, date, limit)
}

// FeedRange returns a paginated page of payments across all loans within an
// inclusive [from, to] date range, plus the total count — the authoritative
// server-side filter used by the Reports export.
func (s *Service) FeedRange(ctx context.Context, from, to string, limit, offset int) ([]*domain.Collection, int64, error) {
	if limit <= 0 {
		limit = defaultFeedLimit
	}
	if limit > maxFeedLimit {
		limit = maxFeedLimit
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.ListRange(ctx, RangeParams{From: from, To: to, Limit: limit, Offset: offset})
}

// Get returns a single payment.
func (s *Service) Get(ctx context.Context, id int64) (*domain.Collection, error) {
	return s.repo.FindByID(ctx, id)
}

// Update edits a payment. The parent loan is re-fetched to re-validate the date
// range; loan_id itself is immutable.
func (s *Service) Update(ctx context.Context, id int64, in domain.CollectionInput) (*domain.Collection, error) {
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	l, err := s.loans.FindByID(ctx, existing.LoanID)
	if err != nil {
		return nil, err
	}
	in.LoanID = existing.LoanID
	// Preserve the kind on update if the caller didn't supply one.
	if in.Kind == "" {
		in.Kind = existing.Kind
	}
	collected, err := s.repo.SumByLoan(ctx, existing.LoanID)
	if err != nil {
		return nil, err
	}
	// Exclude the row being edited: the sum above still contains its OLD amount,
	// so validating the new amount against it double-counts this payment. Left
	// in, a no-op re-save of a payment on a fully-repaid loan is rejected as an
	// overpayment. Validation must see the loan as it will be once this row is
	// replaced.
	collected = collected.Less(existing.Kind, existing.Amount)
	if err := in.Validate(l, collected, s.now()); err != nil {
		return nil, err
	}
	c, err := s.repo.Update(ctx, id, in)
	if err != nil {
		return nil, err
	}
	s.syncLoanStatus(ctx, existing.LoanID) // may auto-close or auto-reopen
	return c, nil
}

// Delete soft-deletes a payment, then re-syncs the loan's status (a removed
// settlement payment can reopen a previously auto-closed loan).
func (s *Service) Delete(ctx context.Context, id int64) error {
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return err
	}
	if err := s.repo.SoftDelete(ctx, id); err != nil {
		return err
	}
	s.syncLoanStatus(ctx, existing.LoanID)
	return nil
}

// ListForCustomer returns every payment on one customer's loans (borrower portal).
func (s *Service) ListForCustomer(ctx context.Context, customerID int64) ([]*domain.Collection, error) {
	return s.repo.ListByCustomer(ctx, customerID)
}

// RecordSplitTx records an APPROVED payment submitted from outside the office —
// a customer portal proof or a recovery agent's claim — inside the caller's
// transaction, so the money and the approval commit together.
// It applies exactly what Record applies to a staff entry: loan row lock, ACTIVE
// check, per-row validation, audit, and auto-close when the balance hits zero.
//
// The amount is split by domain.SplitPortalPayment (interest due first, then
// principal, for interest-only loans; one payment otherwise) and must not exceed
// the CURRENT outstanding: staff may have recorded cash since the borrower
// uploaded, and accepting the proof then would overpay the loan.
//
// Each row carries the idempotency key "<keyPrefix>-<n>", so the rows can be
// traced back to their proof and a replay can never record them twice.
func (s *Service) RecordSplitTx(
	ctx context.Context, tx pgx.Tx, loanID int64, amount domain.Paise, date time.Time, mode domain.PayMode,
	remarks string, postedBy *int64, keyPrefix string, collector *domain.Collector,
) ([]*domain.Collection, error) {
	if err := LockLoanForUpdate(ctx, tx, loanID); err != nil {
		return nil, err
	}
	l, err := s.loans.FindByID(ctx, loanID)
	if err != nil {
		return nil, err
	}
	if l.Status != domain.StatusActive {
		return nil, domain.NewConflict("This loan is closed — the payment cannot be recorded against it")
	}
	collected, err := s.repo.SumByLoanTx(ctx, tx, loanID)
	if err != nil {
		return nil, err
	}
	now := s.now()
	if outstanding := l.Outstanding(collected, now); amount > outstanding {
		return nil, domain.NewConflict("This payment (" + amount.String() + ") is more than the loan's current outstanding (" +
			outstanding.String() + "). Record it from the ledger or reject the proof.")
	}

	parts, err := domain.SplitPortalPayment(l, collected, amount, now)
	if err != nil {
		return nil, err
	}
	out := make([]*domain.Collection, 0, len(parts))
	running := collected
	for i, p := range parts {
		suffix := ""
		if len(parts) > 1 {
			if p.Kind == domain.KindPrincipal {
				suffix = " — principal"
			} else {
				suffix = " — interest"
			}
		}
		note := fitRemark(remarks, suffix)
		in := domain.CollectionInput{
			LoanID: loanID, Amount: p.Amount, Date: date,
			Mode: mode, Kind: p.Kind, Remarks: &note,
		}
		if err := in.Validate(l, running, now); err != nil {
			return nil, err
		}
		c, inserted, err := s.repo.CreateTx(ctx, tx, in, postedBy, keyPrefix+"-"+strconv.Itoa(i+1), collector)
		if err != nil {
			return nil, err
		}
		if inserted && s.audits != nil {
			if err := s.audits.RecordTx(ctx, tx, audit.Entry{
				EntityType: audit.EntityCollection,
				EntityID:   c.ID,
				Action:     audit.ActionPost,
				After: map[string]any{
					"receipt_no": c.ReceiptNo,
					"loan_id":    c.LoanID,
					"amount":     c.Amount.Rupees(),
					"date":       c.Date.Format("2006-01-02"),
					"mode":       string(c.Mode),
					"kind":       string(c.Kind),
					"source":     keyPrefix,
				},
			}); err != nil {
				return nil, err
			}
		}
		if p.Kind == domain.KindPrincipal {
			running.Principal = running.Principal.Add(p.Amount)
		} else {
			running.Interest = running.Interest.Add(p.Amount)
		}
		out = append(out, c)
	}

	after, err := s.repo.SumByLoanTx(ctx, tx, loanID)
	if err != nil {
		return nil, err
	}
	if l.IsFullyPaid(after, now) && l.Status == domain.StatusActive {
		if _, err := s.loans.SetStatusTx(ctx, tx, loanID, domain.StatusClosed); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// ListForAgent returns the payments on a recovery agent's assigned loans.
func (s *Service) ListForAgent(ctx context.Context, agentID int64) ([]*domain.Collection, error) {
	return s.repo.ListForAgent(ctx, agentID)
}
