// Package httpx holds shared HTTP plumbing: the standard response envelope,
// JSON helpers, and middleware. Handlers use these so every endpoint returns
// a consistent shape and no handler ever leaks internal error detail.
package httpx

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/anush-capitals/lms-backend/internal/logger"
)

// envelope is the single response shape for the whole API:
//
//	{ "success": true,  "data": {...} }
//	{ "success": false, "error": { "code", "message", "fields" } }
type envelope struct {
	Success bool           `json:"success"`
	Data    any            `json:"data,omitempty"`
	Error   *errorPayload  `json:"error,omitempty"`
	Meta    *PaginationMeta `json:"meta,omitempty"`
}

type errorPayload struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

// PaginationMeta accompanies list responses.
type PaginationMeta struct {
	Page       int   `json:"page"`
	Limit      int   `json:"limit"`
	Total      int64 `json:"total"`
	TotalPages int   `json:"total_pages"`
}

// JSON writes a success envelope with the given status and data.
func JSON(w http.ResponseWriter, status int, data any) {
	write(w, status, envelope{Success: true, Data: data})
}

// List writes a success envelope carrying pagination metadata.
func List(w http.ResponseWriter, data any, meta PaginationMeta) {
	write(w, http.StatusOK, envelope{Success: true, Data: data, Meta: &meta})
}

// Created writes a 201 success envelope.
func Created(w http.ResponseWriter, data any) {
	write(w, http.StatusCreated, envelope{Success: true, Data: data})
}

// NoContent writes a 204 with no body.
func NoContent(w http.ResponseWriter) { w.WriteHeader(http.StatusNoContent) }

// Error translates any error into a client-safe response. Domain errors map
// to their declared status and message. Any other error is treated as an
// unexpected internal failure: it is logged in full server-side, but the
// client only ever sees a generic 500 message — never a stack trace, SQL
// error, or internal path.
func Error(w http.ResponseWriter, r *http.Request, err error) {
	if de, ok := domain.AsError(err); ok {
		write(w, de.Status, envelope{
			Success: false,
			Error: &errorPayload{
				Code:    string(de.Code),
				Message: de.Message,
				Fields:  de.Fields,
			},
		})
		return
	}

	logger.FromContext(r.Context()).Error("unhandled internal error", "error", err.Error())
	write(w, http.StatusInternalServerError, envelope{
		Success: false,
		Error: &errorPayload{
			Code:    string(domain.CodeInternal),
			Message: "An internal error occurred",
		},
	})
}

// DecodeJSON reads a JSON body into dst, rejecting unknown fields and empty
// bodies with a validation error. This is the single input trust boundary for
// JSON payloads.
func DecodeJSON(r *http.Request, dst any) error {
	if r.Body == nil {
		return domain.NewValidation("request body is required", nil)
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		if errors.Is(err, http.ErrBodyReadAfterClose) {
			return domain.NewValidation("request body is required", nil)
		}
		return domain.NewValidation("request body is malformed or contains unknown fields", nil)
	}
	return nil
}

func write(w http.ResponseWriter, status int, body envelope) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
