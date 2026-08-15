// Package loan implements loan management (create, read, list, update,
// close/reopen, soft-delete) across repository -> service -> handler layers.
// A single loans table holds all six products; type-specific columns are
// guarded by DB CHECK constraints (migration 0005).
package loan

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// (time is referenced indirectly via domain types; no direct import needed.)

// Repository provides loan data access. Every query is parameterised and
// excludes soft-deleted rows.
type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// ListParams controls filtering + pagination. Validated by the service first.
type ListParams struct {
	Limit      int
	Offset     int
	Search     string
	Type       string // '' = any
	Status     string // '' = any
	CustomerID int64  // 0 = any
	From       string // '' = no lower bound (YYYY-MM-DD, on loan_date)
	To         string // '' = no upper bound (YYYY-MM-DD, on loan_date)
}

const loanColumns = `
	id, loan_number, customer_id, type, repayment_mode, principal, rate, interest, deduction,
	disbursed_amount, instalment_amount, num_days, loan_date, next_due_date, status, contact, remarks,
	vehicle_number, vehicle_brand, vehicle_name, created_at, updated_at, closed_at`

// repaymentModeArg normalises an empty mode to the EMI default for storage.
func repaymentModeArg(m domain.RepaymentMode) string {
	if m == "" {
		return string(domain.RepayEMI)
	}
	return string(m)
}

// persistFields is the ordered column list (minus id/loan_number/timestamps)
// used by both INSERT and UPDATE so the two stay in lock-step.
func writeArgs(in domain.LoanInput, d domain.DerivedLoan) []any {
	return []any{
		in.CustomerID, string(in.Type), repaymentModeArg(in.RepaymentMode), in.Principal.DBRupees(), in.Rate, d.Interest.DBRupees(),
		ptrPaiseToRupees(d.Deduction), d.Disbursed.DBRupees(), ptrPaiseToRupees(d.DailyAmount), d.NumDays,
		in.LoanDate, d.NextDueDate, in.Contact, in.Remarks,
		nilIfEmpty(in.VehicleNumber), nilIfEmpty(in.VehicleBrand), nilIfEmpty(in.VehicleName),
	}
}

// Create inserts a loan, minting its LN-#### number from the sequence in the
// same statement so the number is allocated atomically.
func (r *Repository) Create(ctx context.Context, in domain.LoanInput, d domain.DerivedLoan) (*domain.Loan, error) {
	const query = `
		INSERT INTO loans (
			loan_number, customer_id, type, repayment_mode, principal, rate, interest, deduction,
			disbursed_amount, instalment_amount, num_days, loan_date, next_due_date, contact, remarks,
			vehicle_number, vehicle_brand, vehicle_name
		) VALUES (
			'LN-' || nextval('loan_number_seq'),
			$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
		)
		RETURNING ` + loanColumns

	row := r.pool.QueryRow(ctx, query, writeArgs(in, d)...)
	l, err := scanLoan(row)
	if err != nil {
		return nil, translateWriteError(err)
	}
	return l, nil
}

// FindByID returns a non-deleted loan or a NotFound error.
func (r *Repository) FindByID(ctx context.Context, id int64) (*domain.Loan, error) {
	const query = `SELECT ` + loanColumns + ` FROM loans WHERE id = $1 AND deleted_at IS NULL`
	l, err := scanLoan(r.pool.QueryRow(ctx, query, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("loan")
	}
	if err != nil {
		return nil, err
	}
	return l, nil
}

// List returns a page of loans and the total matching the filter.
func (r *Repository) List(ctx context.Context, p ListParams) ([]*domain.Loan, int64, error) {
	where := "WHERE deleted_at IS NULL"
	args := []any{}
	add := func(clause string, val any) {
		args = append(args, val)
		where += fmt.Sprintf(clause, len(args))
	}
	if p.Type != "" {
		add(" AND type = $%d", p.Type)
	}
	if p.Status != "" {
		add(" AND status = $%d", p.Status)
	}
	if p.CustomerID != 0 {
		add(" AND customer_id = $%d", p.CustomerID)
	}
	if p.From != "" {
		add(" AND loan_date >= $%d", p.From)
	}
	if p.To != "" {
		add(" AND loan_date <= $%d", p.To)
	}
	if p.Search != "" {
		// Match loan number or the borrower's name (joined) or type label.
		args = append(args, "%"+strings.ToLower(p.Search)+"%")
		n := len(args)
		where += fmt.Sprintf(` AND (lower(loan_number) LIKE $%d
			OR lower(type) LIKE $%d
			OR customer_id IN (SELECT id FROM customers WHERE lower(name) LIKE $%d))`, n, n, n)
	}

	var total int64
	if err := r.pool.QueryRow(ctx, "SELECT count(*) FROM loans "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, p.Limit, p.Offset)
	query := fmt.Sprintf(`SELECT %s FROM loans %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d`,
		loanColumns, where, len(args)-1, len(args))

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var loans []*domain.Loan
	for rows.Next() {
		l, err := scanLoan(rows)
		if err != nil {
			return nil, 0, err
		}
		loans = append(loans, l)
	}
	return loans, total, rows.Err()
}

// Update rewrites an existing loan's derived + editable fields.
func (r *Repository) Update(ctx context.Context, id int64, in domain.LoanInput, d domain.DerivedLoan) (*domain.Loan, error) {
	const query = `
		UPDATE loans SET
			customer_id=$2, type=$3, repayment_mode=$4, principal=$5, rate=$6, interest=$7, deduction=$8,
			disbursed_amount=$9, instalment_amount=$10, num_days=$11, loan_date=$12, next_due_date=$13, contact=$14,
			remarks=$15, vehicle_number=$16, vehicle_brand=$17, vehicle_name=$18,
			updated_at=now()
		WHERE id=$1 AND deleted_at IS NULL
		RETURNING ` + loanColumns

	args := append([]any{id}, writeArgs(in, d)...)
	l, err := scanLoan(r.pool.QueryRow(ctx, query, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("loan")
	}
	if err != nil {
		return nil, translateWriteError(err)
	}
	return l, nil
}

// SetStatus transitions a loan between ACTIVE and CLOSED, stamping closed_at.
func (r *Repository) SetStatus(ctx context.Context, id int64, status domain.LoanStatus) (*domain.Loan, error) {
	return r.setStatus(ctx, r.pool, id, status)
}

// SetStatusTx is SetStatus inside a transaction, so a payment insert and the
// resulting auto-close/auto-reopen commit as one unit — the loan's status can
// never disagree with the payments that justify it.
func (r *Repository) SetStatusTx(ctx context.Context, tx pgx.Tx, id int64, status domain.LoanStatus) (*domain.Loan, error) {
	return r.setStatus(ctx, tx, id, status)
}

// statusQuerier is the pgx subset setStatus needs; satisfied by the pool and by
// pgx.Tx.
type statusQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func (r *Repository) setStatus(ctx context.Context, q statusQuerier, id int64, status domain.LoanStatus) (*domain.Loan, error) {
	const query = `
		UPDATE loans SET
			status = $2::text,
			closed_at = CASE WHEN $2::text = 'CLOSED' THEN now() ELSE NULL END,
			updated_at = now()
		WHERE id=$1 AND deleted_at IS NULL
		RETURNING ` + loanColumns
	l, err := scanLoan(q.QueryRow(ctx, query, id, string(status)))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("loan")
	}
	if err != nil {
		return nil, err
	}
	return l, nil
}

// SoftDelete marks a loan deleted; NotFound if missing or already deleted.
func (r *Repository) SoftDelete(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE loans SET deleted_at = now(), updated_at = now()
		 WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.NewNotFound("loan")
	}
	return nil
}

// ── scanning + helpers ──

type rowScanner interface{ Scan(dest ...any) error }

func scanLoan(row rowScanner) (*domain.Loan, error) {
	var l domain.Loan
	var typ, repayMode, status string
	var interest int64
	var principal int64
	var disbursed int64
	var deduction, dailyAmount *int64
	err := row.Scan(
		&l.ID, &l.LoanNumber, &l.CustomerID, &typ, &repayMode, &principal, &l.Rate, &interest,
		&deduction, &disbursed, &dailyAmount, &l.NumDays, &l.LoanDate, &l.NextDueDate, &status,
		&l.Contact, &l.Remarks, &l.VehicleNumber, &l.VehicleBrand, &l.VehicleName,
		&l.CreatedAt, &l.UpdatedAt, &l.ClosedAt,
	)
	if err != nil {
		return nil, err
	}
	l.Type = domain.LoanType(typ)
	l.RepaymentMode = domain.RepaymentMode(repayMode)
	l.Status = domain.LoanStatus(status)
	// Money columns store whole rupees; convert back to internal Paise.
	l.Principal = domain.PaiseFromDBRupees(principal)
	l.Interest = domain.PaiseFromDBRupees(interest)
	l.Disbursed = domain.PaiseFromDBRupees(disbursed)
	if deduction != nil {
		p := domain.PaiseFromDBRupees(*deduction)
		l.Deduction = &p
	}
	if dailyAmount != nil {
		p := domain.PaiseFromDBRupees(*dailyAmount)
		l.DailyAmount = &p
	}
	return &l, nil
}

// ptrPaiseToRupees converts an optional Paise amount to the whole-rupee integer
// stored in the database (nil stays nil for NULL columns).
func ptrPaiseToRupees(p *domain.Paise) *int64 {
	if p == nil {
		return nil
	}
	v := p.DBRupees()
	return &v
}

func nilIfEmpty(s *string) *string {
	if s == nil || strings.TrimSpace(*s) == "" {
		return nil
	}
	t := strings.TrimSpace(*s)
	return &t
}

// translateWriteError maps FK / check violations to friendly errors.
func translateWriteError(err error) error {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "loans_customer_id_fkey"):
		return domain.NewValidation("Selected customer does not exist", map[string]string{"customer_id": "Unknown customer"})
	case strings.Contains(msg, "loans_") && strings.Contains(msg, "check"):
		return domain.NewValidation("Loan details are inconsistent for this type", nil)
	}
	return err
}
