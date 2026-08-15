package domain

import (
	"strings"
	"testing"
)

// Upload filenames are fully attacker-controlled (multipart header) and are
// echoed back in a Content-Disposition header, so they must never carry a path
// component or a character that can break out of the quoted parameter.
func TestSanitizeFileName(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"plain name kept", "aadhaar.pdf", "aadhaar.pdf"},
		{"spaces kept", "Ravi Kumar PAN.jpg", "Ravi Kumar PAN.jpg"},
		{"unix path stripped", "../../etc/passwd", "passwd"},
		{"windows path stripped", `C:\Users\x\secret.pdf`, "secret.pdf"},
		{"double quote removed", `evil".pdf`, "evil.pdf"},
		{"CR LF removed", "a\r\nX-Injected: 1.pdf", "aX-Injected: 1.pdf"},
		// A backslash is a Windows path separator, so everything before the last
		// one is a directory component and is correctly dropped.
		{"backslash treated as path separator", `we\ird.png`, "ird.png"},
		{"control chars removed", "a\x00b\x1fc.pdf", "abc.pdf"},
		{"empty falls back", "", "document"},
		{"dots only falls back", "..", "document"},
		{"single dot falls back", ".", "document"},
		{"whitespace trimmed", "  scan.pdf  ", "scan.pdf"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := SanitizeFileName(tt.input); got != tt.want {
				t.Errorf("SanitizeFileName(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

// Whatever comes out must be safe to place inside a quoted header value.
func TestSanitizedNameIsHeaderSafe(t *testing.T) {
	nasty := []string{
		`x"; Set-Cookie: a=b`,
		"x\r\nLocation: http://evil.test",
		"../../../../etc/shadow",
		strings.Repeat("A", 500) + ".pdf",
		"\x07\x08bell.pdf",
	}
	for _, in := range nasty {
		got := SanitizeFileName(in)
		if strings.ContainsAny(got, "\"\\\r\n") {
			t.Errorf("SanitizeFileName(%q) = %q — still contains a header-breaking character", in, got)
		}
		if strings.ContainsAny(got, "/") {
			t.Errorf("SanitizeFileName(%q) = %q — still contains a path separator", in, got)
		}
		if got == "" {
			t.Errorf("SanitizeFileName(%q) returned an empty name", in)
		}
		if len(got) > maxFileNameLen {
			t.Errorf("SanitizeFileName(%q) length %d exceeds the %d cap", in, len(got), maxFileNameLen)
		}
	}
}
