package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

// The limit must actually bound attempts: the Nth+1 request in a window is
// rejected with 429, not passed through. This is the brute-force guard on
// /auth/login, so a regression here silently reopens unlimited password
// guessing.
func TestRateLimitBlocksAfterLimit(t *testing.T) {
	h := RateLimit(3)(okHandler())

	for i := 1; i <= 3; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
		req.RemoteAddr = "203.0.113.7:5555"
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d: got %d, want 200 (still within the limit)", i, rec.Code)
		}
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
	req.RemoteAddr = "203.0.113.7:5555"
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("4th request: got %d, want 429", rec.Code)
	}
	if got := rec.Header().Get("Retry-After"); got == "" {
		t.Error("429 response should carry a Retry-After header")
	}
}

// One noisy client must not lock everyone else out — the counter is per IP.
func TestRateLimitIsPerClientIP(t *testing.T) {
	h := RateLimit(1)(okHandler())

	first := httptest.NewRecorder()
	reqA := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
	reqA.RemoteAddr = "198.51.100.1:1111"
	h.ServeHTTP(first, reqA)

	blocked := httptest.NewRecorder()
	reqA2 := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
	reqA2.RemoteAddr = "198.51.100.1:2222" // same IP, different port
	h.ServeHTTP(blocked, reqA2)
	if blocked.Code != http.StatusTooManyRequests {
		t.Errorf("same IP second request: got %d, want 429 (port must not matter)", blocked.Code)
	}

	other := httptest.NewRecorder()
	reqB := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
	reqB.RemoteAddr = "198.51.100.99:3333"
	h.ServeHTTP(other, reqB)
	if other.Code != http.StatusOK {
		t.Errorf("different IP: got %d, want 200 — one client must not block others", other.Code)
	}
}

// Behind the reverse proxy every request arrives from the proxy's socket, so the
// real client must be read from X-Forwarded-For or all users would share one
// bucket (and a single attacker would lock out the whole company).
func TestRateLimitUsesForwardedClientIP(t *testing.T) {
	// The limiter keys on X-Real-IP, which the reverse proxy overwrites from the
	// socket it accepted, so a caller cannot forge it. X-Forwarded-For is NOT
	// trusted: it is client-supplied, and honouring it let an attacker send a
	// different value per request so every login landed in a fresh bucket,
	// bypassing brute-force protection entirely.
	h := RateLimit(1)(okHandler())

	send := func(realIP, xff string) int {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
		req.RemoteAddr = "10.0.0.5:4444" // the proxy
		if realIP != "" {
			req.Header.Set("X-Real-IP", realIP)
		}
		if xff != "" {
			req.Header.Set("X-Forwarded-For", xff)
		}
		h.ServeHTTP(rec, req)
		return rec.Code
	}

	if code := send("203.0.113.10", ""); code != http.StatusOK {
		t.Fatalf("first request from client A: got %d, want 200", code)
	}
	if code := send("203.0.113.10", ""); code != http.StatusTooManyRequests {
		t.Errorf("second request from client A: got %d, want 429", code)
	}
	// A different real client behind the same proxy is unaffected.
	if code := send("203.0.113.11", ""); code != http.StatusOK {
		t.Errorf("client B behind same proxy: got %d, want 200", code)
	}
}

// A spoofed X-Forwarded-For must NOT create a fresh rate-limit bucket. This is
// the regression guard for the bypass: before the fix, every request below
// returned 200 because each spoofed value keyed its own counter.
func TestRateLimitIgnoresSpoofedForwardedFor(t *testing.T) {
	h := RateLimit(2)(okHandler())

	send := func(xff string) int {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
		req.RemoteAddr = "198.51.100.7:5555" // the real attacker
		req.Header.Set("X-Real-IP", "198.51.100.7")
		req.Header.Set("X-Forwarded-For", xff) // rotating, attacker-controlled
		h.ServeHTTP(rec, req)
		return rec.Code
	}

	if code := send("1.1.1.1"); code != http.StatusOK {
		t.Fatalf("attempt 1: got %d, want 200", code)
	}
	if code := send("2.2.2.2"); code != http.StatusOK {
		t.Fatalf("attempt 2: got %d, want 200", code)
	}
	if code := send("3.3.3.3"); code != http.StatusTooManyRequests {
		t.Errorf("attempt 3 with a fresh spoofed XFF: got %d, want 429 (bypass!)", code)
	}
}

// With NO trusted proxy header the limiter must fall back to the real TCP peer,
// never to a client-supplied forwarding header — otherwise anyone reaching the
// backend directly could still rotate XFF to evade the limit.
func TestRateLimitFallsBackToRemoteAddrNotXFF(t *testing.T) {
	h := RateLimit(1)(okHandler())

	send := func(xff string) int {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
		req.RemoteAddr = "203.0.113.99:6666"
		req.Header.Set("X-Forwarded-For", xff) // no X-Real-IP: direct access
		h.ServeHTTP(rec, req)
		return rec.Code
	}

	if code := send("5.5.5.5"); code != http.StatusOK {
		t.Fatalf("first direct request: got %d, want 200", code)
	}
	if code := send("6.6.6.6"); code != http.StatusTooManyRequests {
		t.Errorf("second direct request with a new spoofed XFF: got %d, want 429", code)
	}
}

// A non-positive limit disables throttling entirely (pass-through), so the
// feature can be turned off by configuration without code changes.
func TestRateLimitDisabledWhenNonPositive(t *testing.T) {
	h := RateLimit(0)(okHandler())
	for i := 0; i < 50; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/auth/login", nil)
		req.RemoteAddr = "192.0.2.1:9999"
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d with limiter disabled: got %d, want 200", i, rec.Code)
		}
	}
}
