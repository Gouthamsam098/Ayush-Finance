// Package user implements managed-user administration (list, create, update
// role/status, soft-delete) across repository -> service -> handler layers.
// These endpoints are admin-only (enforced by the service + a router guard).
// Passwords are bcrypt-hashed by the service; the hash is never returned.
package user

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/anush-capitals/lms-backend/internal/feature/recovery"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository provides managed-user data access. Every query excludes
// soft-deleted rows and is parameterised.
type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

const userColumns = `
	id, email, full_name, role, permissions, mfa_enabled, is_active, last_login_at, created_at, updated_at, customer_id`

// List returns all non-deleted users, oldest first: staff, recovery agents and
// customer portal logins (Settings → Users manages all of them).
func (r *Repository) List(ctx context.Context) ([]*domain.User, error) {
	const q = `SELECT ` + userColumns + ` FROM users
		WHERE deleted_at IS NULL ORDER BY created_at ASC, id ASC`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*domain.User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// FindByID returns a non-deleted user or NotFound.
func (r *Repository) FindByID(ctx context.Context, id int64) (*domain.User, error) {
	const q = `SELECT ` + userColumns + ` FROM users WHERE id = $1 AND deleted_at IS NULL`
	u, err := scanUser(r.pool.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("user")
	}
	if err != nil {
		return nil, err
	}
	return u, nil
}

// customerLink is the customer_id to store: only a CUSTOMER login has one.
func customerLink(in domain.UserInput) *int64 {
	if in.Role == domain.RoleCustomer {
		return in.CustomerID
	}
	return nil
}

// requireLiveCustomerTx rejects a link to a missing or deleted customer.
func requireLiveCustomerTx(ctx context.Context, tx pgx.Tx, customerID *int64) error {
	if customerID == nil {
		return nil
	}
	var ok bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM customers WHERE id = $1 AND deleted_at IS NULL)`, *customerID).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return domain.NewValidation("That customer no longer exists", map[string]string{"customer_id": "Select another customer"})
	}
	return nil
}

// syncAgentLoansTx applies a recovery agent's loan set, or releases every loan
// when the user is (no longer) an agent. ids nil = leave an agent's set as is.
func syncAgentLoansTx(ctx context.Context, tx pgx.Tx, userID int64, in domain.UserInput, by *int64) error {
	if in.Role != domain.RoleRecoveryAgent {
		return recovery.ClearAgentTx(ctx, tx, userID)
	}
	if in.AssignedLoanIDs == nil {
		return nil
	}
	return recovery.ReplaceForAgentTx(ctx, tx, userID, in.AssignedLoanIDs, by)
}

// Create inserts a new managed user (password already hashed) and, for a
// recovery agent, its assigned loans — in one transaction.
func (r *Repository) Create(ctx context.Context, in domain.UserInput, passwordHash string, by *int64) (*domain.User, error) {
	perms, _ := json.Marshal(in.EffectivePermissions())
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	link := customerLink(in)
	if err := requireLiveCustomerTx(ctx, tx, link); err != nil {
		return nil, err
	}
	const q = `
		INSERT INTO users (email, full_name, password_hash, role, permissions, is_active, customer_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING ` + userColumns
	u, err := scanUser(tx.QueryRow(ctx, q,
		strings.ToLower(strings.TrimSpace(in.Email)), strings.TrimSpace(in.FullName),
		passwordHash, string(in.Role), perms, in.IsActive, link))
	if err != nil {
		return nil, translateWriteError(err)
	}
	if in.Role == domain.RoleRecoveryAgent && in.AssignedLoanIDs != nil {
		if err := recovery.ReplaceForAgentTx(ctx, tx, u.ID, in.AssignedLoanIDs, by); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return u, nil
}

// Update rewrites a user's editable fields. passwordHash is applied only when
// non-empty (blank = keep existing password) — this is also how an admin resets
// a customer's portal password. An agent's loan set is synced in the same
// transaction.
func (r *Repository) Update(ctx context.Context, id int64, in domain.UserInput, passwordHash string, by *int64) (*domain.User, error) {
	perms, _ := json.Marshal(in.EffectivePermissions())
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	link := customerLink(in)
	if err := requireLiveCustomerTx(ctx, tx, link); err != nil {
		return nil, err
	}
	const q = `
		UPDATE users SET
			email = $2, full_name = $3, role = $4, permissions = $5, is_active = $6,
			password_hash = COALESCE(NULLIF($7, ''), password_hash),
			-- An admin reset ends the user's existing sessions.
			password_changed_at = CASE WHEN NULLIF($7, '') IS NULL THEN password_changed_at ELSE now() END,
			customer_id = $8,
			updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING ` + userColumns
	u, err := scanUser(tx.QueryRow(ctx, q, id,
		strings.ToLower(strings.TrimSpace(in.Email)), strings.TrimSpace(in.FullName),
		string(in.Role), perms, in.IsActive, passwordHash, link))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("user")
	}
	if err != nil {
		return nil, translateWriteError(err)
	}
	if err := syncAgentLoansTx(ctx, tx, id, in, by); err != nil {
		return nil, err
	}
	// A new password answers any open "Forgot password?" request — close it in
	// the same transaction, so a request never outlives (or precedes) the reset.
	if passwordHash != "" {
		if _, err := tx.Exec(ctx, `
			UPDATE password_reset_requests SET status = 'RESOLVED', resolved_at = now(), resolved_by = $2
			WHERE user_id = $1 AND status = 'OPEN'`, id, by); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return u, nil
}

// OpenPasswordResetRequests lists unresolved "Forgot password?" requests from
// live, active accounts, oldest first.
func (r *Repository) OpenPasswordResetRequests(ctx context.Context) ([]*domain.PasswordResetRequest, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT p.id, p.user_id, u.email, u.full_name, u.role, p.request_count, p.requested_at, p.last_requested_at
		FROM password_reset_requests p
		JOIN users u ON u.id = p.user_id AND u.deleted_at IS NULL AND u.is_active = TRUE
		WHERE p.status = 'OPEN'
		ORDER BY p.requested_at, p.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*domain.PasswordResetRequest{}
	for rows.Next() {
		var p domain.PasswordResetRequest
		var role string
		if err := rows.Scan(&p.ID, &p.UserID, &p.Email, &p.FullName, &role, &p.RequestCount,
			&p.RequestedAt, &p.LastRequestedAt); err != nil {
			return nil, err
		}
		p.Role = domain.Role(role)
		out = append(out, &p)
	}
	return out, rows.Err()
}

// DismissPasswordResetRequest closes an OPEN request without a reset — it was
// not really them, or it was handled another way.
func (r *Repository) DismissPasswordResetRequest(ctx context.Context, id int64, by *int64) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE password_reset_requests SET status = 'DISMISSED', resolved_at = now(), resolved_by = $2
		WHERE id = $1 AND status = 'OPEN'`, id, by)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.NewNotFound("password reset request")
	}
	return nil
}

// ResetMFA turns a user's two-factor off and forgets the secret.
func (r *Repository) ResetMFA(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE users SET mfa_enabled = FALSE, mfa_secret = NULL, mfa_last_step = NULL, updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.NewNotFound("user")
	}
	return nil
}

// AgentLoans maps each recovery agent to their assigned live loans.
func (r *Repository) AgentLoans(ctx context.Context) (map[int64][]int64, error) {
	rows, err := r.pool.Query(ctx, `SELECT a.agent_user_id, a.loan_id FROM loan_assignments a
		JOIN loans l ON l.id = a.loan_id AND l.deleted_at IS NULL ORDER BY a.loan_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64][]int64{}
	for rows.Next() {
		var agent, loan int64
		if err := rows.Scan(&agent, &loan); err != nil {
			return nil, err
		}
		out[agent] = append(out[agent], loan)
	}
	return out, rows.Err()
}

// SetActive flips a user's active flag.
func (r *Repository) SetActive(ctx context.Context, id int64, active bool) (*domain.User, error) {
	const q = `UPDATE users SET is_active = $2, updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL RETURNING ` + userColumns
	u, err := scanUser(r.pool.QueryRow(ctx, q, id, active))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("user")
	}
	if err != nil {
		return nil, err
	}
	return u, nil
}

// SoftDelete marks a user deleted (and releases an agent's loans); NotFound if
// missing or already deleted.
func (r *Repository) SoftDelete(ctx context.Context, id int64) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tag, err := tx.Exec(ctx,
		`UPDATE users SET deleted_at = now(), is_active = FALSE, updated_at = now()
		 WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.NewNotFound("user")
	}
	if err := recovery.ClearAgentTx(ctx, tx, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// CountOtherActiveAdmins returns how many ACTIVE admins exist besides excludeID.
// Used to prevent removing/demoting/disabling the last admin.
func (r *Repository) CountOtherActiveAdmins(ctx context.Context, excludeID int64) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM users
		 WHERE role = 'ADMIN' AND is_active = TRUE AND deleted_at IS NULL AND id <> $1`,
		excludeID).Scan(&n)
	return n, err
}

// PortalLogin is a customer's portal login as shown to staff.
type PortalLogin struct {
	Email       string
	IsActive    bool
	LastLoginAt *time.Time
}

// FindPortalLogin returns the live portal login for a customer, or NotFound.
func (r *Repository) FindPortalLogin(ctx context.Context, customerID int64) (*PortalLogin, error) {
	var p PortalLogin
	err := r.pool.QueryRow(ctx,
		`SELECT email, is_active, last_login_at FROM users
		 WHERE customer_id = $1 AND role = 'CUSTOMER' AND deleted_at IS NULL`,
		customerID).Scan(&p.Email, &p.IsActive, &p.LastLoginAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("portal login")
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// CreatePortalLogin inserts a CUSTOMER login for a live customer, named after
// the customer. NotFound when the customer does not exist or is deleted.
func (r *Repository) CreatePortalLogin(ctx context.Context, customerID int64, email, passwordHash string) (*PortalLogin, error) {
	const q = `
		INSERT INTO users (email, full_name, password_hash, role, permissions, is_active, customer_id)
		SELECT $2, c.name, $3, 'CUSTOMER', '{}'::jsonb, TRUE, c.id
		FROM customers c WHERE c.id = $1 AND c.deleted_at IS NULL
		RETURNING email, is_active, last_login_at`
	var p PortalLogin
	err := r.pool.QueryRow(ctx, q, customerID, strings.ToLower(strings.TrimSpace(email)), passwordHash).
		Scan(&p.Email, &p.IsActive, &p.LastLoginAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("customer")
	}
	if err != nil {
		return nil, translateWriteError(err)
	}
	return &p, nil
}

// ── scanning + helpers ──

type rowScanner interface{ Scan(dest ...any) error }

func scanUser(row rowScanner) (*domain.User, error) {
	var u domain.User
	var role string
	var permsRaw []byte
	err := row.Scan(&u.ID, &u.Email, &u.FullName, &role, &permsRaw, &u.MFAEnabled,
		&u.IsActive, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt, &u.CustomerID)
	if err != nil {
		return nil, err
	}
	u.Role = domain.Role(role)
	perms := domain.Permissions{}
	if len(permsRaw) > 0 {
		_ = json.Unmarshal(permsRaw, &perms)
	}
	// Admins always have full edit regardless of stored map.
	if u.Role == domain.RoleAdmin {
		u.Permissions = domain.AdminPermissions()
	} else {
		u.Permissions = perms.Normalize()
	}
	return &u, nil
}

// translateWriteError maps unique/check violations to friendly errors.
func translateWriteError(err error) error {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "idx_users_customer_live"):
		return domain.NewConflict("This customer already has a portal login")
	case strings.Contains(msg, "users_email_key") || (strings.Contains(msg, "duplicate key") && strings.Contains(msg, "email")):
		return domain.NewValidation("A user with this email already exists", map[string]string{"email": "Email already in use"})
	case strings.Contains(msg, "users_customer_link"):
		return domain.NewValidation("Select the customer record for this portal login", map[string]string{"customer_id": "Required"})
	case strings.Contains(msg, "users_role_valid"):
		return domain.NewValidation("Invalid role", map[string]string{"role": "Unknown role"})
	case strings.Contains(msg, "users_email_lower"):
		return domain.NewValidation("Email must be lowercase", map[string]string{"email": "Use a valid email"})
	}
	return err
}
