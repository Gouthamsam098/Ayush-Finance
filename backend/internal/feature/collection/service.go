package collection

import (
	"context"
	"time"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/anush-capitals/lms-backend/internal/feature/loan"
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
}

// Service holds collection business logic: validation against the parent loan,
// status gating, and the (soft) overpayment signal.
type Service struct {
	repo  *Repository
	loans LoanGateway
	now   Clock
}

func NewService(repo *Repository, loans *loan.Repository) *Service {
	return &Service{repo: repo, loans: loans, now: time.Now}
}

// syncLoanStatus auto-closes a loan whose balance has reached zero, or reopens a
// CLOSED loan whose balance has re-appeared (e.g. a settlement payment was
// edited down or deleted). Called after every collection mutation so the loan's
// status always reflects its real outstanding. Failure here is non-fatal to the
// collection write — the payment is already persisted — so errors are ignored.
func (s *Service) syncLoanStatus(ctx context.Context, loanID int64) {
	l, err := s.loans.FindByID(ctx, loanID)
	if err != nil {
		return
	}
	collected, err := s.repo.SumByLoan(ctx, loanID)
	if err != nil {
		return
	}
	fullyPaid := l.IsFullyPaid(collected, s.now())
	if fullyPaid && l.Status == domain.StatusActive {
		_, _ = s.loans.SetStatus(ctx, loanID, domain.StatusClosed)
	} else if !fullyPaid && l.Status == domain.StatusClosed {
		_, _ = s.loans.SetStatus(ctx, loanID, domain.StatusActive)
	}
}

// Record validates and persists a payment against a loan. The loan must exist
// and be ACTIVE. Overpayment is allowed (early settlement / advance) — the UI
// warns; the server does not block. postedBy is the authenticated operator.
func (s *Service) Record(ctx context.Context, in domain.CollectionInput, postedBy *int64) (*domain.Collection, error) {
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
	collected, err := s.repo.SumByLoan(ctx, in.LoanID)
	if err != nil {
		return nil, err
	}
	if err := in.Validate(l, collected, s.now()); err != nil {
		return nil, err
	}
	c, err := s.repo.Create(ctx, in, postedBy)
	if err != nil {
		return nil, err
	}
	s.syncLoanStatus(ctx, in.LoanID) // auto-close if this settles the loan
	return c, nil
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
