package httpx

import (
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/anush-capitals/lms-backend/internal/domain"
)

// RateLimit throttles requests per client IP using a fixed window.
//
// This exists to close an unauthenticated brute-force path: /auth/login was
// completely unthrottled, so an attacker could try passwords against a known
// admin address indefinitely. bcrypt (cost 12) slows each attempt but does not
// bound the total.
//
// Deliberately dependency-free and in-process: at this scale (a single backend
// container, ~10-15 operators) a local counter is sufficient and adds no
// supply-chain surface. Two consequences to be aware of:
//   - Counters reset when the process restarts.
//   - With multiple backend replicas the effective limit is per replica, so a
//     shared store (Redis) would be needed before scaling out horizontally.
//
// The limiter keys on the client IP, taking the LEFTMOST X-Forwarded-For entry
// when present because the app runs behind a reverse proxy (Caddy) that appends
// the real client address. Callers must therefore only mount this behind a
// trusted proxy — a directly-exposed server would let a client spoof the header.
func RateLimit(perMinute int) func(http.Handler) http.Handler {
	if perMinute <= 0 {
		// Explicitly disabled — pass through untouched.
		return func(next http.Handler) http.Handler { return next }
	}
	lim := &limiter{
		limit:  perMinute,
		window: time.Minute,
		hits:   make(map[string]*window),
	}
	// Drop idle entries so the map cannot grow without bound from scanning IPs.
	go lim.reap()

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !lim.allow(clientIP(r)) {
				w.Header().Set("Retry-After", "60")
				Error(w, r, domain.NewTooManyRequests(
					"Too many attempts. Please wait a minute and try again."))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

type window struct {
	count int
	start time.Time
}

type limiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	hits   map[string]*window
}

func (l *limiter) allow(key string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	w, ok := l.hits[key]
	if !ok || now.Sub(w.start) >= l.window {
		l.hits[key] = &window{count: 1, start: now}
		return true
	}
	if w.count >= l.limit {
		return false
	}
	w.count++
	return true
}

// reap periodically discards windows that have fully expired.
func (l *limiter) reap() {
	t := time.NewTicker(5 * time.Minute)
	defer t.Stop()
	for range t.C {
		cutoff := time.Now().Add(-2 * l.window)
		l.mu.Lock()
		for k, w := range l.hits {
			if w.start.Before(cutoff) {
				delete(l.hits, k)
			}
		}
		l.mu.Unlock()
	}
}

// clientIP resolves the caller's address, preferring the reverse proxy's
// X-Forwarded-For (leftmost = original client) and falling back to the socket.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// "client, proxy1, proxy2" — take the first entry.
		for i := 0; i < len(xff); i++ {
			if xff[i] == ',' {
				return trimSpace(xff[:i])
			}
		}
		return trimSpace(xff)
	}
	if xr := r.Header.Get("X-Real-IP"); xr != "" {
		return trimSpace(xr)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func trimSpace(s string) string {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t') {
		end--
	}
	return s[start:end]
}
