// Package collection implements loan repayment recording (create, list per
// loan, cross-loan daily feed, edit, soft-delete) across repository -> service
// -> handler layers. The collected total is always SUM(amount) from this table
// — never stored denormalised — so the loan's outstanding stays truthful.
package collection

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository provides collection data access. Every query is parameterised and
// excludes soft-deleted rows.
type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// querier is the subset of pgx used by the read/write helpers below. Both
// *pgxpool.Pool and pgx.Tx satisfy it, so the same query code can run either
// standalone or inside a transaction without duplicating SQL.
type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Pool exposes the connection pool so the service can open a transaction that
// spans this repository and the loan repository (recording a payment and
// syncing the loan's status must be one atomic unit).
func (r *Repository) Pool() *pgxpool.Pool { return r.pool }

const collectionColumns = `
	id, receipt_no, loan_id, date, amount, mode, kind, remarks, target_due_date, posted_by, created_at, updated_at`

// Create inserts a payment, minting its RCPT-###### number from the sequence in
// the same statement so the number is allocated atomically. Amount is stored as
// whole rupees (see domain.Paise.DBRupees).
func (r *Repository) Create(ctx context.Context, in domain.CollectionInput, postedBy *int64) (*domain.Collection, error) {
	const query = `
		INSERT INTO collections (receipt_no, loan_id, date, amount, mode, kind, remarks, target_due_date, posted_by, posted_at)
		VALUES ('RCPT-' || nextval('receipt_no_seq'), $1, $2, $3, $4, $5, $6, $7, $8, now())
		RETURNING ` + collectionColumns
	row := r.pool.QueryRow(ctx, query,
		in.LoanID, in.Date, in.Amount.DBRupees(), string(in.Mode), string(in.Kind), nilIfEmpty(in.Remarks), in.TargetDueDate, postedBy)
	c, err := scanCollection(row)
	if err != nil {
		return nil, translateWriteError(err)
	}
	return c, nil
}

// LockLoanForUpdate takes a row lock on the loan inside tx. Everything that
// reads the collected total and then decides something from it (record a
// payment, then set the loan's status) must call this FIRST, so two concurrent
// payments on the same loan serialise instead of both acting on a stale sum.
// Returns NotFound if the loan does not exist or is soft-deleted.
func LockLoanForUpdate(ctx context.Context, tx pgx.Tx, loanID int64) error {
	var id int64
	err := tx.QueryRow(ctx,
		`SELECT id FROM loans WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, loanID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.NewNotFound("loan")
	}
	return err
}

// CreateTx inserts a payment inside tx, recording the client's idempotency key
// when one was supplied.
//
// Idempotency: if a row already exists for (loan_id, idempotency_key) the insert
// is a no-op and the EXISTING row is returned — so a client retry after a
// network timeout can never create a second payment. Without a key the insert
// always proceeds (legacy/unkeyed callers behave exactly as before).
// The second return value reports whether a row was actually INSERTED: false
// means this was a replay and the existing payment is being returned. Callers
// must use it to avoid side effects on a replay — auditing a replay would imply
// several payments where only one exists.
func (r *Repository) CreateTx(ctx context.Context, tx pgx.Tx, in domain.CollectionInput, postedBy *int64, idempotencyKey string) (*domain.Collection, bool, error) {
	if idempotencyKey != "" {
		// A retry of a request that already succeeded: return the original row
		// rather than inserting again.
		if existing, err := r.findByIdempotencyKey(ctx, tx, in.LoanID, idempotencyKey); err != nil {
			return nil, false, err
		} else if existing != nil {
			return existing, false, nil
		}
	}
	const query = `
		INSERT INTO collections (receipt_no, loan_id, date, amount, mode, kind, remarks, target_due_date, posted_by, posted_at, idempotency_key)
		VALUES ('RCPT-' || nextval('receipt_no_seq'), $1, $2, $3, $4, $5, $6, $7, $8, now(), $9)
		RETURNING ` + collectionColumns
	// An empty key must be stored as NULL, not "": the partial unique index
	// ignores NULLs, so unkeyed payments never collide with each other.
	var keyArg *string
	if idempotencyKey != "" {
		keyArg = &idempotencyKey
	}
	row := tx.QueryRow(ctx, query,
		in.LoanID, in.Date, in.Amount.DBRupees(), string(in.Mode), string(in.Kind),
		nilIfEmpty(in.Remarks), in.TargetDueDate, postedBy, keyArg)
	c, err := scanCollection(row)
	if err != nil {
		return nil, false, translateWriteError(err)
	}
	return c, true, nil
}

// findByIdempotencyKey looks for a prior payment recorded under the same key.
// Returns (nil, nil) when there is none.
func (r *Repository) findByIdempotencyKey(ctx context.Context, q querier, loanID int64, key string) (*domain.Collection, error) {
	const query = `
		SELECT ` + collectionColumns + `
		FROM collections
		WHERE loan_id = $1 AND idempotency_key = $2 AND deleted_at IS NULL`
	c, err := scanCollection(q.QueryRow(ctx, query, loanID, key))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return c, nil
}

// SumByLoanTx is SumByLoan inside a transaction (see SumByLoan for the split).
func (r *Repository) SumByLoanTx(ctx context.Context, tx pgx.Tx, loanID int64) (domain.Collected, error) {
	return r.sumByLoan(ctx, tx, loanID)
}

// FindByID returns a non-deleted collection or a NotFound error.
func (r *Repository) FindByID(ctx context.Context, id int64) (*domain.Collection, error) {
	const query = `SELECT ` + collectionColumns + ` FROM collections WHERE id = $1 AND deleted_at IS NULL`
	c, err := scanCollection(r.pool.QueryRow(ctx, query, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("collection")
	}
	if err != nil {
		return nil, err
	}
	return c, nil
}

// ListByLoan returns every payment for a loan, newest first (the ledger).
func (r *Repository) ListByLoan(ctx context.Context, loanID int64) ([]*domain.Collection, error) {
	const query = `SELECT ` + collectionColumns + `
		FROM collections WHERE loan_id = $1 AND deleted_at IS NULL
		ORDER BY date DESC, id DESC`
	return r.queryList(ctx, query, loanID)
}

// ListByDate returns every payment recorded on a given calendar day across all
// loans (the daily collection feed). An zero date returns the most recent
// payments overall.
func (r *Repository) ListByDate(ctx context.Context, date string, limit int) ([]*domain.Collection, error) {
	if date != "" {
		const q = `SELECT ` + collectionColumns + `
			FROM collections WHERE date = $1 AND deleted_at IS NULL
			ORDER BY id DESC LIMIT $2`
		return r.queryList(ctx, q, date, limit)
	}
	const q = `SELECT ` + collectionColumns + `
		FROM collections WHERE deleted_at IS NULL
		ORDER BY date DESC, id DESC LIMIT $1`
	return r.queryList(ctx, q, limit)
}

// RangeParams filters the cross-loan feed by an inclusive date range with
// pagination. Empty From/To mean unbounded on that side.
type RangeParams struct {
	From   string // '' = no lower bound (YYYY-MM-DD)
	To     string // '' = no upper bound (YYYY-MM-DD)
	Limit  int
	Offset int
}

// ListRange returns a page of payments across all loans within [From, To],
// newest first, plus the total matching count (for pagination). This backs the
// Reports export, which needs an authoritative server-side date filter.
func (r *Repository) ListRange(ctx context.Context, p RangeParams) ([]*domain.Collection, int64, error) {
	where := "WHERE deleted_at IS NULL"
	args := []any{}
	if p.From != "" {
		args = append(args, p.From)
		where += fmt.Sprintf(" AND date >= $%d", len(args))
	}
	if p.To != "" {
		args = append(args, p.To)
		where += fmt.Sprintf(" AND date <= $%d", len(args))
	}

	var total int64
	if err := r.pool.QueryRow(ctx, "SELECT count(*) FROM collections "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, p.Limit, p.Offset)
	query := fmt.Sprintf(`SELECT %s FROM collections %s ORDER BY date DESC, id DESC LIMIT $%d OFFSET $%d`,
		collectionColumns, where, len(args)-1, len(args))
	items, err := r.queryList(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// SumByLoan returns the collected total for a single loan, split into interest
// and principal buckets (so interest-only loans can settle principal separately).
func (r *Repository) SumByLoan(ctx context.Context, loanID int64) (domain.Collected, error) {
	return r.sumByLoan(ctx, r.pool, loanID)
}

// sumByLoan holds the query so it can run on the pool or inside a transaction
// (see SumByLoanTx) without the SQL being written twice.
func (r *Repository) sumByLoan(ctx context.Context, q querier, loanID int64) (domain.Collected, error) {
	var interest, principal int64
	err := q.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(amount) FILTER (WHERE kind = 'INTEREST'), 0),
			COALESCE(SUM(amount) FILTER (WHERE kind = 'PRINCIPAL'), 0)
		FROM collections WHERE loan_id = $1 AND deleted_at IS NULL`, loanID).
		Scan(&interest, &principal)
	if err != nil {
		return domain.Collected{}, err
	}
	return domain.Collected{
		Interest:  domain.PaiseFromDBRupees(interest),
		Principal: domain.PaiseFromDBRupees(principal),
	}, nil
}

// SumByLoans returns split collected totals keyed by loan ID for the given
// loans, in one round-trip — used to render outstanding across a loan list
// without an N+1 query.
func (r *Repository) SumByLoans(ctx context.Context, loanIDs []int64) (map[int64]domain.Collected, error) {
	out := make(map[int64]domain.Collected, len(loanIDs))
	if len(loanIDs) == 0 {
		return out, nil
	}
	rows, err := r.pool.Query(ctx, `
		SELECT loan_id,
			COALESCE(SUM(amount) FILTER (WHERE kind = 'INTEREST'), 0),
			COALESCE(SUM(amount) FILTER (WHERE kind = 'PRINCIPAL'), 0)
		FROM collections WHERE loan_id = ANY($1) AND deleted_at IS NULL
		GROUP BY loan_id`, loanIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, interest, principal int64
		if err := rows.Scan(&id, &interest, &principal); err != nil {
			return nil, err
		}
		out[id] = domain.Collected{
			Interest:  domain.PaiseFromDBRupees(interest),
			Principal: domain.PaiseFromDBRupees(principal),
		}
	}
	return out, rows.Err()
}

// Update rewrites an existing payment's editable fields (loan_id is immutable).
func (r *Repository) Update(ctx context.Context, id int64, in domain.CollectionInput) (*domain.Collection, error) {
	const query = `
		UPDATE collections SET
			date = $2, amount = $3, mode = $4, kind = $5, remarks = $6, updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING ` + collectionColumns
	c, err := scanCollection(r.pool.QueryRow(ctx, query,
		id, in.Date, in.Amount.DBRupees(), string(in.Mode), string(in.Kind), nilIfEmpty(in.Remarks)))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("collection")
	}
	if err != nil {
		return nil, translateWriteError(err)
	}
	return c, nil
}

// SoftDelete marks a payment deleted; NotFound if missing or already deleted.
func (r *Repository) SoftDelete(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE collections SET deleted_at = now(), updated_at = now()
		 WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.NewNotFound("collection")
	}
	return nil
}

// SoftDeleteTx is SoftDelete inside a caller's transaction, so a delete can
// commit atomically with the writes that replace it. Scoped by loan_id as well
// as id: a batch replace must never touch a record belonging to another loan,
// even if a stale/forged id is supplied.
func (r *Repository) SoftDeleteTx(ctx context.Context, tx pgx.Tx, loanID, id int64) error {
	tag, err := tx.Exec(ctx,
		`UPDATE collections SET deleted_at = now(), updated_at = now()
		 WHERE id = $1 AND loan_id = $2 AND deleted_at IS NULL`, id, loanID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.NewNotFound("collection")
	}
	return nil
}

// ── scanning + helpers ──

type rowScanner interface{ Scan(dest ...any) error }

func (r *Repository) queryList(ctx context.Context, query string, args ...any) ([]*domain.Collection, error) {
	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*domain.Collection
	for rows.Next() {
		c, err := scanCollection(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func scanCollection(row rowScanner) (*domain.Collection, error) {
	var c domain.Collection
	var mode, kind string
	var amount int64
	err := row.Scan(
		&c.ID, &c.ReceiptNo, &c.LoanID, &c.Date, &amount, &mode, &kind,
		&c.Remarks, &c.TargetDueDate, &c.PostedBy, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	c.Mode = domain.PayMode(mode)
	c.Kind = domain.CollectionKind(kind)
	c.Amount = domain.PaiseFromDBRupees(amount)
	return &c, nil
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
	case strings.Contains(msg, "collections_loan_id_fkey"):
		return domain.NewValidation("Loan does not exist", map[string]string{"loan_id": "Unknown loan"})
	case strings.Contains(msg, "collections_amount_positive"):
		return domain.NewValidation("Amount must be greater than 0", map[string]string{"amount": "Too small"})
	case strings.Contains(msg, "collections_mode_valid"):
		return domain.NewValidation("Invalid payment mode", map[string]string{"mode": "Unknown mode"})
	case strings.Contains(msg, "is already funded"):
		// The 0006 trigger: this write would fund a schedule slot beyond its
		// instalment — the signature of a collection sheet entered twice.
		// Without this case it surfaced as a raw 500 "internal error", which
		// told the operator nothing and logged a real guard as a crash.
		return domain.NewValidation(
			"This instalment is already paid — recording it again would duplicate the collection",
			map[string]string{"amount": "Day already funded; check this is not a repeat entry"},
		)
	}
	return err
}
