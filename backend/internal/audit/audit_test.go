package audit

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The middleware must capture where a change came from, without stashing
// anything sensitive (no auth header, no body).
func TestMiddlewareCapturesClientIPAndUserAgent(t *testing.T) {
	var got RequestMeta
	h := Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got = metaFromContext(r.Context())
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/loans/1/collections", nil)
	req.RemoteAddr = "203.0.113.9:5555"
	req.Header.Set("User-Agent", "Mozilla/5.0 (test)")
	h.ServeHTTP(httptest.NewRecorder(), req)

	if got.IP != "203.0.113.9" {
		t.Errorf("IP = %q, want 203.0.113.9 (port must be stripped)", got.IP)
	}
	if got.UserAgent != "Mozilla/5.0 (test)" {
		t.Errorf("UserAgent = %q", got.UserAgent)
	}
}

// Behind the reverse proxy the socket address is the proxy, so the real client
// must come from X-Forwarded-For or every audit row would say "the proxy did it".
func TestMiddlewarePrefersForwardedFor(t *testing.T) {
	var got RequestMeta
	h := Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got = metaFromContext(r.Context())
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.5:1234" // the proxy
	req.Header.Set("X-Forwarded-For", "198.51.100.22, 10.0.0.5")
	h.ServeHTTP(httptest.NewRecorder(), req)

	if got.IP != "198.51.100.22" {
		t.Errorf("IP = %q, want the leftmost forwarded client 198.51.100.22", got.IP)
	}
}

// A malformed or absent IP must become NULL rather than break the INSERT — an
// audit write failing would (on the transactional path) roll back a real payment.
func TestIPFromContextRejectsGarbage(t *testing.T) {
	for _, ip := range []string{"", "not-an-ip", "999.999.999.999", "unix-socket"} {
		ctx := context.WithValue(context.Background(), metaKey, RequestMeta{IP: ip})
		if got := ipFromContext(ctx); got != nil {
			t.Errorf("ip %q should be stored as NULL, got %q", ip, *got)
		}
	}
	ctx := context.WithValue(context.Background(), metaKey, RequestMeta{IP: "203.0.113.1"})
	if got := ipFromContext(ctx); got == nil || *got != "203.0.113.1" {
		t.Error("a valid IP must be preserved")
	}
}

// A very long user agent must be truncated so a hostile client cannot bloat the
// audit table.
func TestUserAgentIsTruncated(t *testing.T) {
	long := make([]byte, 1000)
	for i := range long {
		long[i] = 'A'
	}
	var got RequestMeta
	h := Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got = metaFromContext(r.Context())
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("User-Agent", string(long))
	h.ServeHTTP(httptest.NewRecorder(), req)

	if len(got.UserAgent) != 400 {
		t.Errorf("user agent length = %d, want it capped at 400", len(got.UserAgent))
	}
}

// Snapshots are stored as JSONB, so they must marshal — and nil must stay NULL
// rather than becoming the literal string "null".
func TestSnapshotEncoding(t *testing.T) {
	if v, err := toJSON(nil); err != nil || v != nil {
		t.Errorf("nil snapshot should encode to NULL, got %v (err %v)", v, err)
	}
	v, err := toJSON(map[string]any{"amount": 1500.5, "mode": "CASH"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	b, ok := v.([]byte)
	if !ok {
		t.Fatalf("expected []byte for JSONB, got %T", v)
	}
	var round map[string]any
	if err := json.Unmarshal(b, &round); err != nil {
		t.Fatalf("result is not valid JSON: %v", err)
	}
	if round["mode"] != "CASH" {
		t.Errorf("round-trip lost data: %v", round)
	}
}

// Actions must match the schema's CHECK constraint, or every insert fails at
// runtime with a constraint violation.
func TestActionsMatchSchemaConstraint(t *testing.T) {
	allowedBySchema := map[string]bool{
		"CREATE": true, "UPDATE": true, "DELETE": true,
		"POST": true, "APPROVE": true, "LOGIN": true, "MFA_SETUP": true,
	}
	for _, a := range []Action{ActionCreate, ActionUpdate, ActionDelete, ActionPost, ActionLogin} {
		if !allowedBySchema[string(a)] {
			t.Errorf("action %q is not permitted by audit_log_action_valid", a)
		}
	}
}
