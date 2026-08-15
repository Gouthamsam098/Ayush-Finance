package domain

import (
	"errors"
	"fmt"
	"net/http"
)

// ErrorCode is a stable, machine-readable identifier for a domain error.
// Clients switch on these; the human-readable message may change freely.
type ErrorCode string

const (
	CodeValidation      ErrorCode = "VALIDATION_ERROR"
	CodeNotFound        ErrorCode = "NOT_FOUND"
	CodeConflict        ErrorCode = "CONFLICT"
	CodeUnauthorized    ErrorCode = "UNAUTHORIZED"
	CodeForbidden       ErrorCode = "FORBIDDEN"
	CodeBusinessRule    ErrorCode = "BUSINESS_RULE_VIOLATION"
	CodeTooManyRequests ErrorCode = "TOO_MANY_REQUESTS"
	CodeInternal        ErrorCode = "INTERNAL_ERROR"
)

// Error is a domain error carrying a stable code, a client-safe message, and
// an HTTP status. It never wraps internal details that should not leave the
// server; those are logged separately. Optional Fields carry per-field
// validation detail.
type Error struct {
	Code    ErrorCode
	Message string
	Status  int
	Fields  map[string]string
}

func (e *Error) Error() string {
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

// AsError extracts a *domain.Error from err if present in its chain.
func AsError(err error) (*Error, bool) {
	var de *Error
	if errors.As(err, &de) {
		return de, true
	}
	return nil, false
}

// NewValidation builds a 400 validation error. fields maps field name to a
// human-readable reason and may be nil.
func NewValidation(message string, fields map[string]string) *Error {
	return &Error{Code: CodeValidation, Message: message, Status: http.StatusBadRequest, Fields: fields}
}

func NewNotFound(resource string) *Error {
	return &Error{Code: CodeNotFound, Message: resource + " not found", Status: http.StatusNotFound}
}

func NewConflict(message string) *Error {
	return &Error{Code: CodeConflict, Message: message, Status: http.StatusConflict}
}

func NewUnauthorized(message string) *Error {
	return &Error{Code: CodeUnauthorized, Message: message, Status: http.StatusUnauthorized}
}

func NewForbidden(message string) *Error {
	return &Error{Code: CodeForbidden, Message: message, Status: http.StatusForbidden}
}

func NewBusinessRule(message string) *Error {
	return &Error{Code: CodeBusinessRule, Message: message, Status: http.StatusUnprocessableEntity}
}

// NewTooManyRequests builds a 429 for rate-limited endpoints. The message is
// intentionally generic: it must not reveal whether the account exists or how
// many attempts remain.
func NewTooManyRequests(message string) *Error {
	return &Error{Code: CodeTooManyRequests, Message: message, Status: http.StatusTooManyRequests}
}
