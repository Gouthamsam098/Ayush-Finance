// Package crypto centralises password hashing and JWT handling. Keeping these
// primitives in one place means the cost factor and signing algorithm are
// configured once and can be audited in a single file.
package crypto

import (
	"errors"

	"golang.org/x/crypto/bcrypt"
)

// ErrMismatchedPassword is returned when a password does not match its hash.
// It is intentionally generic so callers cannot distinguish "wrong password"
// from "no such user" and leak account existence.
var ErrMismatchedPassword = errors.New("crypto: password does not match")

// Hasher wraps bcrypt at a fixed, configured cost. The cost is injected so
// it is never hardcoded and can be tuned per environment.
type Hasher struct {
	cost int
}

// NewHasher constructs a Hasher. Cost is validated by config to sit in the
// safe range before it reaches here.
func NewHasher(cost int) *Hasher {
	return &Hasher{cost: cost}
}

// Hash returns the bcrypt hash of a plaintext password.
func (h *Hasher) Hash(plaintext string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(plaintext), h.cost)
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

// Compare verifies a plaintext password against a stored hash, returning
// ErrMismatchedPassword on any mismatch.
func (h *Hasher) Compare(hash, plaintext string) error {
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(plaintext)); err != nil {
		return ErrMismatchedPassword
	}
	return nil
}
