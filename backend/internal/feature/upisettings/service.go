package upisettings

import (
	"context"

	"github.com/anush-capitals/lms-backend/internal/audit"
	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/jackc/pgx/v5"
)

// Auditor records settings changes on the audit trail.
type Auditor interface {
	RecordTx(ctx context.Context, tx pgx.Tx, e audit.Entry) error
}

// Service holds the loan-type UPI rules.
type Service struct {
	repo   *Repository
	audits Auditor
}

func NewService(repo *Repository, audits Auditor) *Service {
	return &Service{repo: repo, audits: audits}
}

// Get returns the saved UPI settings (possibly none or partial, for a fresh
// install). Callers treat UPI as available only when every type is set.
func (s *Service) Get(ctx context.Context) ([]domain.LoanTypeUPI, error) {
	return s.repo.List(ctx)
}

// Save validates and stores all six rows together, with an audit entry in the
// same transaction.
func (s *Service) Save(ctx context.Context, in map[domain.LoanType]domain.LoanTypeUPIInput, by *int64) ([]domain.LoanTypeUPI, error) {
	rows, err := domain.ValidateLoanTypeUPIs(in)
	if err != nil {
		return nil, err
	}
	tx, err := s.repo.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := s.repo.ReplaceAllTx(ctx, tx, rows, by); err != nil {
		return nil, err
	}
	if s.audits != nil {
		after := map[string]any{}
		for _, r := range rows {
			after[string(r.LoanType)] = map[string]string{"payee_vpa": r.PayeeVPA, "payee_name": r.PayeeName}
		}
		if err := s.audits.RecordTx(ctx, tx, audit.Entry{
			EntityType: audit.EntityLoanTypeUPI, EntityID: 1, Action: audit.ActionUpdate, After: after,
		}); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return rows, nil
}
