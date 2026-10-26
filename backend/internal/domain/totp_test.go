package domain

import (
	"encoding/base32"
	"strings"
	"testing"
	"time"
)

// RFC 6238 appendix B (SHA1, seed "12345678901234567890"), last 6 digits.
func TestTOTPMatchesRFC6238(t *testing.T) {
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString([]byte("12345678901234567890"))
	cases := map[int64]string{59: "287082", 1111111109: "081804", 1111111111: "050471", 1234567890: "005924", 2000000000: "279037"}
	for unix, want := range cases {
		got, err := TOTPCodeAt(secret, TOTPStep(time.Unix(unix, 0)))
		if err != nil || got != want {
			t.Errorf("t=%d: got %q (%v), want %q", unix, got, err, want)
		}
	}
}

func TestVerifyTOTPWindowAndStep(t *testing.T) {
	secret, err := NewTOTPSecret()
	if err != nil || len(secret) != 32 {
		t.Fatalf("secret %q %v", secret, err)
	}
	now := time.Unix(1_800_000_015, 0)
	cur := TOTPStep(now)
	for d := int64(-1); d <= 1; d++ {
		code, _ := TOTPCodeAt(secret, cur+d)
		step, ok := VerifyTOTP(secret, code, now)
		if !ok || step != cur+d {
			t.Errorf("step %+d: ok=%v step=%d", d, ok, step)
		}
	}
	old, _ := TOTPCodeAt(secret, cur-2)
	if _, ok := VerifyTOTP(secret, old, now); ok {
		t.Error("a code two steps old must be refused")
	}
	for _, bad := range []string{"", "12345", "1234567", "12a456", " "} {
		if _, ok := VerifyTOTP(secret, bad, now); ok {
			t.Errorf("malformed %q accepted", bad)
		}
	}
}

func TestTOTPAuthURI(t *testing.T) {
	u := TOTPAuthURI("Anush LMS", "a@b.com", "ABC")
	if !strings.HasPrefix(u, "otpauth://totp/Anush%20LMS:a@b.com?") || !strings.Contains(u, "secret=ABC") || !strings.Contains(u, "issuer=Anush+LMS") {
		t.Errorf("uri %q", u)
	}
	if ValidateTOTPCodeInput("123456") != nil || ValidateTOTPCodeInput("12345x") == nil || ValidateTOTPCodeInput("") == nil {
		t.Error("code input validation")
	}
}
