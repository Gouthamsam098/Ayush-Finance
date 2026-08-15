package logger

import (
	"log/slog"
	"testing"
)

// The redactor is the safety net for PII/credentials that a future log line
// might carry. It must catch every sensitive key WITHOUT blanking innocent
// fields — over-redaction quietly destroys the diagnostic value of the logs.
func TestRedactionCoversSensitiveKeys(t *testing.T) {
	mustRedact := []string{
		// credentials / session
		"password", "password_hash", "Passwd", "secret", "client_secret",
		"token", "refreshToken", "access_token", "authorization", "jwt",
		"mfa_secret", "cookie", "api_key", "apikey",
		// customer PII / KYC — this is a lending app
		"aadhaar", "aadhaar_number", "pan_number", "PAN",
		"mobile", "mobile_number", "alt_mobile", "phone", "email",
		"dob", "date_of_birth", "address", "address_line1", "pincode",
		"account_number", "ifsc",
	}
	for _, key := range mustRedact {
		t.Run("redacts/"+key, func(t *testing.T) {
			got := redactSensitive(nil, slog.String(key, "sensitive-value"))
			if got.Value.String() != redacted {
				t.Errorf("key %q was NOT redacted (value %q leaked)", key, got.Value.String())
			}
		})
	}
}

// Guard against over-matching. `pan` as a bare substring would blank "company",
// "span", "expanded"… so the PAN rule must be anchored, not a loose substring.
func TestRedactionDoesNotOverMatch(t *testing.T) {
	mustKeep := []string{
		"company", "company_name", "span", "expanded", "panel", "japan",
		"loan_id", "customer_id", "request_id", "status", "duration_ms",
		"method", "path", "count", "amount", "loan_number", "receipt_no",
		"panchayat", // a real Indian address word containing "pan"
	}
	for _, key := range mustKeep {
		t.Run("keeps/"+key, func(t *testing.T) {
			got := redactSensitive(nil, slog.String(key, "keep-me"))
			if got.Value.String() == redacted {
				t.Errorf("key %q was wrongly redacted — logs lose diagnostic value", key)
			}
		})
	}
}

// The time key is renamed to `timestamp` and must never be redacted.
func TestTimeKeyIsRenamedNotRedacted(t *testing.T) {
	got := redactSensitive(nil, slog.String(slog.TimeKey, "2026-08-09T10:00:00Z"))
	if got.Key != "timestamp" {
		t.Errorf("time key = %q, want %q", got.Key, "timestamp")
	}
	if got.Value.String() == redacted {
		t.Error("timestamp must not be redacted")
	}
}
