package loan

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// SoftDelete must soft-delete the loan's collections in the same transaction
// so Collections/Reports never keep orphan payment rows after a loan delete.
func TestSoftDeleteCascadesCollections(t *testing.T) {
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
	if end := strings.Index(body[1:], "func ("); end > 0 {
		body = body[:end+1]
	}

	for _, want := range []string{
		"r.pool.Begin(ctx)",
		"UPDATE collections SET deleted_at = now()",
		"UPDATE loans SET deleted_at = now()",
		"tx.Commit(ctx)",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("SoftDelete cascade missing %q", want)
		}
	}
}
