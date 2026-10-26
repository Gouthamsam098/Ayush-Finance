// Package paymentproof stores customer portal payment screenshots and turns an
// accepted one into collections, across repository -> service -> handler.
package paymentproof

import (
	"context"
	"crypto/sha256"
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

// proofColumns never includes the image bytes. Queries using it must join
// recovery_submissions as rs (see claimJoin).
const proofColumns = `
	p.id, p.loan_id, l.loan_number, p.customer_id, p.amount, p.purpose, p.file_name,
	p.mime_type, p.size_bytes, p.status, p.submitted_at, p.reviewed_at, p.receipt_date,
	p.claim_id, COALESCE(rs.status, '')`

// claimJoin brings in the status of the claim a recovery agent's screenshot
// is attached to.
const claimJoin = `
	LEFT JOIN recovery_submissions rs ON rs.id = p.claim_id`

const liveJoin = `
	FROM payment_proofs p
	JOIN loans l ON l.id = p.loan_id AND l.deleted_at IS NULL
	JOIN customers c ON c.id = p.customer_id AND c.deleted_at IS NULL` + claimJoin + `
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
		&p.MimeType, &p.SizeBytes, &status, &p.SubmittedAt, &p.ReviewedAt, &p.ReceiptDate,
		&p.ClaimID, &p.ClaimStatus}
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

// CustomerForAssignedLoan returns the borrower for a loan assigned to the agent.
func (r *Repository) CustomerForAssignedLoan(ctx context.Context, loanID, agentID int64) (int64, domain.LoanStatus, error) {
	var customerID int64
	var st string
	err := r.pool.QueryRow(ctx, `
		SELECT l.customer_id, l.status
		FROM loans l
		JOIN loan_assignments a ON a.loan_id = l.id AND a.agent_user_id = $2
		WHERE l.id = $1 AND l.deleted_at IS NULL`, loanID, agentID).Scan(&customerID, &st)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, "", domain.NewNotFound("loan")
	}
	if err != nil {
		return 0, "", err
	}
	return customerID, domain.LoanStatus(st), nil
}

// An agent sees proofs on the loans assigned to them, plus every screenshot they
// uploaded themselves (their activity history keeps those after a fully paid
// loan is released from them).
const agentProofScope = `
	AND (p.submitted_by = $1 OR EXISTS (
		SELECT 1 FROM loan_assignments a
		WHERE a.loan_id = p.loan_id AND a.agent_user_id = $1
	))`

// ListForAgent returns proofs on loans assigned to the recovery agent, and the
// agent's own uploads.
func (r *Repository) ListForAgent(ctx context.Context, agentID int64) ([]*domain.PaymentProof, error) {
	q := `SELECT ` + proofColumns + liveJoin + agentProofScope + `
		ORDER BY (p.status = 'PENDING') DESC, p.submitted_at DESC, p.id DESC
		LIMIT $2`
	rows, err := r.pool.Query(ctx, q, agentID, maxListed)
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

// AgentCanAccessProof reports whether the agent may see the proof: it is on a
// loan assigned to them, or they uploaded it.
func (r *Repository) AgentCanAccessProof(ctx context.Context, proofID, agentID int64) (bool, error) {
	var ok bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM payment_proofs p
			WHERE p.id = $1 AND p.deleted_at IS NULL AND (p.submitted_by = $2 OR EXISTS (
				SELECT 1 FROM loan_assignments a WHERE a.loan_id = p.loan_id AND a.agent_user_id = $2
			))
		)`, proofID, agentID).Scan(&ok)
	return ok, err
}

// CountPending counts unreviewed proofs on a loan.
func (r *Repository) CountPending(ctx context.Context, loanID int64) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM payment_proofs WHERE loan_id = $1 AND status = 'PENDING' AND deleted_at IS NULL`,
		loanID).Scan(&n)
	return n, err
}

// ClaimLink attaches a recovery agent's screenshot to their collection claim.
type ClaimLink struct {
	ClaimID int64
	AgentID int64
}

// PendingClaimForAgent returns the agent's collection claim awaiting approval
// on the loan, or nil when there is none.
func (r *Repository) PendingClaimForAgent(ctx context.Context, loanID, agentID int64) (*int64, error) {
	var id int64
	err := r.pool.QueryRow(ctx, `
		SELECT id FROM recovery_submissions
		WHERE loan_id = $1 AND agent_user_id = $2 AND type = 'COLLECTION_CLAIM'
		  AND status = 'PENDING' AND deleted_at IS NULL`, loanID, agentID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

// lockClaimForUploadTx row-locks the claim a screenshot is being attached to and
// checks it can take one. Returns the claim's amount: the screenshot proves
// that amount, whatever the client sent.
func lockClaimForUploadTx(ctx context.Context, tx pgx.Tx, link ClaimLink, loanID int64) (domain.Paise, error) {
	var status string
	var claimLoan, agent, amount int64
	err := tx.QueryRow(ctx, `
		SELECT status, loan_id, agent_user_id, amount FROM recovery_submissions
		WHERE id = $1 AND type = 'COLLECTION_CLAIM' AND deleted_at IS NULL
		FOR UPDATE`, link.ClaimID).Scan(&status, &claimLoan, &agent, &amount)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && agent != link.AgentID) {
		return 0, domain.NewNotFound("collection")
	}
	if err != nil {
		return 0, err
	}
	if claimLoan != loanID {
		return 0, domain.NewValidation("This collection belongs to a different loan",
			map[string]string{"claim_id": "Belongs to a different loan"})
	}
	if status == domain.ClaimRejected {
		return 0, domain.NewConflict("This collection was rejected. Submit the payment again with Collect.")
	}
	var open string
	err = tx.QueryRow(ctx, `
		SELECT status FROM payment_proofs
		WHERE claim_id = $1 AND deleted_at IS NULL AND status IN ('PENDING', 'VERIFIED')
		ORDER BY (status = 'VERIFIED') DESC
		LIMIT 1`, link.ClaimID).Scan(&open)
	switch {
	case err == nil && open == string(domain.ProofVerified):
		return 0, domain.NewConflict("The screenshot for this collection was already accepted.")
	case err == nil:
		return 0, domain.NewConflict("A screenshot for this collection is already awaiting review.")
	case !errors.Is(err, pgx.ErrNoRows):
		return 0, err
	}
	return domain.PaiseFromDBRupees(amount), nil
}

// Create stores a new PENDING proof and returns it. With link set, the proof is
// a recovery agent's screenshot for that claim (evidence: the claim, not the
// screenshot, records the money) and carries the claim's amount.
//
// The same screenshot already PENDING or VERIFIED on this loan is the same
// payment, so it is refused (a REJECTED one may be sent again). Each copy used
// to become its own proof, and accepting both recorded one payment twice. The
// loan row is locked for the check-and-insert, so two simultaneous uploads run
// one after the other and the second sees the first.
//
// Lock order is claim → loan → proof, the same as approving a claim
// (recovery.Service.Approve), so the two can never deadlock.
func (r *Repository) Create(ctx context.Context, customerID int64, in domain.PaymentProofInput,
	fileName, mime string, content []byte, submittedBy *int64, link *ClaimLink,
) (*domain.PaymentProof, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var claimID *int64
	if link != nil {
		amount, err := lockClaimForUploadTx(ctx, tx, *link, in.LoanID)
		if err != nil {
			return nil, err
		}
		in.Amount = amount
		claimID = &link.ClaimID
	}

	if _, err := tx.Exec(ctx, `SELECT 1 FROM loans WHERE id = $1 FOR UPDATE`, in.LoanID); err != nil {
		return nil, err
	}
	// The pending cap, re-checked under the loan lock: the services' earlier
	// count is a friendly fast path, but parallel uploads could each pass it.
	var pending int
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM payment_proofs WHERE loan_id = $1 AND status = 'PENDING' AND deleted_at IS NULL`,
		in.LoanID).Scan(&pending); err != nil {
		return nil, err
	}
	if pending >= domain.MaxPendingProofsPerLoan {
		return nil, domain.NewConflict("This loan already has payments awaiting approval. Please wait for them to be reviewed.")
	}
	digest := sha256.Sum256(content)
	var dup string
	err = tx.QueryRow(ctx, `
		SELECT status FROM payment_proofs
		WHERE loan_id = $1 AND content_sha256 = $2 AND deleted_at IS NULL
		  AND status IN ('PENDING', 'VERIFIED')
		ORDER BY (status = 'VERIFIED') DESC
		LIMIT 1`, in.LoanID, digest[:]).Scan(&dup)
	switch {
	case err == nil && dup == "VERIFIED":
		return nil, domain.NewConflict("This screenshot was already accepted for this loan. Upload the receipt of the new payment.")
	case err == nil:
		return nil, domain.NewConflict("This screenshot is already awaiting approval on this loan.")
	case !errors.Is(err, pgx.ErrNoRows):
		return nil, err
	}

	var id int64
	err = tx.QueryRow(ctx, `
		INSERT INTO payment_proofs (loan_id, customer_id, amount, purpose, file_name, mime_type, size_bytes, content, content_sha256, submitted_by, claim_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id`,
		in.LoanID, customerID, in.Amount.DBRupees(), string(in.Purpose), fileName, mime,
		len(content), content, digest[:], submittedBy, claimID).Scan(&id)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
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
	q := `SELECT ` + proofColumns + `, COALESCE(u.full_name, ''), COALESCE(u.role, '')
		FROM payment_proofs p
		JOIN loans l ON l.id = p.loan_id AND l.deleted_at IS NULL
		JOIN customers c ON c.id = p.customer_id AND c.deleted_at IS NULL` + claimJoin + `
		LEFT JOIN users u ON u.id = p.submitted_by AND u.deleted_at IS NULL
		WHERE p.deleted_at IS NULL AND ($1::bigint IS NULL OR p.customer_id = $1)
		ORDER BY (p.status = 'PENDING') DESC, p.submitted_at DESC, p.id DESC
		LIMIT $2`
	rows, err := r.pool.Query(ctx, q, customerID, maxListed)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*domain.PaymentProof{}
	for rows.Next() {
		var submitterName, submitterRole string
		p, err := scanProof(rows, &submitterName, &submitterRole)
		if err != nil {
			return nil, err
		}
		p.SubmitterName = submitterName
		p.SubmitterRole = domain.Role(submitterRole)
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
	Proof         *domain.PaymentProof
	LoanDate      time.Time
	CustomerName  string
	SubmittedBy   *int64
	SubmitterRole domain.Role
}

// LockTx loads a proof and row-locks it inside tx. Two staff accepting the same
// proof at once serialise here: the second sees VERIFIED and records nothing.
func (r *Repository) LockTx(ctx context.Context, tx pgx.Tx, id int64) (*LockedProof, error) {
	q := `SELECT ` + proofColumns + `, l.loan_date, c.name, p.submitted_by,
		COALESCE((SELECT u.role FROM users u WHERE u.id = p.submitted_by), '')` +
		liveJoin + ` AND p.id = $1 FOR UPDATE OF p`
	var out LockedProof
	var role string
	p, err := scanProof(tx.QueryRow(ctx, q, id), &out.LoanDate, &out.CustomerName, &out.SubmittedBy, &role)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("payment proof")
	}
	if err != nil {
		return nil, err
	}
	out.Proof = p
	out.SubmitterRole = domain.Role(role)
	return &out, nil
}

// ClaimIDOf returns the claim a proof is attached to (nil when none). The link
// is set on upload and never changes, so it is safe to read before locking.
func (r *Repository) ClaimIDOf(ctx context.Context, proofID int64) (*int64, error) {
	var claimID *int64
	err := r.pool.QueryRow(ctx,
		`SELECT claim_id FROM payment_proofs WHERE id = $1 AND deleted_at IS NULL`, proofID).Scan(&claimID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("payment proof")
	}
	return claimID, err
}

// LockedClaim is the part of a collection claim reviewing its screenshot needs.
type LockedClaim struct {
	Status      string
	ReceiptDate time.Time
	Amount      domain.Paise
	AgentName   string
}

// LockClaimTx row-locks a collection claim inside tx.
func (r *Repository) LockClaimTx(ctx context.Context, tx pgx.Tx, claimID int64) (*LockedClaim, error) {
	var out LockedClaim
	var amount int64
	err := tx.QueryRow(ctx, `
		SELECT s.status, s.receipt_date, s.amount, u.full_name
		FROM recovery_submissions s JOIN users u ON u.id = s.agent_user_id
		WHERE s.id = $1 AND s.type = 'COLLECTION_CLAIM'
		FOR UPDATE OF s`, claimID).Scan(&out.Status, &out.ReceiptDate, &amount, &out.AgentName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("collection")
	}
	if err != nil {
		return nil, err
	}
	out.Amount = domain.PaiseFromDBRupees(amount)
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
