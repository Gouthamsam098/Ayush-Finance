package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"io"

	"golang.org/x/crypto/hkdf"
)

// SecretBox encrypts small secrets for storage (AES-256-GCM). Used for the
// two-factor (TOTP) secrets, so a copy of the database alone — a backup, a
// leaked dump — does not reveal them.
type SecretBox struct {
	aead cipher.AEAD
	// fallback, when set, opens values sealed under an earlier key (see
	// WithFallback). Sealing always uses this box's own key.
	fallback *SecretBox
}

// WithFallback returns b with `old` tried when b's own key cannot open a value
// — so secrets sealed under a previous key keep working after a key change,
// while every new secret is sealed under b's key.
func (b *SecretBox) WithFallback(old *SecretBox) *SecretBox {
	return &SecretBox{aead: b.aead, fallback: old}
}

// NewSecretBox derives the encryption key from keyMaterial with HKDF-SHA256,
// bound to purpose (different purposes get unrelated keys).
func NewSecretBox(keyMaterial []byte, purpose string) (*SecretBox, error) {
	if len(keyMaterial) == 0 {
		return nil, errors.New("secretbox: no key material")
	}
	key := make([]byte, 32)
	if _, err := io.ReadFull(hkdf.New(sha256.New, keyMaterial, nil, []byte(purpose)), key); err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &SecretBox{aead: aead}, nil
}

// Seal encrypts plaintext; the result is base64(nonce || ciphertext).
func (b *SecretBox) Seal(plaintext string) (string, error) {
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	out := b.aead.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.RawStdEncoding.EncodeToString(out), nil
}

// Open decrypts a value from Seal. It fails if the value was altered or was
// sealed under another key.
func (b *SecretBox) Open(sealed string) (string, error) {
	raw, err := base64.RawStdEncoding.DecodeString(sealed)
	if err != nil {
		return "", err
	}
	n := b.aead.NonceSize()
	if len(raw) < n {
		return "", errors.New("secretbox: value too short")
	}
	plain, err := b.aead.Open(nil, raw[:n], raw[n:], nil)
	if err != nil {
		if b.fallback != nil {
			return b.fallback.Open(sealed)
		}
		return "", err
	}
	return string(plain), nil
}

// SecretKeyMaterial returns key material for SecretBox derived from the token
// signing key: a server secret that never enters the database. It is the
// fallback when no MFA_ENCRYPTION_KEY is configured (development), and is kept
// as a read-only fallback key after one is, so secrets sealed under it still
// open. Rotating the signing key makes values sealed under it unreadable
// (users then set up two-factor again; an admin can reset it).
func (m *TokenManager) SecretKeyMaterial() []byte {
	return x509.MarshalPKCS1PrivateKey(m.privateKey)
}
