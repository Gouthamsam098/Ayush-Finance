// Package expense implements expense tracking (create, list with filters,
// read, edit, soft-delete) across repository -> service -> handler layers.
// Amounts are stored as whole rupees (domain.Paise.DBRupees) like every other
// money column; expenses carry no human-readable code (plain identity PK).
package expense

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository provides expense data access. Every query is parameterised and
// excludes soft-deleted rows.
type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// ListParams controls filtering + pagination. Validated by the service first.
type ListParams struct {
	Limit    int
	Offset   int
	Search   string
	Category string // '' = any
	From     string // '' = no lower bound (YYYY-MM-DD)
	To       string // '' = no upper bound (YYYY-MM-DD)
}

const expenseColumns = `
	id, category, sub_category, name, amount, mode, date, remarks, created_at, updated_at`

// Create inserts an expense. Amount is stored as whole rupees.
func (r *Repository) Create(ctx context.Context, in domain.ExpenseInput) (*domain.Expense, error) {
	const query = `
		INSERT INTO expenses (category, sub_category, name, amount, mode, date, remarks)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING ` + expenseColumns
	row := r.pool.QueryRow(ctx, query,
		string(in.Category), nilIfEmpty(in.SubCategory), strings.TrimSpace(in.Name),
		in.Amount.DBRupees(), string(in.Mode), in.Date, nilIfEmpty(in.Remarks))
	e, err := scanExpense(row)
	if err != nil {
		return nil, translateWriteError(err)
	}
	return e, nil
}

// FindByID returns a non-deleted expense or a NotFound error.
func (r *Repository) FindByID(ctx context.Context, id int64) (*domain.Expense, error) {
	const query = `SELECT ` + expenseColumns + ` FROM expenses WHERE id = $1 AND deleted_at IS NULL`
	e, err := scanExpense(r.pool.QueryRow(ctx, query, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("expense")
	}
	if err != nil {
		return nil, err
	}
	return e, nil
}

// List returns a page of expenses (newest first) and the total matching the filter.
func (r *Repository) List(ctx context.Context, p ListParams) ([]*domain.Expense, int64, error) {
	where := "WHERE deleted_at IS NULL"
	args := []any{}
	add := func(clause string, val any) {
		args = append(args, val)
		where += fmt.Sprintf(clause, len(args))
	}
	if p.Category != "" {
		add(" AND category = $%d", p.Category)
	}
	if p.From != "" {
		add(" AND date >= $%d", p.From)
	}
	if p.To != "" {
		add(" AND date <= $%d", p.To)
	}
	if p.Search != "" {
		args = append(args, "%"+strings.ToLower(p.Search)+"%")
		n := len(args)
		where += fmt.Sprintf(` AND (lower(name) LIKE $%d
			OR lower(coalesce(sub_category, '')) LIKE $%d
			OR lower(coalesce(remarks, '')) LIKE $%d)`, n, n, n)
	}

	var total int64
	if err := r.pool.QueryRow(ctx, "SELECT count(*) FROM expenses "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, p.Limit, p.Offset)
	query := fmt.Sprintf(`SELECT %s FROM expenses %s ORDER BY date DESC, id DESC LIMIT $%d OFFSET $%d`,
		expenseColumns, where, len(args)-1, len(args))

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []*domain.Expense
	for rows.Next() {
		e, err := scanExpense(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, e)
	}
	return out, total, rows.Err()
}

// Update rewrites an existing expense's editable fields.
func (r *Repository) Update(ctx context.Context, id int64, in domain.ExpenseInput) (*domain.Expense, error) {
	const query = `
		UPDATE expenses SET
			category = $2, sub_category = $3, name = $4, amount = $5, mode = $6, date = $7, remarks = $8,
			updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING ` + expenseColumns
	e, err := scanExpense(r.pool.QueryRow(ctx, query,
		id, string(in.Category), nilIfEmpty(in.SubCategory), strings.TrimSpace(in.Name),
		in.Amount.DBRupees(), string(in.Mode), in.Date, nilIfEmpty(in.Remarks)))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("expense")
	}
	if err != nil {
		return nil, translateWriteError(err)
	}
	return e, nil
}

// SoftDelete marks an expense deleted; NotFound if missing or already deleted.
func (r *Repository) SoftDelete(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE expenses SET deleted_at = now(), updated_at = now()
		 WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.NewNotFound("expense")
	}
	return nil
}

// ── scanning + helpers ──

type rowScanner interface{ Scan(dest ...any) error }

func scanExpense(row rowScanner) (*domain.Expense, error) {
	var e domain.Expense
	var category, mode string
	var amount int64
	err := row.Scan(
		&e.ID, &category, &e.SubCategory, &e.Name, &amount, &mode, &e.Date,
		&e.Remarks, &e.CreatedAt, &e.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	e.Category = domain.ExpenseCategory(category)
	e.Mode = domain.PayMode(mode)
	e.Amount = domain.PaiseFromDBRupees(amount)
	return &e, nil
}

func nilIfEmpty(s *string) *string {
	if s == nil || strings.TrimSpace(*s) == "" {
		return nil
	}
	t := strings.TrimSpace(*s)
	return &t
}

// translateWriteError maps check violations to friendly errors.
func translateWriteError(err error) error {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "expenses_amount_positive"):
		return domain.NewValidation("Amount must be greater than 0", map[string]string{"amount": "Too small"})
	case strings.Contains(msg, "expenses_mode_valid"):
		return domain.NewValidation("Invalid payment mode", map[string]string{"mode": "Unknown mode"})
	case strings.Contains(msg, "expenses_category_valid"):
		return domain.NewValidation("Invalid category", map[string]string{"category": "Unknown category"})
	}
	return err
}
