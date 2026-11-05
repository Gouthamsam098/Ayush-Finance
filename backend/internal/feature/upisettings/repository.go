// Package upisettings stores the UPI ID borrowers pay to, one per loan type,
// across repository -> service -> handler. Admins edit it in Settings; the
// customer portal and recovery agents read it.
package upisettings

import (
	"context"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository provides loan_type_upi data access. All queries are parameterised.
type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// Pool exposes the pool so the service can save and audit in one tx.
func (r *Repository) Pool() *pgxpool.Pool { return r.pool }

// List returns the saved rows (none until an admin first saves).
func (r *Repository) List(ctx context.Context) ([]domain.LoanTypeUPI, error) {
	rows, err := r.pool.Query(ctx, `SELECT loan_type, payee_vpa, payee_name FROM loan_type_upi ORDER BY loan_type`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.LoanTypeUPI{}
	for rows.Next() {
		var row domain.LoanTypeUPI
		var t string
		if err := rows.Scan(&t, &row.PayeeVPA, &row.PayeeName); err != nil {
			return nil, err
		}
		row.LoanType = domain.LoanType(t)
		out = append(out, row)
	}
	return out, rows.Err()
}

// ReplaceAllTx writes every row (insert or update) inside tx.
func (r *Repository) ReplaceAllTx(ctx context.Context, tx pgx.Tx, rows []domain.LoanTypeUPI, by *int64) error {
	for _, row := range rows {
		if _, err := tx.Exec(ctx, `
			INSERT INTO loan_type_upi (loan_type, payee_vpa, payee_name, updated_by, updated_at)
			VALUES ($1, $2, $3, $4, now())
			ON CONFLICT (loan_type) DO UPDATE
			SET payee_vpa = EXCLUDED.payee_vpa, payee_name = EXCLUDED.payee_name,
			    updated_by = EXCLUDED.updated_by, updated_at = now()`,
			string(row.LoanType), row.PayeeVPA, row.PayeeName, by); err != nil {
			return err
		}
	}
	return nil
}
