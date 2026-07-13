package crypto

import (
	"crypto/rand"
	"crypto/rsa"
	"testing"
	"time"
)

// newTestManager builds a TokenManager from an in-memory RSA key so tests
// never depend on key files or hardcoded secrets.
func newTestManager(t *testing.T) *TokenManager {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return &TokenManager{
		privateKey: key,
		publicKey:  &key.PublicKey,
		issuer:     "anush-lms-test",
		accessTTL:  15 * time.Minute,
		refreshTTL: 168 * time.Hour,
	}
}

func TestTokenRoundTrip(t *testing.T) {
	m := newTestManager(t)
	now := time.Date(2026, 7, 13, 10, 0, 0, 0, time.UTC)

	token, err := m.Generate("user-123", AccessToken, now)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	claims, err := m.Verify(token, AccessToken)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.Subject != "user-123" {
		t.Errorf("subject = %q, want user-123", claims.Subject)
	}
}

func TestAccessTokenRejectedAsRefresh(t *testing.T) {
	m := newTestManager(t)
	now := time.Now()

	token, _ := m.Generate("user-123", AccessToken, now)
	if _, err := m.Verify(token, RefreshToken); err == nil {
		t.Error("expected an access token to be rejected when a refresh token is required")
	}
}

func TestExpiredTokenRejected(t *testing.T) {
	m := newTestManager(t)
	past := time.Now().Add(-24 * time.Hour)

	token, _ := m.Generate("user-123", AccessToken, past)
	if _, err := m.Verify(token, AccessToken); err == nil {
		t.Error("expected an expired token to be rejected")
	}
}
