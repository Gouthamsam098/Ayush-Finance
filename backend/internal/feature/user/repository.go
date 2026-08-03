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

	"github.com/anush-capitals/lms-backend/internal/domain"
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
	id, email, full_name, role, permissions, mfa_enabled, is_active, last_login_at, created_at, updated_at`

// List returns all non-deleted users, newest first.
func (r *Repository) List(ctx context.Context) ([]*domain.User, error) {
	const q = `SELECT ` + userColumns + ` FROM users WHERE deleted_at IS NULL ORDER BY created_at ASC, id ASC`
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

// Create inserts a new managed user (password already hashed).
func (r *Repository) Create(ctx context.Context, in domain.UserInput, passwordHash string) (*domain.User, error) {
	perms, _ := json.Marshal(in.EffectivePermissions())
	const q = `
		INSERT INTO users (email, full_name, password_hash, role, permissions, is_active)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING ` + userColumns
	u, err := scanUser(r.pool.QueryRow(ctx, q,
		strings.ToLower(strings.TrimSpace(in.Email)), strings.TrimSpace(in.FullName),
		passwordHash, string(in.Role), perms, in.IsActive))
	if err != nil {
		return nil, translateWriteError(err)
	}
	return u, nil
}

// Update rewrites a user's editable fields. passwordHash is applied only when
// non-empty (blank = keep existing password).
func (r *Repository) Update(ctx context.Context, id int64, in domain.UserInput, passwordHash string) (*domain.User, error) {
	perms, _ := json.Marshal(in.EffectivePermissions())
	const q = `
		UPDATE users SET
			email = $2, full_name = $3, role = $4, permissions = $5, is_active = $6,
			password_hash = COALESCE(NULLIF($7, ''), password_hash),
			updated_at = now()
		WHERE id = $1 AND deleted_at IS NULL
		RETURNING ` + userColumns
	u, err := scanUser(r.pool.QueryRow(ctx, q, id,
		strings.ToLower(strings.TrimSpace(in.Email)), strings.TrimSpace(in.FullName),
		string(in.Role), perms, in.IsActive, passwordHash))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("user")
	}
	if err != nil {
		return nil, translateWriteError(err)
	}
	return u, nil
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

// SoftDelete marks a user deleted; NotFound if missing or already deleted.
func (r *Repository) SoftDelete(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE users SET deleted_at = now(), is_active = FALSE, updated_at = now()
		 WHERE id = $1 AND deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.NewNotFound("user")
	}
	return nil
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

// ── scanning + helpers ──

type rowScanner interface{ Scan(dest ...any) error }

func scanUser(row rowScanner) (*domain.User, error) {
	var u domain.User
	var role string
	var permsRaw []byte
	err := row.Scan(&u.ID, &u.Email, &u.FullName, &role, &permsRaw, &u.MFAEnabled,
		&u.IsActive, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt)
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
	case strings.Contains(msg, "users_email_key") || (strings.Contains(msg, "duplicate key") && strings.Contains(msg, "email")):
		return domain.NewValidation("A user with this email already exists", map[string]string{"email": "Email already in use"})
	case strings.Contains(msg, "users_role_valid"):
		return domain.NewValidation("Invalid role", map[string]string{"role": "Unknown role"})
	case strings.Contains(msg, "users_email_lower"):
		return domain.NewValidation("Email must be lowercase", map[string]string{"email": "Use a valid email"})
	}
	return err
}
