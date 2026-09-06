package collection

import (
	"context"
	"log/slog"
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

// Service holds collection business logic: validation against the parent loan,
// status gating, and the (soft) overpayment signal.
type Service struct {
	repo   *Repository
	loans  LoanGateway
	now    Clock
	audits Auditor
}

func NewService(repo *Repository, loans *loan.Repository, audits Auditor) *Service {
	return &Service{repo: repo, loans: loans, now: time.Now, audits: audits}
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
	fullyPaid := l.IsFullyPaid(collected, s.now())
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
	c, inserted, err := s.repo.CreateTx(ctx, tx, in, postedBy, idempotencyKey)
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
		c, _, err := s.repo.CreateTx(ctx, tx, in, postedBy, "")
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
