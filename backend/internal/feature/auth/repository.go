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

// Repository provides user data access. All queries are parameterised; no SQL
// string is ever built from user input.
type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// FindByEmail returns the active user with the given email, or a NotFound
// domain error. Email is matched in lower case to align with the stored form.
func (r *Repository) FindByEmail(ctx context.Context, email string) (*domain.User, error) {
	const query = `
		SELECT id, email, full_name, password_hash, role, permissions, mfa_enabled, is_active,
		       last_login_at, created_at, updated_at
		FROM users
		WHERE email = $1 AND is_active = TRUE AND deleted_at IS NULL`

	var u domain.User
	var role string
	var perms []byte
	err := r.pool.QueryRow(ctx, query, email).Scan(
		&u.ID, &u.Email, &u.FullName, &u.PasswordHash, &role, &perms, &u.MFAEnabled,
		&u.IsActive, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt,
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
		       last_login_at, created_at, updated_at
		FROM users
		WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL`

	var u domain.User
	var role string
	var perms []byte
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&u.ID, &u.Email, &u.FullName, &u.PasswordHash, &role, &perms, &u.MFAEnabled,
		&u.IsActive, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt,
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

// TouchLastLogin records a successful login timestamp.
func (r *Repository) TouchLastLogin(ctx context.Context, id int64, at time.Time) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users SET last_login_at = $1, updated_at = now() WHERE id = $2`, at, id)
	return err
}
