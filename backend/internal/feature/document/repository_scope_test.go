package document

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// KYC documents (Aadhaar/PAN scans) are the most sensitive data in the system,
// and document IDs are sequential. The routes are mounted under
// /customers/{customerId}/documents/{docId}, so EVERY single-document query
// must filter on customer_id as well as id — otherwise any authenticated user
// can enumerate docIds and read or delete another customer's documents (an
// IDOR that previously shipped: Download/SoftDelete filtered on `id` alone).
//
// These tests assert the ownership filter is structurally present in the SQL.
// They need no database: they read the repository source, so the guarantee
// cannot regress unnoticed even though the queries themselves are only
// exercised against a live Postgres.
func repositorySource(t *testing.T) string {
	t.Helper()
	src, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}
	return string(src)
}

// collapseWS makes the assertions whitespace/newline agnostic so reformatting
// the SQL string does not fail the test.
func collapseWS(s string) string {
	return regexp.MustCompile(`\s+`).ReplaceAllString(s, " ")
}

func TestSingleDocumentQueriesAreScopedToCustomer(t *testing.T) {
	src := collapseWS(repositorySource(t))

	// Download: must select by BOTH id and customer_id.
	if !strings.Contains(src, "WHERE id = $1 AND customer_id = $2 AND deleted_at IS NULL") {
		t.Error("Download query must filter on customer_id (IDOR guard): " +
			"expected `WHERE id = $1 AND customer_id = $2 AND deleted_at IS NULL`")
	}

	// SoftDelete: same guard on the UPDATE.
	if !strings.Contains(src, "UPDATE documents SET deleted_at = now() WHERE id = $1 AND customer_id = $2 AND deleted_at IS NULL") {
		t.Error("SoftDelete query must filter on customer_id (IDOR guard): " +
			"expected `WHERE id = $1 AND customer_id = $2 AND deleted_at IS NULL`")
	}

	// Belt and braces: no query against the DOCUMENTS table may filter on a bare
	// id. Scoped to document statements only — `customerExists` legitimately
	// looks up the customers table by its own id.
	for _, stmt := range regexp.MustCompile(`(?:FROM|UPDATE) documents[^`+"`"+`]*`).FindAllString(src, -1) {
		if strings.Contains(stmt, "WHERE id = $1 AND deleted_at IS NULL") {
			t.Errorf("document query filtered by id alone — every single-document query "+
				"must also match customer_id, or documents leak across customers: %q", stmt)
		}
	}
}

// The ownership check must be enforced in the QUERY, which means the id and the
// customer id have to reach the repository together. This pins the signatures
// so a future refactor cannot quietly drop the customer scope.
func TestDownloadAndDeleteTakeCustomerID(t *testing.T) {
	src := collapseWS(repositorySource(t))

	for _, want := range []string{
		"func (r *Repository) Download(ctx context.Context, id, customerID int64) (*domain.Document, error)",
		"func (r *Repository) SoftDelete(ctx context.Context, id, customerID int64) error",
	} {
		if !strings.Contains(src, want) {
			t.Errorf("missing customer-scoped signature: %s", want)
		}
	}
}

// A mismatch must be reported as NotFound, never a distinct "forbidden" status:
// a different status would confirm that the document ID exists and let an
// attacker map the document store by probing IDs.
func TestScopeMismatchIsNotFound(t *testing.T) {
	src := repositorySource(t)
	if !strings.Contains(src, `domain.NewNotFound("document")`) {
		t.Error(`document lookups must return domain.NewNotFound("document") so an ` +
			`ownership mismatch is indistinguishable from a missing row`)
	}
	if strings.Contains(src, "NewForbidden") {
		t.Error("document repository must not return Forbidden on scope mismatch — " +
			"it confirms the document exists (enumeration oracle)")
	}
}
