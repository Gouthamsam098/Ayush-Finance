package httpx

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/anush-capitals/lms-backend/internal/crypto"
	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/anush-capitals/lms-backend/internal/logger"
	"github.com/google/uuid"
)

type contextKey string

const (
	ctxRequestID contextKey = "request_id"
	ctxUserID    contextKey = "user_id"
)

// RequestID assigns each request a unique ID (honouring an inbound
// X-Request-ID if present) and attaches a request-scoped logger carrying that
// ID, so every log line for the request is correlatable.
func RequestID(base *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := r.Header.Get("X-Request-ID")
			if id == "" {
				id = uuid.NewString()
			}
			w.Header().Set("X-Request-ID", id)

			reqLogger := base.With("request_id", id)
			ctx := context.WithValue(r.Context(), ctxRequestID, id)
			ctx = logger.WithContext(ctx, reqLogger)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// AccessLog logs one structured line per request with method, path, status,
// and duration. It never logs request bodies (which may contain PII).
func AccessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)

		logger.FromContext(r.Context()).Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}

// Recover converts a panic into a logged 500 rather than crashing the server
// or leaking a stack trace to the client.
func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				logger.FromContext(r.Context()).Error("panic recovered", "panic", rec)
				Error(w, r, domain.NewValidation("An internal error occurred", nil))
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// Authenticate validates the Bearer access token and puts the user ID in the
// request context. Requests without a valid token get a generic 401.
func Authenticate(tokens *crypto.TokenManager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			const prefix = "Bearer "
			if !strings.HasPrefix(header, prefix) {
				Error(w, r, domain.NewUnauthorized("missing or malformed Authorization header"))
				return
			}

			claims, err := tokens.Verify(strings.TrimPrefix(header, prefix), crypto.AccessToken)
			if err != nil {
				Error(w, r, domain.NewUnauthorized("invalid or expired token"))
				return
			}

			ctx := context.WithValue(r.Context(), ctxUserID, claims.Subject)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// UserID returns the authenticated user ID from the context, or "" if the
// request was not authenticated.
func UserID(ctx context.Context) string {
	if id, ok := ctx.Value(ctxUserID).(string); ok {
		return id
	}
	return ""
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}
