// Package investment implements the investor register: capital the business
// borrows, and the interest payouts it costs. Layered repository -> service ->
// handler like every other feature. Paying interest writes BOTH a payout row
// and its expense row inside one transaction, so a cost can never be recorded
// without the expense that accounts for it (or the other way round).
package investment

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository provides investment data access. Every query is parameterised and
// excludes soft-deleted rows.
type Repository struct{ pool *pgxpool.Pool }

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// Pool exposes the connection pool so the service can open a transaction that
// spans this repository and the expenses table (a payout and its expense must
// commit as one unit).
func (r *Repository) Pool() *pgxpool.Pool { return r.pool }

const investmentColumns = `
	id, code, investor_name, mobile, email, principal, rate, frequency,
	start_date, status, settled_date, notes, created_at, updated_at`

// Create inserts an investment, minting its INV-#### code from the sequence in
// the same statement so the code is allocated atomically.
func (r *Repository) Create(ctx context.Context, in domain.InvestmentInput) (*domain.Investment, error) {
	const query = `
		INSERT INTO investments (code, investor_name, mobile, email, principal, rate, frequency, start_date, notes)
		VALUES ('INV-' || nextval('investment_code_seq'), $1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING ` + investmentColumns
	row := r.pool.QueryRow(ctx, query,
		strings.TrimSpace(in.InvestorName), nilIfEmpty(in.Mobile), nilIfEmpty(in.Email),
		in.Principal.DBRupees(), in.Rate, string(in.Frequency), in.StartDate, nilIfEmpty(in.Notes))
	inv, err := scanInvestment(row)
	if err != nil {
		return nil, translateWriteError(err)
	}
	return inv, nil
}

// FindByID returns a non-deleted investment or a NotFound error.
func (r *Repository) FindByID(ctx context.Context, id int64) (*domain.Investment, error) {
	const query = `SELECT ` + investmentColumns + ` FROM investments WHERE id = $1 AND deleted_at IS NULL`
	inv, err := scanInvestment(r.pool.QueryRow(ctx, query, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("investment")
	}
	if err != nil {
		return nil, err
	}
	return inv, nil
}

// ListParams filters the register.
type ListParams struct {
	Status string // '' = any
	Search string
	Limit  int
	Offset int
}

// List returns a page of investments plus the total matching count.
func (r *Repository) List(ctx context.Context, p ListParams) ([]*domain.Investment, int64, error) {
	where := "WHERE deleted_at IS NULL"
	args := []any{}
	if p.Status != "" {
		args = append(args, p.Status)
		where += fmt.Sprintf(" AND status = $%d", len(args))
	}
	if p.Search != "" {
		args = append(args, "%"+strings.ToLower(p.Search)+"%")
		where += fmt.Sprintf(" AND (lower(investor_name) LIKE $%d OR lower(code) LIKE $%d OR coalesce(mobile,'') LIKE $%d)",
			len(args), len(args), len(args))
	}

	var total int64
	if err := r.pool.QueryRow(ctx, "SELECT count(*) FROM investments "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, p.Limit, p.Offset)
	query := fmt.Sprintf(`SELECT %s FROM investments %s ORDER BY status ASC, id DESC LIMIT $%d OFFSET $%d`,
		investmentColumns, where, len(args)-1, len(args))
	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []*domain.Investment
	for rows.Next() {
		inv, err := scanInvestment(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, inv)
	}
	return out, total, rows.Err()
}

// Update rewrites an investment's editable fields. Status/settled_date are NOT
// editable here — settling has its own guarded path.
func (r *Repository) Update(ctx context.Context, id int64, in domain.InvestmentInput) (*domain.Investment, error) {
	const query = `
		UPDATE investments SET
			investor_name = $2, mobile = $3, email = $4, principal = $5,
			rate = $6, frequency = $7, start_date = $8, notes = $9, updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING ` + investmentColumns
	inv, err := scanInvestment(r.pool.QueryRow(ctx, query, id,
		strings.TrimSpace(in.InvestorName), nilIfEmpty(in.Mobile), nilIfEmpty(in.Email),
		in.Principal.DBRupees(), in.Rate, string(in.Frequency), in.StartDate, nilIfEmpty(in.Notes)))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("investment")
	}
	if err != nil {
		return nil, translateWriteError(err)
	}
	return inv, nil
}

// Settle marks the capital returned: status CLOSED with the settlement date.
// Idempotent by guard — a CLOSED investment is not matched, so a double-settle
// returns NotFound rather than moving the date.
func (r *Repository) Settle(ctx context.Context, id int64, on string) (*domain.Investment, error) {
	const query = `
		UPDATE investments SET status = 'CLOSED', settled_date = $2, updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL AND status = 'ACTIVE'
		RETURNING ` + investmentColumns
	inv, err := scanInvestment(r.pool.QueryRow(ctx, query, id, on))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewConflict("This investment is already settled")
	}
	if err != nil {
		return nil, translateWriteError(err)
	}
	return inv, nil
}

// Reopen undoes a settlement (an operator correction).
func (r *Repository) Reopen(ctx context.Context, id int64) (*domain.Investment, error) {
	const query = `
		UPDATE investments SET status = 'ACTIVE', settled_date = NULL, updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL AND status = 'CLOSED'
		RETURNING ` + investmentColumns
	inv, err := scanInvestment(r.pool.QueryRow(ctx, query, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewConflict("This investment is not settled")
	}
	if err != nil {
		return nil, translateWriteError(err)
	}
	return inv, nil
}

// SoftDelete marks an investment deleted; its payouts cascade on read because
// every payout query joins through a non-deleted investment.
func (r *Repository) SoftDelete(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE investments SET deleted_at = now(), updated_at = now()
		 WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.NewNotFound("investment")
	}
	return nil
}

// ── payouts ──────────────────────────────────────────────────────────────────

const payoutColumns = `
	id, investment_id, expense_id, date, amount, mode, remarks, posted_by, created_at, updated_at`

// LockInvestmentForUpdate takes a row lock inside tx. Anything that reads the
// paid total and then decides from it (validating a payout ceiling, then
// inserting) must call this FIRST so two concurrent payouts serialise instead
// of both acting on a stale sum.
func LockInvestmentForUpdate(ctx context.Context, tx pgx.Tx, id int64) error {
	var got int64
	err := tx.QueryRow(ctx,
		`SELECT id FROM investments WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, id).Scan(&got)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.NewNotFound("investment")
	}
	return err
}

// FindPayoutParentTx returns the investment id a payout belongs to, inside tx.
// Needed so a delete can lock the SAME parent row a concurrent payout locks.
func (r *Repository) FindPayoutParentTx(ctx context.Context, tx pgx.Tx, payoutID int64) (int64, error) {
	var investmentID int64
	err := tx.QueryRow(ctx,
		`SELECT investment_id FROM investor_payouts WHERE id = $1 AND deleted_at IS NULL`,
		payoutID).Scan(&investmentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.NewNotFound("payout")
	}
	return investmentID, err
}

// SumPaidTx is the total paid out for one investment, inside tx.
func (r *Repository) SumPaidTx(ctx context.Context, tx pgx.Tx, investmentID int64) (domain.Paise, error) {
	var total int64
	err := tx.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount), 0) FROM investor_payouts
		 WHERE investment_id = $1 AND deleted_at IS NULL`, investmentID).Scan(&total)
	if err != nil {
		return 0, err
	}
	return domain.PaiseFromDBRupees(total), nil
}

// SumPaidByInvestments returns paid totals keyed by investment id, in one
// round-trip — so a list render never issues an N+1 query.
func (r *Repository) SumPaidByInvestments(ctx context.Context, ids []int64) (map[int64]domain.Paise, error) {
	out := make(map[int64]domain.Paise, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := r.pool.Query(ctx,
		`SELECT investment_id, COALESCE(SUM(amount), 0) FROM investor_payouts
		 WHERE investment_id = ANY($1) AND deleted_at IS NULL GROUP BY investment_id`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, total int64
		if err := rows.Scan(&id, &total); err != nil {
			return nil, err
		}
		out[id] = domain.PaiseFromDBRupees(total)
	}
	return out, rows.Err()
}

// CreatePayoutTx inserts a payout inside tx, linked to the expense that records
// its cost.
func (r *Repository) CreatePayoutTx(
	ctx context.Context, tx pgx.Tx, in domain.PayoutInput, expenseID int64, postedBy *int64,
) (*domain.InvestorPayout, error) {
	const query = `
		INSERT INTO investor_payouts (investment_id, expense_id, date, amount, mode, remarks, posted_by, posted_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, now())
		RETURNING ` + payoutColumns
	row := tx.QueryRow(ctx, query,
		in.InvestmentID, expenseID, in.Date, in.Amount.DBRupees(), string(in.Mode),
		nilIfEmpty(in.Remarks), postedBy)
	p, err := scanPayout(row)
	if err != nil {
		return nil, translateWriteError(err)
	}
	return p, nil
}

// InsertExpenseTx writes the expense that accounts for a payout, inside the same
// tx, and returns its id. Kept here (rather than reaching into the expense
// feature) so the two writes share one transaction without a circular import.
func (r *Repository) InsertExpenseTx(
	ctx context.Context, tx pgx.Tx, in domain.ExpenseInput,
) (int64, error) {
	const query = `
		INSERT INTO expenses (category, sub_category, name, amount, mode, date, remarks)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id`
	var id int64
	err := tx.QueryRow(ctx, query,
		string(in.Category), nilIfEmpty(in.SubCategory), in.Name,
		in.Amount.DBRupees(), string(in.Mode), in.Date, nilIfEmpty(in.Remarks)).Scan(&id)
	if err != nil {
		return 0, translateWriteError(err)
	}
	return id, nil
}

// ListPayouts returns an investment's payouts, newest first.
func (r *Repository) ListPayouts(ctx context.Context, investmentID int64) ([]*domain.InvestorPayout, error) {
	const query = `SELECT ` + payoutColumns + `
		FROM investor_payouts WHERE investment_id = $1 AND deleted_at IS NULL
		ORDER BY date DESC, id DESC`
	rows, err := r.pool.Query(ctx, query, investmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*domain.InvestorPayout
	for rows.Next() {
		p, err := scanPayout(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// DeletePayoutTx soft-deletes a payout AND the expense it created, inside tx —
// removing the cost record while leaving the expense would overstate spending.
func (r *Repository) DeletePayoutTx(ctx context.Context, tx pgx.Tx, id int64) error {
	var expenseID *int64
	// SCOPED to a live, ACTIVE parent. Without the EXISTS clause any payout id
	// could be deleted by URL alone — including payouts of a soft-deleted
	// investment, or of a SETTLED one (rewriting closed financial history).
	// Deleting a payout also lowers the paid total, which re-opens the
	// "one cycle ahead" ceiling — so an unscoped delete let the same interest
	// cycle be paid twice.
	err := tx.QueryRow(ctx,
		`UPDATE investor_payouts p SET deleted_at = now(), updated_at = now()
		 WHERE p.id = $1 AND p.deleted_at IS NULL
		   AND EXISTS (
		     SELECT 1 FROM investments i
		     WHERE i.id = p.investment_id
		       AND i.deleted_at IS NULL
		       AND i.status = 'ACTIVE'
		   )
		 RETURNING p.expense_id`, id).Scan(&expenseID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.NewNotFound("payout")
	}
	if err != nil {
		return err
	}
	if expenseID != nil {
		if _, err := tx.Exec(ctx,
			`UPDATE expenses SET deleted_at = now(), updated_at = now()
			 WHERE id = $1 AND deleted_at IS NULL`, *expenseID); err != nil {
			return err
		}
	}
	return nil
}

// ── scanning + helpers ──

type rowScanner interface{ Scan(dest ...any) error }

func scanInvestment(row rowScanner) (*domain.Investment, error) {
	var inv domain.Investment
	var frequency, status string
	var principal int64
	err := row.Scan(
		&inv.ID, &inv.Code, &inv.InvestorName, &inv.Mobile, &inv.Email,
		&principal, &inv.Rate, &frequency, &inv.StartDate, &status,
		&inv.SettledDate, &inv.Notes, &inv.CreatedAt, &inv.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	inv.Principal = domain.PaiseFromDBRupees(principal)
	inv.Frequency = domain.PayoutFrequency(frequency)
	inv.Status = domain.InvestmentStatus(status)
	return &inv, nil
}

func scanPayout(row rowScanner) (*domain.InvestorPayout, error) {
	var p domain.InvestorPayout
	var mode string
	var amount int64
	err := row.Scan(
		&p.ID, &p.InvestmentID, &p.ExpenseID, &p.Date, &amount, &mode,
		&p.Remarks, &p.PostedBy, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	p.Amount = domain.PaiseFromDBRupees(amount)
	p.Mode = domain.PayMode(mode)
	return &p, nil
}

func nilIfEmpty(s *string) *string {
	if s == nil || strings.TrimSpace(*s) == "" {
		return nil
	}
	t := strings.TrimSpace(*s)
	return &t
}

// translateWriteError maps constraint violations to friendly domain errors.
func translateWriteError(err error) error {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "investments_principal_positive"):
		return domain.NewValidation("Amount must be greater than 0", map[string]string{"principal": "Too small"})
	case strings.Contains(msg, "investments_rate_valid"):
		return domain.NewValidation("Invalid interest rate", map[string]string{"rate": "Must be between 0 and 100"})
	case strings.Contains(msg, "investments_frequency_valid"):
		return domain.NewValidation("Invalid payout frequency", map[string]string{"frequency": "Use MONTHLY or YEARLY"})
	case strings.Contains(msg, "investor_payouts_amount_positive"):
		return domain.NewValidation("Amount must be greater than 0", map[string]string{"amount": "Too small"})
	case strings.Contains(msg, "investor_payouts_mode_valid"):
		return domain.NewValidation("Invalid payment mode", map[string]string{"mode": "Unknown mode"})
	case strings.Contains(msg, "expenses_category_valid"):
		return domain.NewValidation("Invalid expense category", map[string]string{"category": "Unknown category"})
	}
	return err
}
