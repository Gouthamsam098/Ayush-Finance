package auth

import (
	"strings"
	"sync"
	"time"
)

// Per-account brute-force guard. The per-IP rate limit alone does not stop a
// distributed guess against ONE account (many IPs, a few tries each), nor an
// attacker who has the password and keeps opening fresh two-factor challenges.
// Failed password and authenticator-code attempts therefore also count against
// the account: after accountMaxFailures within accountFailWindow the account is
// locked for accountLockout — every attempt is refused, even with the right
// password, until the lock expires.
//
// Keyed by the normalised email, whether or not an account exists, so a lock
// (and its message) cannot be used to discover which emails are real.
// In-process like the IP limiter: it resets on restart and is per replica.
const (
	accountMaxFailures = 5
	accountFailWindow  = 15 * time.Minute
	accountLockout     = 15 * time.Minute
)

const lockedMessage = "Too many failed sign-in attempts for this account. Try again in 15 minutes."

type accountAttempts struct {
	failures    int
	first       time.Time
	lockedUntil time.Time
}

type accountGuard struct {
	mu   sync.Mutex
	seen map[string]*accountAttempts
}

func newAccountGuard() *accountGuard { return &accountGuard{seen: map[string]*accountAttempts{}} }

func accountKey(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

// locked reports whether the account is currently locked out.
func (g *accountGuard) locked(email string, now time.Time) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	a, ok := g.seen[accountKey(email)]
	return ok && now.Before(a.lockedUntil)
}

// fail records a failed attempt, locking the account once the threshold is hit.
func (g *accountGuard) fail(email string, now time.Time) {
	g.mu.Lock()
	defer g.mu.Unlock()
	k := accountKey(email)
	a, ok := g.seen[k]
	if !ok || now.Sub(a.first) > accountFailWindow {
		a = &accountAttempts{first: now}
		g.seen[k] = a
	}
	a.failures++
	if a.failures >= accountMaxFailures {
		a.lockedUntil = now.Add(accountLockout)
		a.failures, a.first = 0, now
	}
	if len(g.seen) > 10000 { // bound memory under a spray of random emails
		for key, v := range g.seen {
			if now.Sub(v.first) > accountFailWindow && !now.Before(v.lockedUntil) {
				delete(g.seen, key)
			}
		}
	}
}

// succeed clears the account's failure history after a correct sign-in.
func (g *accountGuard) succeed(email string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.seen, accountKey(email))
}
