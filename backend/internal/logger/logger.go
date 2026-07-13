// Package logger provides a structured JSON logger built on the standard
// library slog. It emits machine-parseable logs and redacts fields whose
// keys look sensitive, so credentials and PII never reach log storage.
package logger

import (
	"context"
	"log/slog"
	"os"
	"strings"
)

// sensitiveKeys are log attribute keys whose values are always redacted.
// Matching is case-insensitive and substring-based so, e.g., "password_hash"
// and "refreshToken" are both caught.
var sensitiveKeys = []string{
	"password", "passwd", "secret", "token", "authorization",
	"jwt", "mfa_secret", "cookie", "api_key", "apikey",
}

const redacted = "[REDACTED]"

// New builds a JSON slog.Logger at the given level, writing to stdout.
func New(level string) *slog.Logger {
	opts := &slog.HandlerOptions{
		Level:       parseLevel(level),
		ReplaceAttr: redactSensitive,
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, opts))
}

// FromContext returns the request-scoped logger if one was attached by
// middleware, otherwise the default logger. Handlers should prefer this so
// every log line carries the request_id.
func FromContext(ctx context.Context) *slog.Logger {
	if l, ok := ctx.Value(loggerKey{}).(*slog.Logger); ok {
		return l
	}
	return slog.Default()
}

// WithContext attaches a logger to the context for later retrieval.
func WithContext(ctx context.Context, l *slog.Logger) context.Context {
	return context.WithValue(ctx, loggerKey{}, l)
}

type loggerKey struct{}

func parseLevel(level string) slog.Level {
	switch strings.ToLower(level) {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func redactSensitive(_ []string, a slog.Attr) slog.Attr {
	if a.Key == slog.TimeKey {
		a.Key = "timestamp"
		return a
	}
	lowered := strings.ToLower(a.Key)
	for _, s := range sensitiveKeys {
		if strings.Contains(lowered, s) {
			return slog.String(a.Key, redacted)
		}
	}
	return a
}
