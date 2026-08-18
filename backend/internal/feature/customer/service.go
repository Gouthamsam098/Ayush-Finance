package customer

import (
	"context"
	"time"

	"github.com/anush-capitals/lms-backend/internal/domain"
)

// Pagination bounds. Kept as named constants rather than magic numbers.
const (
	defaultLimit = 20
	maxLimit     = 100
)

// Clock returns the current time; injected so age/DOB validation is testable.
type Clock func() time.Time

// Service holds customer business logic and validation.
type Service struct {
	repo *Repository
	now  Clock
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo, now: time.Now}
}

// Page is a validated pagination request.
type Page struct {
	Number int
	Limit  int
	Search string
	From   string // '' = no lower bound (YYYY-MM-DD, on created_at date)
	To     string // '' = no upper bound (YYYY-MM-DD, on created_at date)
}

// Normalize clamps a raw page request into safe bounds, applying defaults.
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

// Create validates and persists a new customer.
func (s *Service) Create(ctx context.Context, in domain.CustomerInput) (*domain.Customer, error) {
	if err := in.Validate(s.now(), domain.ModeCreate); err != nil {
		return nil, err
	}
	return s.repo.Create(ctx, in)
}

// Get returns a single customer by ID.
func (s *Service) Get(ctx context.Context, id int64) (*domain.Customer, error) {
	return s.repo.FindByID(ctx, id)
}

// List returns a page of customers plus the total matching count.
func (s *Service) List(ctx context.Context, page Page) ([]*domain.Customer, int64, error) {
	page = page.Normalize()
	return s.repo.List(ctx, ListParams{
		Limit:  page.Limit,
		Offset: page.offset(),
		Search: page.Search,
		From:   page.From,
		To:     page.To,
	})
}

// Update validates and applies changes to an existing customer. KYC
// identifiers left blank in the input are preserved from the stored record
// (the frontend never receives the raw values back, so a blank means "keep").
func (s *Service) Update(ctx context.Context, id int64, in domain.CustomerInput) (*domain.Customer, error) {
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if !nonEmptyStr(in.AadhaarNumber) {
		in.AadhaarNumber = existing.AadhaarNumber
	}
	if !nonEmptyStr(in.PANNumber) {
		in.PANNumber = existing.PANNumber
	}

	if err := in.Validate(s.now(), domain.ModeUpdate); err != nil {
		return nil, err
	}
	return s.repo.Update(ctx, id, in)
}

func nonEmptyStr(s *string) bool { return s != nil && *s != "" }

// Delete soft-deletes a customer and cascaded loans, collections, and documents.
// Expenses are not customer-scoped and are not deleted.
func (s *Service) Delete(ctx context.Context, id int64) error {
	return s.repo.SoftDelete(ctx, id)
}
