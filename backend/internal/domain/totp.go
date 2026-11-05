package domain

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" //nolint:gosec // RFC 6238 / Google Authenticator use HMAC-SHA1; it is not used for collision resistance.
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// Two-factor authentication: time-based one-time passwords (RFC 6238) as used
// by Google Authenticator — SHA1, 6 digits, 30-second steps.
const (
	totpPeriod = 30
	totpDigits = 6
	// totpSkew accepts the code of the previous and next step too, for phone
	// clocks a little off. Replay is stopped separately (see Verify's step).
	totpSkew = 1
)

var b32 = base32.StdEncoding.WithPadding(base32.NoPadding)

// NewTOTPSecret returns a fresh random 160-bit secret, base32 without padding
// (the form authenticator apps take).
func NewTOTPSecret() (string, error) {
	buf := make([]byte, 20)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return b32.EncodeToString(buf), nil
}

// TOTPStep is the 30-second step a moment falls in.
func TOTPStep(t time.Time) int64 { return t.Unix() / totpPeriod }

// TOTPCodeAt returns the code for one step.
func TOTPCodeAt(secret string, step int64) (string, error) {
	key, err := b32.DecodeString(strings.ToUpper(strings.TrimSpace(secret)))
	if err != nil {
		return "", fmt.Errorf("totp: bad secret: %w", err)
	}
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], uint64(step))
	mac := hmac.New(sha1.New, key)
	mac.Write(msg[:])
	sum := mac.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	bin := binary.BigEndian.Uint32(sum[off:off+4]) & 0x7fffffff
	return fmt.Sprintf("%0*d", totpDigits, bin%1_000_000), nil
}

// VerifyTOTP checks a 6-digit code against the steps around now and returns
// the step it matched. Callers must refuse a step at or before the last one
// accepted for the account, so a code can never be used twice.
func VerifyTOTP(secret, code string, now time.Time) (int64, bool) {
	code = strings.TrimSpace(code)
	if len(code) != totpDigits {
		return 0, false
	}
	for _, c := range code {
		if c < '0' || c > '9' {
			return 0, false
		}
	}
	cur := TOTPStep(now)
	for d := -totpSkew; d <= totpSkew; d++ {
		want, err := TOTPCodeAt(secret, cur+int64(d))
		if err != nil {
			return 0, false
		}
		if subtle.ConstantTimeCompare([]byte(want), []byte(code)) == 1 {
			return cur + int64(d), true
		}
	}
	return 0, false
}

// TOTPAuthURI is the otpauth:// link an authenticator app scans (as a QR code).
func TOTPAuthURI(issuer, account, secret string) string {
	q := url.Values{}
	q.Set("secret", secret)
	q.Set("issuer", issuer)
	q.Set("algorithm", "SHA1")
	q.Set("digits", "6")
	q.Set("period", "30")
	return "otpauth://totp/" + url.PathEscape(issuer+":"+account) + "?" + q.Encode()
}

// ValidateTOTPCodeInput rejects a code that is not 6 digits before any secret
// is touched.
func ValidateTOTPCodeInput(code string) error {
	code = strings.TrimSpace(code)
	if len(code) != totpDigits || strings.Trim(code, "0123456789") != "" {
		return NewValidation("Enter the 6-digit code from your authenticator app",
			map[string]string{"code": "Enter the 6-digit code"})
	}
	return nil
}
