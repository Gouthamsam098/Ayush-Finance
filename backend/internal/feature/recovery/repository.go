// Package recovery implements field recovery: loan assignments to recovery
// agents (manual and the daily auto-assign), agents' collection claims and
// promises to pay, and staff review of claims, across repository -> service ->
// handler layers.
package recovery

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository provides recovery data access. All queries are parameterised.
type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// Pool exposes the pool for the service's transactions.
func (r *Repository) Pool() *pgxpool.Pool { return r.pool }

// ── agents & assignments ─────────────────────────────────────────────────────

// Agent is a recovery agent as other screens need to see them.
type Agent struct {
	ID       int64
	Name     string
	Email    string
	IsActive bool
}

// Agents lists every non-deleted recovery agent.
func (r *Repository) Agents(ctx context.Context) ([]Agent, error) {
	rows, err := r.pool.Query(ctx, `SELECT id, full_name, email, is_active FROM users
		WHERE role = 'RECOVERY_AGENT' AND deleted_at IS NULL ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Agent
	for rows.Next() {
		var a Agent
		if err := rows.Scan(&a.ID, &a.Name, &a.Email, &a.IsActive); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// Assignment is one loan → agent link.
type Assignment struct {
	LoanID  int64
	AgentID int64
	Source  string
}

// Assignments returns every assignment of a live loan to a non-deleted agent.
func (r *Repository) Assignments(ctx context.Context) ([]Assignment, error) {
	rows, err := r.pool.Query(ctx, `SELECT a.loan_id, a.agent_user_id, a.source
		FROM loan_assignments a
		JOIN loans l ON l.id = a.loan_id AND l.deleted_at IS NULL
		JOIN users u ON u.id = a.agent_user_id AND u.deleted_at IS NULL
		ORDER BY a.loan_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Assignment
	for rows.Next() {
		var a Assignment
		if err := rows.Scan(&a.LoanID, &a.AgentID, &a.Source); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// IsAssigned reports whether a live loan is assigned to the agent.
func (r *Repository) IsAssigned(ctx context.Context, loanID, agentID int64) (bool, error) {
	var ok bool
	err := r.pool.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM loan_assignments a JOIN loans l ON l.id = a.loan_id
		WHERE a.loan_id = $1 AND a.agent_user_id = $2 AND l.deleted_at IS NULL)`, loanID, agentID).Scan(&ok)
	return ok, err
}

// ReplaceForAgentTx makes loanIDs exactly the agent's manual assignment set: a
// listed loan held by another agent moves to this one (one agent per loan, as
// the Settings picker does); this agent's other loans are released. Unknown or
// deleted loan ids are a validation error.
func ReplaceForAgentTx(ctx context.Context, tx pgx.Tx, agentID int64, loanIDs []int64, by *int64) error {
	ids := uniqueIDs(loanIDs)
	if len(ids) > 0 {
		var live int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM loans WHERE id = ANY($1) AND deleted_at IS NULL`, ids).Scan(&live); err != nil {
			return err
		}
		if live != len(ids) {
			return domain.NewValidation("Some selected loans no longer exist", map[string]string{"assigned_loan_ids": "Refresh and select again"})
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM loan_assignments WHERE agent_user_id = $1 AND NOT (loan_id = ANY($2))`, agentID, ids); err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO loan_assignments (loan_id, agent_user_id, source, assigned_by)
		SELECT unnest($1::bigint[]), $2, 'MANUAL', $3
		ON CONFLICT (loan_id) DO UPDATE
		SET agent_user_id = EXCLUDED.agent_user_id, source = 'MANUAL',
		    assigned_by = EXCLUDED.assigned_by, assigned_at = now()
		WHERE loan_assignments.agent_user_id <> EXCLUDED.agent_user_id`, ids, agentID, by)
	return err
}

// ClearAgentTx releases every loan held by an agent.
func ClearAgentTx(ctx context.Context, tx pgx.Tx, agentID int64) error {
	_, err := tx.Exec(ctx, `DELETE FROM loan_assignments WHERE agent_user_id = $1`, agentID)
	return err
}

// unassignTx releases one loan from one agent.
func unassignTx(ctx context.Context, tx pgx.Tx, loanID, agentID int64) error {
	_, err := tx.Exec(ctx, `DELETE FROM loan_assignments WHERE loan_id = $1 AND agent_user_id = $2`, loanID, agentID)
	return err
}

// applyAutoTx writes the auto-assign result: each listed loan is (re)assigned to
// its agent with source AUTO.
func applyAutoTx(ctx context.Context, tx pgx.Tx, changes map[int64]int64) error {
	for loanID, agentID := range changes {
		if _, err := tx.Exec(ctx, `
			INSERT INTO loan_assignments (loan_id, agent_user_id, source, assigned_by)
			VALUES ($1, $2, 'AUTO', NULL)
			ON CONFLICT (loan_id) DO UPDATE
			SET agent_user_id = EXCLUDED.agent_user_id, source = 'AUTO', assigned_by = NULL, assigned_at = now()`,
			loanID, agentID); err != nil {
			return err
		}
	}
	return nil
}

func uniqueIDs(in []int64) []int64 {
	seen := make(map[int64]bool, len(in))
	out := make([]int64, 0, len(in))
	for _, id := range in {
		if id > 0 && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

// ── submissions ──────────────────────────────────────────────────────────────

const submissionColumns = `
	s.id, s.type, s.loan_id, l.loan_number, l.customer_id, c.name, s.agent_user_id, u.full_name,
	s.status, s.amount, s.mode, s.receipt_date, s.promise_date, s.promised_amount, s.note,
	s.created_at, s.reviewed_at, s.review_note, s.payee_vpa, s.payee_name, s.edited_at`

const submissionJoin = `
	FROM recovery_submissions s
	JOIN loans l ON l.id = s.loan_id AND l.deleted_at IS NULL
	JOIN customers c ON c.id = l.customer_id AND c.deleted_at IS NULL
	JOIN users u ON u.id = s.agent_user_id
	WHERE s.deleted_at IS NULL`

const maxListed = 500

type rowScanner interface{ Scan(dest ...any) error }

func scanSubmission(row rowScanner) (*domain.RecoverySubmission, error) {
	var s domain.RecoverySubmission
	var typ string
	var amount, promised *int64
	var mode *string
	err := row.Scan(&s.ID, &typ, &s.LoanID, &s.LoanNumber, &s.CustomerID, &s.CustomerName, &s.AgentUserID, &s.AgentName,
		&s.Status, &amount, &mode, &s.ReceiptDate, &s.PromiseDate, &promised, &s.Note,
		&s.CreatedAt, &s.ReviewedAt, &s.ReviewNote, &s.PayeeVPA, &s.PayeeName, &s.EditedAt)
	if err != nil {
		return nil, err
	}
	s.Type = domain.RecoverySubmissionType(typ)
	if amount != nil {
		p := domain.PaiseFromDBRupees(*amount)
		s.Amount = &p
	}
	if promised != nil {
		p := domain.PaiseFromDBRupees(*promised)
		s.PromisedAmount = &p
	}
	if mode != nil {
		m := domain.PayMode(*mode)
		s.Mode = &m
	}
	return &s, nil
}

// ListSubmissions returns submissions newest first, open/pending ahead of
// reviewed. agentID scopes to one agent's own.
func (r *Repository) ListSubmissions(ctx context.Context, agentID *int64) ([]*domain.RecoverySubmission, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+submissionColumns+submissionJoin+`
		AND ($1::bigint IS NULL OR s.agent_user_id = $1)
		ORDER BY (s.status IN ('PENDING','OPEN')) DESC, s.created_at DESC, s.id DESC
		LIMIT $2`, agentID, maxListed)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*domain.RecoverySubmission{}
	for rows.Next() {
		s, err := scanSubmission(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// FindSubmission returns one submission (agentID scopes it to the agent's own).
func (r *Repository) FindSubmission(ctx context.Context, id int64, agentID *int64) (*domain.RecoverySubmission, error) {
	s, err := scanSubmission(r.pool.QueryRow(ctx, `SELECT `+submissionColumns+submissionJoin+`
		AND s.id = $1 AND ($2::bigint IS NULL OR s.agent_user_id = $2)`, id, agentID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("submission")
	}
	return s, err
}

// CreateClaim stores a PENDING collection claim. The one-pending-claim-per-loan
// unique index backs the service's own check against a concurrent double submit.
func (r *Repository) CreateClaim(ctx context.Context, agentID int64, in domain.ClaimInput) (int64, error) {
	var id int64
	// A UPI claim records the UPI ID the loan type's customers pay to (from
	// Settings, never from the client); other modes record none.
	err := r.pool.QueryRow(ctx, `
		INSERT INTO recovery_submissions (type, loan_id, agent_user_id, status, amount, mode, receipt_date, note,
		                                  payee_vpa, payee_name)
		SELECT 'COLLECTION_CLAIM', $1::bigint, $2::bigint, 'PENDING', $3::bigint, $4::varchar, $5::date, $6::varchar,
		       u.payee_vpa, u.payee_name
		FROM (SELECT 1) one
		LEFT JOIN loans ln ON ln.id = $1::bigint
		LEFT JOIN loan_type_upi u ON u.loan_type = ln.type AND $4::varchar = 'UPI'
		RETURNING id`,
		in.LoanID, agentID, in.Amount.DBRupees(), string(in.Mode), in.ReceiptDate, nilIfBlank(in.Note)).Scan(&id)
	if isPendingClaimConflict(err) {
		return 0, errPendingClaim
	}
	return id, err
}

// UpdatePendingClaim edits an agent's own PENDING claim. A screenshot awaiting
// review for the claim takes the new amount with it (it proves the claim).
func (r *Repository) UpdatePendingClaim(ctx context.Context, id, agentID int64, in domain.ClaimInput) (bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tag, err := tx.Exec(ctx, `
		UPDATE recovery_submissions s
		SET amount = $3, mode = $4::varchar, receipt_date = $5, note = $6, updated_at = now(), edited_at = now(),
		    payee_vpa = u.payee_vpa, payee_name = u.payee_name
		FROM (SELECT 1) one
		LEFT JOIN loans ln ON ln.id = $7::bigint
		LEFT JOIN loan_type_upi u ON u.loan_type = ln.type AND $4::varchar = 'UPI'
		WHERE s.id = $1 AND s.agent_user_id = $2 AND s.loan_id = $7::bigint
		  AND s.type = 'COLLECTION_CLAIM' AND s.status = 'PENDING' AND s.deleted_at IS NULL`,
		id, agentID, in.Amount.DBRupees(), string(in.Mode), in.ReceiptDate, nilIfBlank(in.Note), in.LoanID)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() != 1 {
		return false, nil
	}
	if _, err := tx.Exec(ctx, `
		UPDATE payment_proofs SET amount = $2
		WHERE claim_id = $1 AND status = 'PENDING' AND deleted_at IS NULL`, id, in.Amount.DBRupees()); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}

// ClosePromise closes the agent's own OPEN promise as FULFILLED or CANCELLED,
// stamping when and by whom. Returns false when it is not the agent's open
// promise (already closed, or not theirs).
func (r *Repository) ClosePromise(ctx context.Context, id, agentID int64, status string) (bool, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE recovery_submissions
		SET status = $3, reviewed_by = $2, reviewed_at = now(), updated_at = now()
		WHERE id = $1 AND agent_user_id = $2 AND type = 'PROMISE_TO_PAY' AND status = 'OPEN' AND deleted_at IS NULL`,
		id, agentID, status)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// stampCollectionPayeeTx copies an approved UPI claim's payee onto the
// collection rows its approval just recorded (idempotency key "claim-<id>-<n>").
func stampCollectionPayeeTx(ctx context.Context, tx pgx.Tx, loanID, claimID int64, vpa, name *string) error {
	if vpa == nil {
		return nil
	}
	_, err := tx.Exec(ctx, `
		UPDATE collections SET payee_vpa = $3, payee_name = $4
		WHERE loan_id = $1 AND idempotency_key LIKE $2 AND deleted_at IS NULL`,
		loanID, "claim-"+strconv.FormatInt(claimID, 10)+"-%", *vpa, name)
	return err
}

// closeClaimProofsTx settles the screenshots awaiting review for a claim being
// reviewed, inside the review's transaction: approved → VERIFIED on the claim's
// receipt date (evidence only; the claim recorded the money), rejected →
// REJECTED. No collection is written here. Returns how many were closed.
func closeClaimProofsTx(ctx context.Context, tx pgx.Tx, claimID int64, claimStatus string,
	reviewer *int64, receiptDate *time.Time,
) (int64, error) {
	var tag pgconn.CommandTag
	var err error
	if claimStatus == domain.ClaimApproved {
		tag, err = tx.Exec(ctx, `
			UPDATE payment_proofs
			SET status = 'VERIFIED', reviewed_by = $2, reviewed_at = now(), receipt_date = $3
			WHERE claim_id = $1 AND status = 'PENDING' AND deleted_at IS NULL`, claimID, reviewer, receiptDate)
	} else {
		tag, err = tx.Exec(ctx, `
			UPDATE payment_proofs
			SET status = 'REJECTED', reviewed_by = $2, reviewed_at = now()
			WHERE claim_id = $1 AND status = 'PENDING' AND deleted_at IS NULL`, claimID, reviewer)
	}
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// CreatePromise stores an OPEN promise to pay.
func (r *Repository) CreatePromise(ctx context.Context, agentID int64, in domain.PromiseInput) (int64, error) {
	var promised *int64
	if in.PromisedAmount != nil {
		v := in.PromisedAmount.DBRupees()
		promised = &v
	}
	var id int64
	err := r.pool.QueryRow(ctx, `
		INSERT INTO recovery_submissions (type, loan_id, agent_user_id, status, promise_date, promised_amount, note)
		VALUES ('PROMISE_TO_PAY', $1, $2, 'OPEN', $3, $4, $5) RETURNING id`,
		in.LoanID, agentID, in.PromiseDate, promised, nilIfBlank(in.Note)).Scan(&id)
	return id, err
}

// lockSubmissionTx row-locks a submission for review. Two staff approving the
// same claim at once serialise here; the second sees APPROVED.
func lockSubmissionTx(ctx context.Context, tx pgx.Tx, id int64) (*domain.RecoverySubmission, error) {
	s, err := scanSubmission(tx.QueryRow(ctx, `SELECT `+submissionColumns+submissionJoin+`
		AND s.id = $1 FOR UPDATE OF s`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("submission")
	}
	return s, err
}

func markReviewedTx(ctx context.Context, tx pgx.Tx, id int64, status string, reviewer *int64, note *string) error {
	tag, err := tx.Exec(ctx, `
		UPDATE recovery_submissions
		SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4, updated_at = now()
		WHERE id = $1 AND type = 'COLLECTION_CLAIM' AND status = 'PENDING'`, id, status, reviewer, note)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.NewConflict("This submission was already reviewed")
	}
	return nil
}

func nilIfBlank(s *string) *string {
	if s == nil {
		return nil
	}
	t := strings.TrimSpace(*s)
	if t == "" {
		return nil
	}
	return &t
}

var errPendingClaim = domain.NewConflict("A collection for this loan is already awaiting admin approval.")

func isPendingClaimConflict(err error) bool {
	return err != nil && strings.Contains(err.Error(), "idx_recovery_one_pending_claim")
}

// ── auto-assign settings ─────────────────────────────────────────────────────

// Schedule is the daily auto-assign configuration and last run.
type Schedule struct {
	RunTime     *string
	LastRunSlot *string
	LastRunAt   *time.Time
	LastResult  map[string]any
}

// GetSchedule reads the single settings row.
func (r *Repository) GetSchedule(ctx context.Context) (*Schedule, error) {
	return getSchedule(ctx, r.pool.QueryRow(ctx,
		`SELECT run_time, last_run_slot, last_run_at, last_result FROM recovery_auto_assign WHERE id = 1`))
}

func getSchedule(_ context.Context, row pgx.Row) (*Schedule, error) {
	var s Schedule
	var raw []byte
	if err := row.Scan(&s.RunTime, &s.LastRunSlot, &s.LastRunAt, &raw); err != nil {
		return nil, err
	}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &s.LastResult)
	}
	return &s, nil
}

// SetRunTime saves the daily run time (nil = midnight).
func (r *Repository) SetRunTime(ctx context.Context, runTime *string, by *int64) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE recovery_auto_assign SET run_time = $1, updated_by = $2, updated_at = now() WHERE id = 1`, runTime, by)
	return err
}

// lockScheduleTx row-locks the settings row so only one auto-assign runs at a
// time (the scheduler, a second server instance, and "Run now" can collide).
func lockScheduleTx(ctx context.Context, tx pgx.Tx) (*Schedule, error) {
	return getSchedule(ctx, tx.QueryRow(ctx,
		`SELECT run_time, last_run_slot, last_run_at, last_result FROM recovery_auto_assign WHERE id = 1 FOR UPDATE`))
}

func recordRunTx(ctx context.Context, tx pgx.Tx, slot string, result map[string]any) error {
	raw, _ := json.Marshal(result)
	_, err := tx.Exec(ctx,
		`UPDATE recovery_auto_assign SET last_run_slot = $1, last_run_at = now(), last_result = $2 WHERE id = 1`, slot, raw)
	return err
}
