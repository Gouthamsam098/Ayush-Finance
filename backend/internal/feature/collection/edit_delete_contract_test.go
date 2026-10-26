package collection

import (
	"strings"
	"testing"
)

// Editing or deleting a payment changes money just as recording one does, so it
// gets the same structure: one transaction, the loan locked before anything is
// read, the status sync inside it, and an audit entry committed with the change.
// Without it a receipt could be lowered or deleted with no trace of who did it
// or what it was, and a failed status sync left a settled loan ACTIVE.

func serviceFunc(t *testing.T, src, name string) string {
	t.Helper()
	start := strings.Index(src, "func (s *Service) "+name+"(")
	if start < 0 {
		t.Fatalf("Service.%s not found", name)
	}
	end := strings.Index(src[start+1:], " func ")
	if end < 0 {
		return src[start:]
	}
	return src[start : start+1+end]
}

func TestEditAndDeleteRunInALockedAuditedTransaction(t *testing.T) {
	src := readSource(t, "service.go")
	for _, tc := range []struct {
		name, write, action string
	}{
		{"Update", "s.repo.UpdateTx(ctx, tx, id, in)", "audit.ActionUpdate"},
		{"Delete", "s.repo.SoftDeleteTx(ctx, tx, existing.LoanID, id)", "audit.ActionDelete"},
	} {
		body := serviceFunc(t, src, tc.name)
		steps := []string{
			"s.repo.Pool().Begin(ctx)",
			"defer func() { _ = tx.Rollback(ctx) }()",
			"LockLoanForUpdate(ctx, tx, found.LoanID)",
			"s.repo.FindByIDTx(ctx, tx, id)",
			tc.write,
			"s.syncLoanStatusTx(ctx, tx, l)",
			tc.action,
			"Before: auditSnapshot(existing)",
			"tx.Commit(ctx)",
		}
		last := -1
		for _, step := range steps {
			at := strings.Index(body, step)
			if at < 0 {
				t.Errorf("%s: missing %q", tc.name, step)
				continue
			}
			if at < last {
				t.Errorf("%s: %q is out of order (lock → re-read → write → status sync → audit → commit)", tc.name, step)
			}
			last = at
		}
		if strings.Contains(body, "s.repo.FindByID(ctx, id)") && strings.Index(body, "s.repo.FindByID(ctx, id)") > strings.Index(body, "LockLoanForUpdate") {
			t.Errorf("%s: the row must be re-read inside the transaction (FindByIDTx), not on the pool", tc.name)
		}
	}
}

func TestStatusSyncFailureAbortsTheChange(t *testing.T) {
	src := readSource(t, "service.go")
	body := serviceFunc(t, src, "syncLoanStatusTx")
	if !strings.Contains(body, "s.loans.SetStatusTx(ctx, tx, l.ID, domain.StatusClosed)") ||
		!strings.Contains(body, "s.loans.SetStatusTx(ctx, tx, l.ID, domain.StatusActive)") {
		t.Error("auto-close and auto-reopen must both run inside the caller's transaction")
	}
	if !strings.Contains(body, "return err") {
		t.Error("a failed status change must be returned so the edit/delete rolls back")
	}
}
