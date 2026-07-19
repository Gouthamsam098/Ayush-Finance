// Package customer implements customer management (create, read, list,
// update, soft-delete) across repository -> service -> handler layers.
package customer

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository provides customer data access. Every query is parameterised.
// Soft-deleted rows (deleted_at IS NOT NULL) are excluded from all reads.
type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// ListParams controls pagination and filtering for List. Values are validated
// by the service before reaching here.
type ListParams struct {
	Limit  int
	Offset int
	Search string
}

const customerColumns = `
	id, code, name, father_name, mobile, alt_mobile, email, date_of_birth,
	address, city, state, pincode, occupation, monthly_income, reference_name,
	reference_mobile, aadhaar_number, pan_number, created_at, updated_at`

// Create inserts a customer, minting its CUST-#### code from the dedicated
// sequence in the same statement so the code is allocated atomically.
func (r *Repository) Create(ctx context.Context, in domain.CustomerInput) (*domain.Customer, error) {
	// date_of_birth is a DATE column; $6 is bound as text and cast so we keep
	// the string-based date convention end to end (no UTC shifting).
	const query = `
		INSERT INTO customers (
			code, name, father_name, mobile, alt_mobile, email, date_of_birth,
			address, city, state, pincode, occupation, monthly_income,
			reference_name, reference_mobile, aadhaar_number, pan_number
		) VALUES (
			'CUST-' || nextval('customer_code_seq'),
			$1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
		)
		RETURNING ` + customerColumns

	row := r.pool.QueryRow(ctx, query, createArgs(in)...)
	c, err := scanCustomer(row)
	if err != nil {
		return nil, translateWriteError(err)
	}
	return c, nil
}

// createArgs / updateArgs build the positional argument lists shared shape.
// Empty optional strings are normalised to NULL so blank inputs don't trip
// unique indexes or format checks.
func createArgs(in domain.CustomerInput) []any {
	var monthlyIncome *int64
	if in.MonthlyIncome != nil {
		v := in.MonthlyIncome.DBRupees()
		monthlyIncome = &v
	}
	return []any{
		in.Name, in.FatherName, in.Mobile, in.AltMobile, nilIfEmpty(in.Email),
		nilIfEmpty(in.DateOfBirth), in.Address, in.City, in.State, in.Pincode,
		in.Occupation, monthlyIncome, in.ReferenceName, in.ReferenceMobile,
		nilIfEmpty(in.AadhaarNumber), nilIfEmpty(in.PANNumber),
	}
}

func nilIfEmpty(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	return s
}

// FindByID returns a non-deleted customer or a NotFound error.
func (r *Repository) FindByID(ctx context.Context, id int64) (*domain.Customer, error) {
	const query = `SELECT ` + customerColumns + `
		FROM customers WHERE id = $1 AND deleted_at IS NULL`

	c, err := scanCustomer(r.pool.QueryRow(ctx, query, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("customer")
	}
	if err != nil {
		return nil, err
	}
	return c, nil
}

// List returns a page of customers and the total count matching the filter.
func (r *Repository) List(ctx context.Context, p ListParams) ([]*domain.Customer, int64, error) {
	where := "WHERE deleted_at IS NULL"
	args := []any{}
	if p.Search != "" {
		// Case-insensitive match across name, mobile, and code. The pattern is
		// bound as a parameter, so the wildcard never enables injection.
		args = append(args, "%"+strings.ToLower(p.Search)+"%")
		where += fmt.Sprintf(" AND (lower(name) LIKE $%d OR mobile LIKE $%d OR lower(code) LIKE $%d)",
			len(args), len(args), len(args))
	}

	var total int64
	if err := r.pool.QueryRow(ctx, "SELECT count(*) FROM customers "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, p.Limit, p.Offset)
	query := fmt.Sprintf(`SELECT %s FROM customers %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d`,
		customerColumns, where, len(args)-1, len(args))

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var customers []*domain.Customer
	for rows.Next() {
		c, err := scanCustomer(rows)
		if err != nil {
			return nil, 0, err
		}
		customers = append(customers, c)
	}
	return customers, total, rows.Err()
}

// Update applies the input to an existing customer and returns the updated
// row, or a NotFound error if it does not exist (or is soft-deleted).
func (r *Repository) Update(ctx context.Context, id int64, in domain.CustomerInput) (*domain.Customer, error) {
	const query = `
		UPDATE customers SET
			name=$2, father_name=$3, mobile=$4, alt_mobile=$5, email=$6,
			date_of_birth=$7::date, address=$8, city=$9, state=$10, pincode=$11,
			occupation=$12, monthly_income=$13, reference_name=$14,
			reference_mobile=$15, aadhaar_number=$16, pan_number=$17,
			updated_at=now()
		WHERE id=$1 AND deleted_at IS NULL
		RETURNING ` + customerColumns

	args := append([]any{id}, createArgs(in)...)
	row := r.pool.QueryRow(ctx, query, args...)
	c, err := scanCustomer(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("customer")
	}
	if err != nil {
		return nil, translateWriteError(err)
	}
	return c, nil
}

// SoftDelete marks a customer deleted. It returns NotFound if the customer
// does not exist or was already deleted.
func (r *Repository) SoftDelete(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE customers SET deleted_at = now(), updated_at = now()
		 WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.NewNotFound("customer")
	}
	return nil
}

// rowScanner abstracts pgx.Row and pgx.Rows for a shared scan helper.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanCustomer(row rowScanner) (*domain.Customer, error) {
	var c domain.Customer
	var monthlyIncome *int64
	var dob *time.Time // DATE column scans into time.Time
	err := row.Scan(
		&c.ID, &c.Code, &c.Name, &c.FatherName, &c.Mobile, &c.AltMobile,
		&c.Email, &dob, &c.Address, &c.City, &c.State, &c.Pincode,
		&c.Occupation, &monthlyIncome, &c.ReferenceName, &c.ReferenceMobile,
		&c.AadhaarNumber, &c.PANNumber, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if monthlyIncome != nil {
		p := domain.PaiseFromDBRupees(*monthlyIncome)
		c.MonthlyIncome = &p
	}
	if dob != nil {
		s := dob.Format("2006-01-02")
		c.DateOfBirth = &s
	}
	return &c, nil
}

// translateWriteError maps unique-violations to friendly conflict errors. Any
// other error is returned unchanged for the handler to treat as internal (and
// log without exposing DB detail — and never the KYC values themselves).
func translateWriteError(err error) error {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "idx_customers_mobile_active"):
		return domain.NewConflict("a customer with this mobile number already exists")
	case strings.Contains(msg, "idx_customers_pan_active"):
		return domain.NewConflict("a customer with this PAN already exists")
	case strings.Contains(msg, "idx_customers_aadhaar_active"):
		return domain.NewConflict("a customer with this Aadhaar already exists")
	}
	return err
}
