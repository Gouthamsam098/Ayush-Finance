package domain

import (
	"testing"
	"time"
)

func TestTokenStillValid(t *testing.T) {
	changed := time.Date(2026, 10, 26, 11, 0, 5, 700_000_000, time.UTC) // 11:00:05.7
	u := &User{PasswordChangedAt: &changed}
	cases := []struct {
		name   string
		issued time.Time
		want   bool
	}{
		{"issued a minute before the change", changed.Add(-time.Minute), false},
		{"issued the second before", time.Date(2026, 10, 26, 11, 0, 4, 0, time.UTC), false},
		// JWT iat is whole seconds: the fresh token minted right after the change
		// carries 11:00:05 and must stay valid.
		{"issued in the same second (JWT precision)", time.Date(2026, 10, 26, 11, 0, 5, 0, time.UTC), true},
		{"issued after the change", changed.Add(time.Minute), true},
	}
	for _, c := range cases {
		if got := u.TokenStillValid(c.issued); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
	if !(&User{}).TokenStillValid(time.Unix(0, 0)) {
		t.Error("a user whose password never changed has no cutoff")
	}
}
