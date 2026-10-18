// Package paymentproof stores customer portal payment screenshots and turns an
// accepted one into collections, across repository -> service -> handler.
package paymentproof

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository provides payment-proof data access. Every read hides proofs whose
// loan or customer has been deleted, so they vanish with the record they belong
// to. All queries are parameterised.
type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// Pool exposes the pool so the service can run the accept flow in one tx.
func (r *Repository) Pool() *pgxpool.Pool { return r.pool }

// proofColumns never includes the image bytes.
const proofColumns = `
	p.id, p.loan_id, l.loan_number, p.customer_id, p.amount, p.purpose, p.file_name,
	p.mime_type, p.size_bytes, p.status, p.submitted_at, p.reviewed_at, p.receipt_date`

const liveJoin = `
	FROM payment_proofs p
	JOIN loans l ON l.id = p.loan_id AND l.deleted_at IS NULL
	JOIN customers c ON c.id = p.customer_id AND c.deleted_at IS NULL
	WHERE p.deleted_at IS NULL`

// maxListed caps a list response. Pending proofs come first, so a long history
// can never push an unreviewed one out of view.
const maxListed = 500

type rowScanner interface{ Scan(dest ...any) error }

func scanProof(row rowScanner, extra ...any) (*domain.PaymentProof, error) {
	var p domain.PaymentProof
	var amount int64
	var purpose, status string
	dest := []any{&p.ID, &p.LoanID, &p.LoanNumber, &p.CustomerID, &amount, &purpose, &p.FileName,
		&p.MimeType, &p.SizeBytes, &status, &p.SubmittedAt, &p.ReviewedAt, &p.ReceiptDate}
	if err := row.Scan(append(dest, extra...)...); err != nil {
		return nil, err
	}
	p.Amount = domain.PaiseFromDBRupees(amount)
	p.Purpose = domain.PaymentPurpose(purpose)
	p.Status = domain.PaymentProofStatus(status)
	return &p, nil
}

// LoanStatusForCustomer returns the status of a live loan that belongs to the
// customer, or NotFound — a borrower can only ever address their own loans.
func (r *Repository) LoanStatusForCustomer(ctx context.Context, loanID, customerID int64) (domain.LoanStatus, error) {
	var status string
	err := r.pool.QueryRow(ctx,
		`SELECT status FROM loans WHERE id = $1 AND customer_id = $2 AND deleted_at IS NULL`,
		loanID, customerID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", domain.NewNotFound("loan")
	}
	return domain.LoanStatus(status), err
}

// CountPending counts unreviewed proofs on a loan.
func (r *Repository) CountPending(ctx context.Context, loanID int64) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM payment_proofs WHERE loan_id = $1 AND status = 'PENDING' AND deleted_at IS NULL`,
		loanID).Scan(&n)
	return n, err
}

// Create stores a new PENDING proof and returns it.
func (r *Repository) Create(ctx context.Context, customerID int64, in domain.PaymentProofInput,
	fileName, mime string, content []byte, submittedBy *int64,
) (*domain.PaymentProof, error) {
	var id int64
	err := r.pool.QueryRow(ctx, `
		INSERT INTO payment_proofs (loan_id, customer_id, amount, purpose, file_name, mime_type, size_bytes, content, submitted_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id`,
		in.LoanID, customerID, in.Amount.DBRupees(), string(in.Purpose), fileName, mime,
		len(content), content, submittedBy).Scan(&id)
	if err != nil {
		return nil, err
	}
	return r.FindByID(ctx, id, &customerID)
}

// FindByID returns one proof. With customerID set, only that customer's proof
// is visible (NotFound otherwise — never "forbidden", which would confirm the
// id exists).
func (r *Repository) FindByID(ctx context.Context, id int64, customerID *int64) (*domain.PaymentProof, error) {
	q := `SELECT ` + proofColumns + liveJoin + ` AND p.id = $1 AND ($2::bigint IS NULL OR p.customer_id = $2)`
	p, err := scanProof(r.pool.QueryRow(ctx, q, id, customerID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("payment proof")
	}
	return p, err
}

// List returns proofs newest first, pending ones ahead of reviewed ones. With
// customerID set, only that customer's.
func (r *Repository) List(ctx context.Context, customerID *int64) ([]*domain.PaymentProof, error) {
	q := `SELECT ` + proofColumns + liveJoin + ` AND ($1::bigint IS NULL OR p.customer_id = $1)
		ORDER BY (p.status = 'PENDING') DESC, p.submitted_at DESC, p.id DESC
		LIMIT $2`
	rows, err := r.pool.Query(ctx, q, customerID, maxListed)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*domain.PaymentProof{}
	for rows.Next() {
		p, err := scanProof(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Image returns the screenshot bytes (scoped like FindByID).
func (r *Repository) Image(ctx context.Context, id int64, customerID *int64) (*domain.PaymentProof, error) {
	q := `SELECT ` + proofColumns + `, p.content` + liveJoin + ` AND p.id = $1 AND ($2::bigint IS NULL OR p.customer_id = $2)`
	var content []byte
	p, err := scanProof(r.pool.QueryRow(ctx, q, id, customerID), &content)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("payment proof")
	}
	if err != nil {
		return nil, err
	}
	p.Content = content
	return p, nil
}

// LockedProof is a row-locked proof plus what accepting it needs: the loan date
// (for the receipt date) and who paid (for "Collected by").
type LockedProof struct {
	Proof        *domain.PaymentProof
	LoanDate     time.Time
	CustomerName string
	SubmittedBy  *int64
}

// LockTx loads a proof and row-locks it inside tx. Two staff accepting the same
// proof at once serialise here: the second sees VERIFIED and records nothing.
func (r *Repository) LockTx(ctx context.Context, tx pgx.Tx, id int64) (*LockedProof, error) {
	q := `SELECT ` + proofColumns + `, l.loan_date, c.name, p.submitted_by` + liveJoin + ` AND p.id = $1 FOR UPDATE OF p`
	var out LockedProof
	p, err := scanProof(tx.QueryRow(ctx, q, id), &out.LoanDate, &out.CustomerName, &out.SubmittedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("payment proof")
	}
	if err != nil {
		return nil, err
	}
	out.Proof = p
	return &out, nil
}

// MarkVerifiedTx flips a locked PENDING proof to VERIFIED.
func (r *Repository) MarkVerifiedTx(ctx context.Context, tx pgx.Tx, id int64, reviewer *int64, receiptDate time.Time) error {
	tag, err := tx.Exec(ctx, `
		UPDATE payment_proofs
		SET status = 'VERIFIED', reviewed_by = $2, reviewed_at = now(), receipt_date = $3
		WHERE id = $1 AND status = 'PENDING' AND deleted_at IS NULL`, id, reviewer, receiptDate)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.NewConflict("This payment proof was already reviewed")
	}
	return nil
}

// Reject flips a PENDING proof to REJECTED. Returns false when the proof was not
// pending (already reviewed), so the service can report the real state.
func (r *Repository) Reject(ctx context.Context, id int64, reviewer *int64) (bool, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE payment_proofs SET status = 'REJECTED', reviewed_by = $2, reviewed_at = now()
		WHERE id = $1 AND status = 'PENDING' AND deleted_at IS NULL
		  AND loan_id IN (SELECT id FROM loans WHERE deleted_at IS NULL)`, id, reviewer)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// isCheckViolation reports a DB CHECK failure on the proofs table (defence in
// depth behind the service's own validation).
func isCheckViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "payment_proofs_")
}
