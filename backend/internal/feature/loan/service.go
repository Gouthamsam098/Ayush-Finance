package loan

import (
	"context"
	"time"

	"github.com/anush-capitals/lms-backend/internal/audit"
	"github.com/anush-capitals/lms-backend/internal/domain"
)

const (
	defaultLimit = 20
	maxLimit     = 100
)

// Clock returns the current time; injected so date validation is testable.
type Clock func() time.Time

// CollectedReader supplies the total collected (Paise) for loans, so the loan
// service can compute a truthful outstanding balance. Satisfied by the
// collection repository; declared here as an interface to avoid a hard
// dependency on that package (loan is the lower layer).
type CollectedReader interface {
	SumByLoan(ctx context.Context, loanID int64) (domain.Collected, error)
	SumByLoans(ctx context.Context, loanIDs []int64) (map[int64]domain.Collected, error)
}

// Service holds loan business logic: validation, server-authoritative money
// math, and status-transition rules.
type Service struct {
	repo      *Repository
	collected CollectedReader
	now       Clock
	// audits records loan create/edit/close/reopen/delete with before/after terms.
	audits *audit.Recorder
}

func NewService(repo *Repository, collected CollectedReader, audits *audit.Recorder) *Service {
	return &Service{repo: repo, collected: collected, now: time.Now, audits: audits}
}

// loanSnapshot is the money/schedule view of a loan kept in the audit trail.
func loanSnapshot(l *domain.Loan) map[string]any {
	return map[string]any{
		"loan_number": l.LoanNumber, "customer_id": l.CustomerID, "type": string(l.Type),
		"repayment_mode": string(l.RepaymentMode), "principal": l.Principal.Rupees(), "rate": l.Rate,
		"interest": l.Interest.Rupees(), "disbursed": l.Disbursed.Rupees(), "num_days": l.NumDays,
		"loan_date": l.LoanDate.Format("2006-01-02"), "status": string(l.Status),
	}
}

func (s *Service) record(ctx context.Context, id int64, action audit.Action, before, after any) {
	s.audits.Record(ctx, audit.Entry{EntityType: audit.EntityLoan, EntityID: id, Action: action, Before: before, After: after})
}

// Collected returns the split (interest/principal) paid on a loan. Exposed so
// the handler can compute outstanding for the response DTO.
func (s *Service) Collected(ctx context.Context, loanID int64) (domain.Collected, error) {
	return s.collected.SumByLoan(ctx, loanID)
}

// CollectedFor returns split collected totals keyed by loan ID for a set of
// loans in one query — used to render a loan list without N+1 lookups.
func (s *Service) CollectedFor(ctx context.Context, loans []*domain.Loan) (map[int64]domain.Collected, error) {
	ids := make([]int64, len(loans))
	for i, l := range loans {
		ids[i] = l.ID
	}
	return s.collected.SumByLoans(ctx, ids)
}

// now() is used across the service; kept here for readability near the struct.

// Page is a validated pagination + filter request.
type Page struct {
	Number     int
	Limit      int
	Search     string
	Type       string
	Status     string
	CustomerID int64
	From       string // '' = no lower bound (YYYY-MM-DD, on loan_date)
	To         string // '' = no upper bound (YYYY-MM-DD, on loan_date)
}

func (p Page) Normalize() Page {
	if p.Number < 1 {
		p.Number = 1
	}
	if p.Limit <= 0 {
		p.Limit = defaultLimit
	}
	if p.Limit > maxLimit {
		p.Limit = maxLimit
	}
	return p
}

func (p Page) offset() int { return (p.Number - 1) * p.Limit }

// Create validates the input, derives the authoritative math server-side, and
// persists. The client's interest/EMI/term/dates are never trusted.
func (s *Service) Create(ctx context.Context, in domain.LoanInput) (*domain.Loan, error) {
	if err := in.Validate(s.now()); err != nil {
		return nil, err
	}
	l, err := s.repo.Create(ctx, in, in.Derive())
	if err != nil {
		return nil, err
	}
	s.record(ctx, l.ID, audit.ActionCreate, nil, loanSnapshot(l))
	return l, nil
}

// Get returns a single loan by ID.
func (s *Service) Get(ctx context.Context, id int64) (*domain.Loan, error) {
	return s.repo.FindByID(ctx, id)
}

// List returns a page of loans plus the total matching count.
func (s *Service) List(ctx context.Context, page Page) ([]*domain.Loan, int64, error) {
	page = page.Normalize()
	return s.repo.List(ctx, ListParams{
		Limit: page.Limit, Offset: page.offset(), Search: page.Search,
		Type: page.Type, Status: page.Status, CustomerID: page.CustomerID,
		From: page.From, To: page.To,
	})
}

// Update re-validates an edit and writes it under the loan's row lock.
//
// Once a loan has payments its terms (customer, type, repayment mode,
// principal, rate, loan date, tenure) are locked: changing them would re-price
// every receipt already recorded. Contact, remarks and vehicle details stay
// editable. An edit that changes no term keeps the stored money figures as
// they are; only a term change (allowed while there are no payments) re-derives
// them.
func (s *Service) Update(ctx context.Context, id int64, in domain.LoanInput) (*domain.Loan, error) {
	tx, err := s.repo.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	existing, err := s.repo.FindForUpdateTx(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	if err := in.Validate(s.now()); err != nil {
		return nil, err
	}
	changes := in.TermChanges(existing)
	derived := existing.StoredTerms()
	if len(changes) > 0 {
		hasPayments, err := s.repo.HasPaymentsTx(ctx, tx, id)
		if err != nil {
			return nil, err
		}
		if hasPayments {
			fields := make(map[string]string, len(changes))
			for _, f := range changes {
				fields[f] = "Locked — this loan already has payments"
			}
			return nil, domain.NewValidation("This loan already has payments, so its customer, type, amount, rate, "+
				"dates and tenure can no longer change. Contact, remarks and vehicle details can still be edited.", fields)
		}
		derived = in.Derive()
	}
	l, err := s.repo.UpdateTx(ctx, tx, id, in, derived)
	if err != nil {
		return nil, err
	}
	if err := s.audits.RecordTx(ctx, tx, audit.Entry{EntityType: audit.EntityLoan, EntityID: id,
		Action: audit.ActionUpdate, Before: loanSnapshot(existing), After: loanSnapshot(l)}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return l, nil
}

// Close marks a loan CLOSED. A loan with an outstanding balance cannot be
// closed. Outstanding is computed from the loan plus its real recorded
// collections, so the gate reflects actual payments.
func (s *Service) Close(ctx context.Context, id int64) (*domain.Loan, error) {
	l, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if l.Status == domain.StatusClosed {
		return l, nil // idempotent
	}
	collected, err := s.collected.SumByLoan(ctx, id)
	if err != nil {
		return nil, err
	}
	if out := l.Outstanding(collected, s.now()); out > 0 {
		return nil, domain.NewConflict("Cannot close — an outstanding balance remains")
	}
	closed, err := s.repo.SetStatus(ctx, id, domain.StatusClosed)
	if err != nil {
		return nil, err
	}
	s.record(ctx, id, audit.ActionUpdate, map[string]any{"status": string(l.Status)}, map[string]any{"status": string(closed.Status)})
	return closed, nil
}

// Reopen returns a CLOSED loan to ACTIVE — only when something is still owed.
// A paid-off loan has nothing to reopen for: correcting a wrong payment is done
// by editing or deleting it, which reopens the loan by itself.
func (s *Service) Reopen(ctx context.Context, id int64) (*domain.Loan, error) {
	l, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if l.Status != domain.StatusActive {
		collected, err := s.collected.SumByLoan(ctx, id)
		if err != nil {
			return nil, err
		}
		if l.HasNoBalanceIgnoringStatus(collected, s.now()) {
			return nil, domain.NewConflict("Nothing is owed on this loan, so it stays closed. To correct a payment, edit or delete it on the ledger — the loan reopens by itself if a balance remains.")
		}
	}
	reopened, err := s.repo.SetStatus(ctx, id, domain.StatusActive)
	if err != nil {
		return nil, err
	}
	s.record(ctx, id, audit.ActionUpdate, map[string]any{"status": string(l.Status)}, map[string]any{"status": string(reopened.Status)})
	return reopened, nil
}

// Delete soft-deletes a loan and its payment (collection) records.
func (s *Service) Delete(ctx context.Context, id int64) error {
	l, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return err
	}
	if err := s.repo.SoftDelete(ctx, id); err != nil {
		return err
	}
	s.record(ctx, id, audit.ActionDelete, loanSnapshot(l), nil)
	return nil
}

// ListForCustomer returns all of one customer's loans (borrower portal).
func (s *Service) ListForCustomer(ctx context.Context, customerID int64) ([]*domain.Loan, error) {
	return s.repo.ListByCustomer(ctx, customerID)
}

// ListAssignedTo returns a recovery agent's assigned loans.
func (s *Service) ListAssignedTo(ctx context.Context, agentID int64) ([]*domain.Loan, error) {
	return s.repo.ListAssignedTo(ctx, agentID)
}
