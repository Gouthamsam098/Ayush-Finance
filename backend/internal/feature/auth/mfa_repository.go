package auth

import (
	"context"
	"errors"
	"time"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/jackc/pgx/v5"
)

// MFAState is a user's two-factor enrollment as stored (secret still sealed).
type MFAState struct {
	Enabled      bool
	SealedSecret *string
	LastStep     *int64
}

// GetMFA loads an active user's two-factor state.
func (r *Repository) GetMFA(ctx context.Context, userID int64) (*MFAState, error) {
	var s MFAState
	err := r.pool.QueryRow(ctx, `
		SELECT mfa_enabled, mfa_secret, mfa_last_step FROM users
		WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL`, userID).Scan(&s.Enabled, &s.SealedSecret, &s.LastStep)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("user")
	}
	return &s, err
}

// SetPendingMFASecret stores a new secret for an account that does not have
// two-factor on yet (setup in progress). Refused once it is on.
func (r *Repository) SetPendingMFASecret(ctx context.Context, userID int64, sealed string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE users SET mfa_secret = $2, mfa_last_step = NULL, updated_at = now()
		WHERE id = $1 AND mfa_enabled = FALSE AND is_active = TRUE AND deleted_at IS NULL`, userID, sealed)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.NewConflict("Two-factor authentication is already on for this account.")
	}
	return nil
}

// EnableMFA turns two-factor on, recording the step of the code that proved
// the authenticator works (it cannot be reused).
func (r *Repository) EnableMFA(ctx context.Context, userID, step int64) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE users SET mfa_enabled = TRUE, mfa_last_step = $2, updated_at = now()
		WHERE id = $1 AND mfa_enabled = FALSE AND mfa_secret IS NOT NULL AND is_active = TRUE AND deleted_at IS NULL`,
		userID, step)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.NewConflict("Two-factor setup changed meanwhile. Start the setup again.")
	}
	return nil
}

// ConsumeMFAStep records step as used, only if it is later than every step
// used before. False = the code was already used (replay).
func (r *Repository) ConsumeMFAStep(ctx context.Context, userID, step int64) (bool, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE users SET mfa_last_step = $2
		WHERE id = $1 AND mfa_enabled = TRUE AND (mfa_last_step IS NULL OR mfa_last_step < $2)`, userID, step)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// DisableMFA turns two-factor off and forgets the secret.
func (r *Repository) DisableMFA(ctx context.Context, userID int64) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE users SET mfa_enabled = FALSE, mfa_secret = NULL, mfa_last_step = NULL, updated_at = now()
		WHERE id = $1`, userID)
	return err
}

// MFAChallenge is a pending second login step.
type MFAChallenge struct {
	UserID    int64
	ExpiresAt time.Time
	Attempts  int
}

// CreateMFAChallenge stores a challenge (by token hash) and clears expired ones.
func (r *Repository) CreateMFAChallenge(ctx context.Context, tokenHash []byte, userID int64, expiresAt time.Time) error {
	if _, err := r.pool.Exec(ctx, `DELETE FROM mfa_challenges WHERE expires_at < now()`); err != nil {
		return err
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO mfa_challenges (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`, tokenHash, userID, expiresAt)
	return err
}

// FindMFAChallenge returns a challenge by token hash, or NotFound.
func (r *Repository) FindMFAChallenge(ctx context.Context, tokenHash []byte) (*MFAChallenge, error) {
	var c MFAChallenge
	err := r.pool.QueryRow(ctx, `
		SELECT user_id, expires_at, attempts FROM mfa_challenges WHERE token_hash = $1`, tokenHash).
		Scan(&c.UserID, &c.ExpiresAt, &c.Attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.NewNotFound("challenge")
	}
	return &c, err
}

// BumpMFAChallenge counts a wrong code and returns the new attempt count.
func (r *Repository) BumpMFAChallenge(ctx context.Context, tokenHash []byte) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		UPDATE mfa_challenges SET attempts = attempts + 1 WHERE token_hash = $1 RETURNING attempts`, tokenHash).Scan(&n)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.NewNotFound("challenge")
	}
	return n, err
}

// DeleteMFAChallenge removes a challenge (used, expired or exhausted).
// Returns false when it was already gone — a concurrent use won.
func (r *Repository) DeleteMFAChallenge(ctx context.Context, tokenHash []byte) (bool, error) {
	tag, err := r.pool.Exec(ctx, `DELETE FROM mfa_challenges WHERE token_hash = $1`, tokenHash)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}
