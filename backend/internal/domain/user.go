package domain

import "time"

// User is an operator account. PasswordHash is present in the struct because
// the service layer needs it to authenticate, but it must never be included
// in any API response — handlers map to a response DTO that omits it.
type User struct {
	ID           int64
	Email        string
	FullName     string
	PasswordHash string
	MFAEnabled   bool
	IsActive     bool
	LastLoginAt  *time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
}
