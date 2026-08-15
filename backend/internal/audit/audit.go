// Package audit records an append-only trail of who changed what.
//
// This is a lending system: money records and KYC documents are the assets, and
// without a trail there is no way to answer "who edited this ₹50,000 payment?"
// or "who downloaded this customer's Aadhaar?" — the questions that matter both
// operationally and for a data-protection incident. The audit_log table existed
// from the first migration but nothing ever wrote to it; this package is that
// writer.
//
// Design decisions:
//   - Best-effort by default. An audit failure must not roll back a payment the
//     borrower has already handed over cash for, so Record logs and swallows.
//     Use RecordTx when the trail must be atomic with the change (preferred for
//     money writes: the row and its audit entry commit together).
//   - Never store secrets or unmasked KYC. Callers pass already-safe values;
//     MaskedValues helps by dropping known-sensitive keys.
//   - Append-only: no update or delete API is provided here.
package audit

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"strings"

	"github.com/anush-capitals/lms-backend/internal/httpx"
	"github.com/anush-capitals/lms-backend/internal/logger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Action is the verb recorded against an entity. Values must satisfy the
// audit_log_action_valid CHECK constraint in the schema.
type Action string

const (
	ActionCreate Action = "CREATE"
	ActionUpdate Action = "UPDATE"
	ActionDelete Action = "DELETE"
	ActionPost   Action = "POST" // a money movement (payment recorded)
	ActionLogin  Action = "LOGIN"
)

// Entity types. Kept as constants so a typo cannot fragment the trail.
const (
	EntityCollection = "collection"
	EntityLoan       = "loan"
	EntityCustomer   = "customer"
	EntityDocument   = "document"
	EntityUser       = "user"
)

// Entry is one audit record. Before/After are optional JSON-able snapshots.
type Entry struct {
	EntityType string
	EntityID   int64
	Action     Action
	Before     any
	After      any
}

// Recorder writes audit entries.
type Recorder struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Recorder { return &Recorder{pool: pool} }

const insertSQL = `
	INSERT INTO audit_log (entity_type, entity_id, action, user_id, before_values, after_values, ip_address, user_agent)
	VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`

// Record writes an entry outside any transaction. Failures are logged, never
// returned: losing the trail is bad, but failing the user's operation because
// the trail could not be written is worse.
func (r *Recorder) Record(ctx context.Context, e Entry) {
	if err := r.write(ctx, r.pool, e); err != nil {
		logger.FromContext(ctx).Error("audit write failed — change is NOT in the audit trail",
			"entity_type", e.EntityType, "entity_id", e.EntityID, "action", string(e.Action), "error", err)
	}
}

// RecordTx writes an entry inside tx, so the audit row and the change it
// describes commit or roll back together. Errors ARE returned: if the caller
// chose transactional auditing, a missing trail should abort the change.
func (r *Recorder) RecordTx(ctx context.Context, tx pgx.Tx, e Entry) error {
	return r.write(ctx, tx, e)
}

// execer is the pgx subset needed to insert a row; satisfied by *pgxpool.Pool
// and by pgx.Tx, so the same writer serves both the best-effort and the
// transactional path.
type execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

func (r *Recorder) write(ctx context.Context, q execer, e Entry) error {
	before, err := toJSON(e.Before)
	if err != nil {
		return err
	}
	after, err := toJSON(e.After)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, insertSQL,
		e.EntityType, e.EntityID, string(e.Action),
		userIDFromContext(ctx), before, after,
		ipFromContext(ctx), userAgentFromContext(ctx),
	)
	return err
}

func toJSON(v any) (any, error) {
	if v == nil {
		return nil, nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return b, nil
}

// userIDFromContext resolves the acting operator from the auth middleware.
// Returns nil for unauthenticated actions (the column is nullable).
func userIDFromContext(ctx context.Context) *int64 {
	raw := httpx.UserID(ctx)
	if raw == "" {
		return nil
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return nil
	}
	return &id
}

// sensitiveHeaderCtxKeys carry request metadata attached by middleware.
type ctxKey string

// RequestMeta is stashed in the context by Middleware so the recorder can note
// where a change came from without every caller threading an *http.Request.
type RequestMeta struct {
	IP        string
	UserAgent string
}

const metaKey ctxKey = "audit.meta"

// Middleware captures the client IP and user agent for later audit writes.
// Mounted globally; it stores nothing sensitive (no headers, no body).
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		meta := RequestMeta{IP: clientIP(r), UserAgent: truncate(r.UserAgent(), 400)}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), metaKey, meta)))
	})
}

func metaFromContext(ctx context.Context) RequestMeta {
	if m, ok := ctx.Value(metaKey).(RequestMeta); ok {
		return m
	}
	return RequestMeta{}
}

// ipFromContext returns the client IP as a value pgx can store in INET, or nil
// when it is unknown/unparseable (a bad value must not fail the insert).
func ipFromContext(ctx context.Context) *string {
	ip := metaFromContext(ctx).IP
	if ip == "" || net.ParseIP(ip) == nil {
		return nil
	}
	return &ip
}

func userAgentFromContext(ctx context.Context) *string {
	ua := metaFromContext(ctx).UserAgent
	if ua == "" {
		return nil
	}
	return &ua
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
