package httpx

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A panic is a server fault: it must answer 500 INTERNAL_ERROR (visible to 5xx
// alerting) with a generic message — never a 400 that blames the caller, and
// never the panic text.
func TestRecoverAnswers500(t *testing.T) {
	h := Recover(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("secret internal detail")
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "INTERNAL_ERROR") || strings.Contains(body, "secret internal detail") {
		t.Errorf("body = %s, want a generic INTERNAL_ERROR without the panic text", body)
	}
}
