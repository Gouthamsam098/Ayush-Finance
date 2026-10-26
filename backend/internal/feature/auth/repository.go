// Package auth implements authentication: user lookup, credential
// verification, and token issuance. It is organised as repository (data
// access) -> service (business logic) -> handler (HTTP), matching the layer
// separation mandated by the project rules.
package auth

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// scanUserPerms applies stored permissions to u (admins get implicit full edit).
func scanUserPerms(u *domain.User, raw []byte) {
	perms := domain.Permissions{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &perms)
	}
	if u.Role == domain.RoleAdmin {
		u.Permissions = domain.AdminPermissions()
	} else {
		u.Permissions = perms.Normalize()
	}
}

// liveCustomerLink keeps a portal login usable only while its customer exists:
// deleting the customer revokes the login immediately, including any token
// already issued (every protected request reloads the user through FindByID).
const liveCustomerLink = `
		  AND (role <> 'CUSTOMER' OR EXISTS (
		        SELECT 1 FROM customers c WHERE c.id = users.customer_id AND c.deleted_at IS NULL))`

// Repository provides user data access. All queries are parameterised; no SQL
// string is ever built from user input.
type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// RequestPasswordReset files a "Forgot password?" request for the live, active
// account with this email (same predicate as login). One OPEN request per user:
// a repeat bumps its count and time instead of adding a row. An unknown or
// inactive email records nothing. One statement against the partial unique
// index, so concurrent requests can never create two open rows.
func (r *Repository) RequestPasswordReset(ctx context.Context, email string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO password_reset_requests (user_id)
		SELECT id FROM users
		WHERE email = $1 AND is_active = TRUE AND deleted_at IS NULL`+liveCustomerLink+`
		ON CONFLICT (user_id) WHERE status = 'OPEN'
		DO UPDATE SET request_count = password_reset_requests.request_count + 1,
		              last_requested_at = now()`, email)
	return err
}

// FindByEmail returns the active user with the given email, or a NotFound
// domain error. Email is matched in lower case to align with the stored form.
func (r *Repository) FindByEmail(ctx context.Context, email string) (*domain.User, error) {
	const query = `
		SELECT id, email, full_name, password_hash, role, permissions, mfa_enabled, is_active,
		       last_login_at, created_at, updated_at, customer_id
		FROM users
		WHERE email = $1 AND is_active = TRUE AND deleted_at IS NULL` + liveCustomerLink

	var u domain.User
	var role string
	var perms []byte
	err := r.pool.QueryRow(ctx, query, email).Scan(
		&u.ID, &u.Email, &u.FullName, &u.PasswordHash, &role, &perms, &u.MFAEnabled,
		&u.IsActive, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt, &u.CustomerID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("user")
	}
	if err != nil {
		return nil, err
	}
	u.Role = domain.Role(role)
	scanUserPerms(&u, perms)
	return &u, nil
}

// FindByID returns the active user with the given ID, or a NotFound error.
func (r *Repository) FindByID(ctx context.Context, id int64) (*domain.User, error) {
	const query = `
		SELECT id, email, full_name, password_hash, role, permissions, mfa_enabled, is_active,
		       last_login_at, created_at, updated_at, customer_id
		FROM users
		WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL` + liveCustomerLink

	var u domain.User
	var role string
	var perms []byte
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&u.ID, &u.Email, &u.FullName, &u.PasswordHash, &role, &perms, &u.MFAEnabled,
		&u.IsActive, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt, &u.CustomerID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("user")
	}
	if err != nil {
		return nil, err
	}
	u.Role = domain.Role(role)
	scanUserPerms(&u, perms)
	return &u, nil
}

// UpdatePassword replaces the user's password hash, but only if it is still
// `oldHash` — the hash the current password was just verified against — so two
// overlapping changes cannot both succeed. It also closes any open "Forgot
// password?" request of theirs: they have just proved who they are. One tx.
func (r *Repository) UpdatePassword(ctx context.Context, id int64, oldHash, newHash string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tag, err := tx.Exec(ctx, `
		UPDATE users SET password_hash = $3, updated_at = now()
		WHERE id = $1 AND password_hash = $2 AND is_active = TRUE AND deleted_at IS NULL`, id, oldHash, newHash)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.NewConflict("Your password was changed a moment ago. Sign in again and retry if needed.")
	}
	if _, err := tx.Exec(ctx, `
		UPDATE password_reset_requests SET status = 'RESOLVED', resolved_at = now(), resolved_by = $1
		WHERE user_id = $1 AND status = 'OPEN'`, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// TouchLastLogin records a successful login timestamp.
func (r *Repository) TouchLastLogin(ctx context.Context, id int64, at time.Time) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users SET last_login_at = $1, updated_at = now() WHERE id = $2`, at, id)
	return err
}
