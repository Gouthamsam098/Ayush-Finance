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
			if !lim.allow(bucketKey(ClientIP(r))) {
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

// ClientIP resolves the caller's address for rate limiting and the audit trail.
//
// X-Real-IP is honoured ONLY when the TCP peer is our reverse proxy — a
// loopback or private-network address (Caddy on the Docker network). The proxy
// sets it from the socket it accepted (`header_up X-Real-IP {remote_host}`), so
// it cannot be forged through the proxy; but a caller reaching the backend
// directly could send any value and land every login attempt in a fresh
// rate-limit bucket, so from a public peer the header is ignored.
//
// X-Forwarded-For is never trusted: it is client-supplied and the proxy appends
// to it rather than replacing it, so its leftmost entry is attacker-controlled.
// Falling back to RemoteAddr is always safe — it is the real TCP peer.
func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if xr := trimSpace(r.Header.Get("X-Real-IP")); xr != "" && isProxyPeer(host) && net.ParseIP(xr) != nil {
		return xr
	}
	return host
}

// isProxyPeer reports whether the TCP peer is on loopback or a private network,
// i.e. could be our own reverse proxy rather than an internet client.
func isProxyPeer(host string) bool {
	ip := net.ParseIP(host)
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate())
}

// bucketKey groups IPv6 clients by their /64: one subscriber is routinely
// handed a whole /64, so per-address buckets would let a single attacker rotate
// through 2^64 fresh limits. IPv4 addresses are used as they are.
func bucketKey(ip string) string {
	parsed := net.ParseIP(ip)
	if parsed == nil || parsed.To4() != nil {
		return ip
	}
	return parsed.Mask(net.CIDRMask(64, 128)).String() + "/64"
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
