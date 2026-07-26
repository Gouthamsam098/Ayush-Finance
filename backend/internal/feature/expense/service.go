package expense

import (
	"context"
	"time"

	"github.com/anush-capitals/lms-backend/internal/domain"
)

const (
	defaultLimit = 50
	maxLimit     = 500
)

// Clock returns the current time; injected so date validation is testable.
type Clock func() time.Time

// Page is a validated pagination + filter request.
type Page struct {
	Number   int
	Limit    int
	Search   string
	Category string
	From     string
	To       string
}

// Normalize clamps the page/limit into range.
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

// Service holds expense business logic: validation before every write. Expenses
// have no cross-entity rules (unlike collections against loans), so the service
// is a thin validating pass-through over the repository.
type Service struct {
	repo *Repository
	now  Clock
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo, now: time.Now}
}

// Create validates and persists an expense.
func (s *Service) Create(ctx context.Context, in domain.ExpenseInput) (*domain.Expense, error) {
	if err := in.Validate(s.now()); err != nil {
		return nil, err
	}
	return s.repo.Create(ctx, in)
}

// List returns a page of expenses matching the filter, plus the total count.
func (s *Service) List(ctx context.Context, p Page) ([]*domain.Expense, int64, error) {
	p = p.Normalize()
	return s.repo.List(ctx, ListParams{
		Limit:    p.Limit,
		Offset:   p.offset(),
		Search:   p.Search,
		Category: p.Category,
		From:     p.From,
		To:       p.To,
	})
}

// Get returns a single expense.
func (s *Service) Get(ctx context.Context, id int64) (*domain.Expense, error) {
	return s.repo.FindByID(ctx, id)
}

// Update merges a partial patch onto the stored expense, re-validates the
// resulting entity, and rewrites it. Omitted fields keep their stored value, so
// a PATCH may send only what changed. NotFound if it doesn't exist.
func (s *Service) Update(ctx context.Context, id int64, patch domain.ExpensePatch) (*domain.Expense, error) {
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	in := patch.ApplyTo(existing.AsInput())
	if err := in.Validate(s.now()); err != nil {
		return nil, err
	}
	return s.repo.Update(ctx, id, in)
}

// Delete soft-deletes an expense.
func (s *Service) Delete(ctx context.Context, id int64) error {
	return s.repo.SoftDelete(ctx, id)
}
