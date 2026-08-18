package customer

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// SoftDelete must cascade to loans, collections, and documents in one
// transaction. Otherwise deleting a customer leaves orphan rows that still
// appear on Loans / Collections / Reports after a refresh.
func TestSoftDeleteCascadesLinkedRecords(t *testing.T) {
	src, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}
	collapsed := regexp.MustCompile(`\s+`).ReplaceAllString(string(src), " ")

	softDeleteIdx := strings.Index(collapsed, "func (r *Repository) SoftDelete(ctx context.Context, id int64) error")
	if softDeleteIdx < 0 {
		t.Fatal("SoftDelete method missing from repository.go")
	}
	body := collapsed[softDeleteIdx:]
	if end := strings.Index(body[1:], "func (r *Repository)"); end > 0 {
		body = body[:end+1]
	}

	for _, want := range []string{
		"r.pool.Begin(ctx)",
		"UPDATE collections SET deleted_at = now()",
		"UPDATE loans SET deleted_at = now()",
		"UPDATE documents SET deleted_at = now()",
		"UPDATE customers SET deleted_at = now()",
		"tx.Commit(ctx)",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("SoftDelete cascade missing %q", want)
		}
	}
}
