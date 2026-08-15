package domain

import "testing"

// The multipart Content-Type is attacker-controlled, so uploads are validated
// against the file's real magic bytes. Without this, an HTML/script payload
// could be stored as "image/png" and later served back with that type, giving
// stored XSS on preview in the app's own origin.
func TestDetectDocumentMIME(t *testing.T) {
	tests := []struct {
		name    string
		content []byte
		want    string
	}{
		{"jpeg", []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10}, "image/jpeg"},
		{"png", []byte("\x89PNG\r\n\x1a\nIHDR"), "image/png"},
		{"webp", []byte("RIFF\x00\x00\x00\x00WEBPVP8 "), "image/webp"},
		{"pdf", []byte("%PDF-1.7\n%âãÏÓ"), "application/pdf"},

		{"html masquerading", []byte("<html><script>alert(1)</script>"), ""},
		{"svg (not allowed)", []byte(`<svg xmlns="http://www.w3.org/2000/svg">`), ""},
		{"windows executable", []byte{0x4D, 0x5A, 0x90, 0x00}, ""},
		{"elf executable", []byte{0x7F, 'E', 'L', 'F'}, ""},
		{"zip / office", []byte{0x50, 0x4B, 0x03, 0x04}, ""},
		{"empty", []byte{}, ""},
		{"too short to identify", []byte{0xFF}, ""},
		{"plain text", []byte("just some text"), ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := DetectDocumentMIME(tt.content); got != tt.want {
				t.Errorf("DetectDocumentMIME(%q) = %q, want %q", tt.name, got, tt.want)
			}
		})
	}
}

func TestDocumentContentMatchesDeclared(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\nIHDR")
	jpeg := []byte{0xFF, 0xD8, 0xFF, 0xE0}
	html := []byte("<html><script>steal()</script></html>")

	t.Run("honest png accepted", func(t *testing.T) {
		got, ok := DocumentContentMatchesDeclared(png, "image/png")
		if !ok || got != "image/png" {
			t.Errorf("honest upload rejected: detected=%q ok=%v", got, ok)
		}
	})

	t.Run("html declared as png is REJECTED", func(t *testing.T) {
		_, ok := DocumentContentMatchesDeclared(html, "image/png")
		if ok {
			t.Error("an HTML payload declared as image/png must be rejected — stored-XSS vector")
		}
	})

	t.Run("real png declared as pdf is REJECTED", func(t *testing.T) {
		_, ok := DocumentContentMatchesDeclared(png, "application/pdf")
		if ok {
			t.Error("mismatched declared type must be rejected (content confusion)")
		}
	})

	t.Run("jpeg declared as jpeg accepted", func(t *testing.T) {
		got, ok := DocumentContentMatchesDeclared(jpeg, "image/jpeg")
		if !ok || got != "image/jpeg" {
			t.Errorf("honest jpeg rejected: detected=%q ok=%v", got, ok)
		}
	})

	t.Run("unrecognised content rejected even with an allowed declared type", func(t *testing.T) {
		detected, ok := DocumentContentMatchesDeclared([]byte("nonsense"), "image/png")
		if ok {
			t.Error("unrecognised content must be rejected")
		}
		if detected != "" {
			t.Errorf("detected = %q, want empty for unrecognised content", detected)
		}
	})
}
