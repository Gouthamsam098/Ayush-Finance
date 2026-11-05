package domain

import (
	"strings"
	"testing"
)

func TestNormalizeResetEmail(t *testing.T) {
	ok := map[string]string{
		"Ravi@Example.com":     "ravi@example.com",
		"  ravi@example.com  ": "ravi@example.com",
		"a.b+c@sub.example.in": "a.b+c@sub.example.in",
	}
	for in, want := range ok {
		got, err := NormalizeResetEmail(in)
		if err != nil || got != want {
			t.Errorf("NormalizeResetEmail(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, bad := range []string{"", "   ", "ravi", "ravi@", "@example.com", "ravi@example", "a b@example.com",
		strings.Repeat("a", 250) + "@example.com"} {
		if _, err := NormalizeResetEmail(bad); err == nil {
			t.Errorf("NormalizeResetEmail(%q) accepted, want a validation error", bad)
		}
	}
}
