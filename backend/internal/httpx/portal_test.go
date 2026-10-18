package httpx

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/anush-capitals/lms-backend/internal/domain"
)

// portalRequest runs RequireCustomer for an authenticated user id and returns
// the status plus the customer id the next handler saw (0 when not reached).
func portalRequest(t *testing.T, userID string, users map[int64]*domain.User) (int, int64) {
	t.Helper()
	load := func(_ context.Context, id int64) (*domain.User, error) {
		if u, ok := users[id]; ok {
			return u, nil
		}
		return nil, domain.NewNotFound("user")
	}
	var seen int64
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen, _ = PortalCustomerID(r.Context())
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodGet, "/portal/loans", nil)
	req = req.WithContext(context.WithValue(req.Context(), ctxUserID, userID))
	rec := httptest.NewRecorder()
	RequireCustomer(load)(next).ServeHTTP(rec, req)
	return rec.Code, seen
}

// The portal must scope every read to the customer linked on the users row,
// and must refuse staff and unknown/revoked users. A regression here would let
// one borrower read another's loans, or let staff tokens reach the portal.
func TestRequireCustomer(t *testing.T) {
	linked := int64(42)
	users := map[int64]*domain.User{
		1: {ID: 1, Role: domain.RoleAdmin},
		2: {ID: 2, Role: domain.RoleViewer},
		3: {ID: 3, Role: domain.RoleCustomer, CustomerID: &linked},
		4: {ID: 4, Role: domain.RoleCustomer}, // corrupt: no link
	}

	cases := []struct {
		name       string
		userID     string
		wantStatus int
		wantCust   int64
	}{
		{"customer gets own id", "3", http.StatusOK, 42},
		{"admin refused", "1", http.StatusForbidden, 0},
		{"viewer refused", "2", http.StatusForbidden, 0},
		{"customer without link refused", "4", http.StatusForbidden, 0},
		{"unknown or revoked user", "99", http.StatusUnauthorized, 0},
		{"no authenticated user", "", http.StatusUnauthorized, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, cust := portalRequest(t, tc.userID, users)
			if status != tc.wantStatus || cust != tc.wantCust {
				t.Fatalf("got status %d customer %d, want %d / %d", status, cust, tc.wantStatus, tc.wantCust)
			}
		})
	}
}

// A borrower has no module permissions, so every staff route must refuse it.
func TestRequirePermissionRefusesCustomer(t *testing.T) {
	linked := int64(42)
	cust := &domain.User{ID: 3, Role: domain.RoleCustomer, CustomerID: &linked,
		Permissions: domain.Permissions{}.Normalize()}
	load := func(_ context.Context, _ int64) (*domain.User, error) { return cust, nil }

	for _, method := range []string{http.MethodGet, http.MethodPost} {
		req := httptest.NewRequest(method, "/customers", nil)
		req = req.WithContext(context.WithValue(req.Context(), ctxUserID, "3"))
		rec := httptest.NewRecorder()
		RequirePermission("Customers", load)(okHandler()).ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("%s /customers as CUSTOMER: got %d, want 403", method, rec.Code)
		}
	}
}
