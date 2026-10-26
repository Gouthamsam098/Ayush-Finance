package domain

import "unicode/utf8"

// maxPasswordBytes is bcrypt's input limit. Longer input is refused here rather
// than failing at hash time.
const maxPasswordBytes = 72

// PasswordChangeInput is a signed-in user changing their OWN password. The
// current password is required so an unattended session is not enough.
type PasswordChangeInput struct {
	Current string
	New     string
}

// Validate checks the shape only; the service verifies Current against the
// stored hash.
func (in PasswordChangeInput) Validate() error {
	fields := map[string]string{}
	if in.Current == "" {
		fields["current_password"] = "Enter your current password"
	}
	// Minimum in CHARACTERS (what a person types), maximum in BYTES (bcrypt's
	// limit) — the forms count the same way, so they never disagree.
	switch {
	case utf8.RuneCountInString(in.New) < minUserPasswordLen:
		fields["new_password"] = "Password must be at least 8 characters"
	case len(in.New) > maxPasswordBytes:
		fields["new_password"] = "Password is too long (at most 72 bytes; fewer if it uses non-English letters)"
	case in.Current != "" && in.New == in.Current:
		fields["new_password"] = "Choose a password different from your current one"
	}
	if len(fields) == 0 {
		return nil
	}
	msg := "Check the highlighted fields"
	if len(fields) == 1 {
		for _, m := range fields {
			msg = m
		}
	}
	return NewValidation(msg, fields)
}
