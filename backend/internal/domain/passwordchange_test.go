package domain

import (
	"strings"
	"testing"
)

func TestPasswordChangeInputValidate(t *testing.T) {
	cases := []struct {
		name      string
		in        PasswordChangeInput
		wantField string // "" = valid
	}{
		{"valid", PasswordChangeInput{Current: "OldPass#1", New: "NewPass#2026"}, ""},
		{"missing current", PasswordChangeInput{Current: "", New: "NewPass#2026"}, "current_password"},
		{"new too short", PasswordChangeInput{Current: "OldPass#1", New: "short"}, "new_password"},
		{"new too long", PasswordChangeInput{Current: "OldPass#1", New: strings.Repeat("x", 73)}, "new_password"},
		{"new equals current", PasswordChangeInput{Current: "SamePass#1", New: "SamePass#1"}, "new_password"},
		{"exactly 8 is fine", PasswordChangeInput{Current: "OldPass#1", New: "abcd1234"}, ""},
		{"exactly 72 is fine", PasswordChangeInput{Current: "OldPass#1", New: strings.Repeat("y", 72)}, ""},
		// 3 characters of 3 bytes each: 9 bytes, but only 3 characters — too short.
		{"min counts characters, not bytes", PasswordChangeInput{Current: "OldPass#1", New: "नमस"}, "new_password"},
		// 25 Devanagari characters = 75 bytes: over bcrypt's 72-byte limit.
		{"max counts bytes", PasswordChangeInput{Current: "OldPass#1", New: strings.Repeat("न", 25)}, "new_password"},
		{"8 non-English characters within 72 bytes is fine", PasswordChangeInput{Current: "OldPass#1", New: strings.Repeat("न", 8)}, ""},
	}
	for _, tc := range cases {
		err := tc.in.Validate()
		if tc.wantField == "" {
			if err != nil {
				t.Errorf("%s: unexpected error %v", tc.name, err)
			}
			continue
		}
		de, ok := AsError(err)
		if !ok || de.Fields[tc.wantField] == "" {
			t.Errorf("%s: want a %q field error, got %v", tc.name, tc.wantField, err)
		}
	}
}
