package crypto

import "testing"

func TestSecretBoxRoundTripAndTamper(t *testing.T) {
	box, err := NewSecretBox([]byte("server key material"), "anush-lms/mfa-secret/v1")
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := box.Seal("JBSWY3DPEHPK3PXP")
	if err != nil {
		t.Fatal(err)
	}
	if len(sealed) > 200 {
		t.Fatalf("sealed value %d chars does not fit users.mfa_secret (200)", len(sealed))
	}
	got, err := box.Open(sealed)
	if err != nil || got != "JBSWY3DPEHPK3PXP" {
		t.Fatalf("round trip: %q %v", got, err)
	}
	again, _ := box.Seal("JBSWY3DPEHPK3PXP")
	if again == sealed {
		t.Error("two seals of the same secret must differ (random nonce)")
	}
	tampered := []byte(sealed)
	tampered[len(tampered)-2] ^= 1
	if _, err := box.Open(string(tampered)); err == nil {
		t.Error("an altered value must not open")
	}
	other, _ := NewSecretBox([]byte("another key"), "anush-lms/mfa-secret/v1")
	if _, err := other.Open(sealed); err == nil {
		t.Error("a value sealed under another key must not open")
	}
	purpose, _ := NewSecretBox([]byte("server key material"), "something-else")
	if _, err := purpose.Open(sealed); err == nil {
		t.Error("a different purpose must derive a different key")
	}
}

// Moving to a dedicated MFA key must not lock out users enrolled under the old
// (JWT-derived) key: those secrets still open, new ones are sealed under the
// new key only.
func TestSecretBoxFallbackKey(t *testing.T) {
	legacy, _ := NewSecretBox([]byte("jwt-derived material"), "anush-lms/mfa-secret/v1")
	current, _ := NewSecretBox([]byte("dedicated 32-byte mfa key ......"), "anush-lms/mfa-secret/v2")
	box := current.WithFallback(legacy)

	old, _ := legacy.Seal("OLDSECRET")
	if got, err := box.Open(old); err != nil || got != "OLDSECRET" {
		t.Fatalf("a secret sealed under the old key must still open: %q %v", got, err)
	}
	fresh, _ := box.Seal("NEWSECRET")
	if got, err := current.Open(fresh); err != nil || got != "NEWSECRET" {
		t.Fatalf("new secrets must be sealed under the current key: %q %v", got, err)
	}
	if _, err := legacy.Open(fresh); err == nil {
		t.Error("a new secret must not be readable with the old key")
	}
	stranger, _ := NewSecretBox([]byte("unrelated"), "anush-lms/mfa-secret/v1")
	alien, _ := stranger.Seal("X")
	if _, err := box.Open(alien); err == nil {
		t.Error("a value sealed under neither key must not open")
	}
}
