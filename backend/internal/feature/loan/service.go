package loan

import (
	"context"
	"time"

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
}

func NewService(repo *Repository, collected CollectedReader) *Service {
	return &Service{repo: repo, collected: collected, now: time.Now}
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
	return s.repo.Create(ctx, in, in.Derive())
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

// Update re-validates and re-derives the loan on every change.
func (s *Service) Update(ctx context.Context, id int64, in domain.LoanInput) (*domain.Loan, error) {
	if _, err := s.repo.FindByID(ctx, id); err != nil {
		return nil, err
	}
	if err := in.Validate(s.now()); err != nil {
		return nil, err
	}
	return s.repo.Update(ctx, id, in, in.Derive())
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
	return s.repo.SetStatus(ctx, id, domain.StatusClosed)
}

// Reopen returns a CLOSED loan to ACTIVE.
func (s *Service) Reopen(ctx context.Context, id int64) (*domain.Loan, error) {
	return s.repo.SetStatus(ctx, id, domain.StatusActive)
}

// Delete soft-deletes a loan and its payment (collection) records.
func (s *Service) Delete(ctx context.Context, id int64) error {
	return s.repo.SoftDelete(ctx, id)
}
