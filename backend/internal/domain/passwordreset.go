package domain

import (
	"strings"
	"time"
)

// PasswordResetRequest is an open "Forgot password?" request from the login
// page, waiting for an administrator to confirm the person and set a new
// password. Repeats of the same request are counted on one row.
type PasswordResetRequest struct {
	ID              int64
	UserID          int64
	Email           string
	FullName        string
	Role            Role
	RequestCount    int
	RequestedAt     time.Time
	LastRequestedAt time.Time
}

// passwordResetEmailMaxLen is the longest address accepted (RFC 5321 path limit).
const passwordResetEmailMaxLen = 254

// NormalizeResetEmail validates and lower-cases the address typed on the
// forgot-password form (accounts sign in by email). Only its shape is checked:
// whether an account exists is never revealed to the caller.
func NormalizeResetEmail(raw string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(raw))
	if email == "" {
		return "", NewValidation("Enter the email you sign in with", map[string]string{"email": "Required"})
	}
	if len(email) > passwordResetEmailMaxLen || !emailRe.MatchString(email) {
		return "", NewValidation("Enter a valid email address", map[string]string{"email": "Not a valid email"})
	}
	return email, nil
}
