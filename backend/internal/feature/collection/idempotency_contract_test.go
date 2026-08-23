package collection

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// Recording a payment must be atomic AND idempotent. Both properties are
// enforced by SQL/transaction structure rather than by logic a unit test can
// exercise without a live Postgres, so these tests assert the structure is
// present — they are the guard that a future refactor cannot quietly drop it.
//
// Why it matters: without the transaction, a payment could commit while the
// resulting auto-close failed (a settled loan left ACTIVE). Without the
// idempotency key, a retried request after a network timeout recorded a SECOND
// real payment — two receipts for one payment, inflating collected totals and
// profit-by-month.

func readSource(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return regexp.MustCompile(`\s+`).ReplaceAllString(string(b), " ")
}

func TestRecordRunsInATransactionWithARowLock(t *testing.T) {
	src := readSource(t, "service.go")

	for _, want := range []struct{ frag, why string }{
		{"tx, err := s.repo.Pool().Begin(ctx)", "Record must open a transaction"},
		{"defer func() { _ = tx.Rollback(ctx) }()", "rollback must be deferred so no path leaks a connection"},
		{"LockLoanForUpdate(ctx, tx, in.LoanID)", "the loan row must be locked before reading its collected total"},
		{"s.repo.CreateTx(ctx, tx, in, postedBy, idempotencyKey)", "the insert must happen inside the transaction"},
		{"s.loans.SetStatusTx(ctx, tx, in.LoanID, domain.StatusClosed)", "auto-close must happen inside the same transaction"},
		{"tx.Commit(ctx)", "the transaction must be committed"},
	} {
		if !strings.Contains(src, want.frag) {
			t.Errorf("missing %q — %s", want.frag, want.why)
		}
	}

	// The lock has to be taken BEFORE the balance is read, or two concurrent
	// payments can still both act on a stale sum.
	lockAt := strings.Index(src, "LockLoanForUpdate")
	sumAt := strings.Index(src, "SumByLoanTx")
	if lockAt < 0 || sumAt < 0 {
		t.Fatal("expected both LockLoanForUpdate and SumByLoanTx in Record")
	}
	if lockAt > sumAt {
		t.Error("LockLoanForUpdate must come BEFORE the collected total is read")
	}

	// A failed auto-close must abort the payment rather than commit a desync.
	if !strings.Contains(src, "return nil, err // roll back the payment too rather than desync") {
		t.Error("a failed SetStatusTx must return an error (rolling back the payment), not be ignored")
	}
}

func TestLockUsesSelectForUpdate(t *testing.T) {
	src := readSource(t, "repository.go")
	if !strings.Contains(src, "SELECT id FROM loans WHERE id = $1 AND deleted_at IS NULL FOR UPDATE") {
		t.Error("LockLoanForUpdate must use SELECT ... FOR UPDATE on the loans row")
	}
}

func TestCreateTxShortCircuitsOnAReplayedIdempotencyKey(t *testing.T) {
	src := readSource(t, "repository.go")

	// The replay check must happen BEFORE the INSERT, otherwise the retry
	// duplicates the payment and only then discovers the conflict.
	checkAt := strings.Index(src, "r.findByIdempotencyKey(ctx, tx, in.LoanID, idempotencyKey)")
	insertAt := strings.Index(src, "INSERT INTO collections (receipt_no, loan_id, date, amount, mode, kind, remarks, target_due_date, posted_by, posted_at, idempotency_key)")
	if checkAt < 0 {
		t.Fatal("CreateTx must look up a prior payment by idempotency key")
	}
	if insertAt < 0 {
		t.Fatal("CreateTx must insert with the idempotency_key column")
	}
	if checkAt > insertAt {
		t.Error("the idempotency-key lookup must run BEFORE the INSERT")
	}

	// An empty key must become SQL NULL: the partial unique index skips NULLs, so
	// storing "" instead would make the SECOND unkeyed payment collide.
	if !strings.Contains(src, "var keyArg *string") || !strings.Contains(src, `if idempotencyKey != "" { keyArg = &idempotencyKey }`) {
		t.Error("an empty idempotency key must be stored as NULL, not an empty string")
	}
}

// The uniqueness guarantee lives in the migration; assert it is scoped per loan
// and ignores NULLs.
func TestIdempotencyIndexIsPartialAndPerLoan(t *testing.T) {
	src := readSource(t, "../../database/migrations/0002_collection_idempotency.up.sql")
	if !strings.Contains(src, "ON collections (loan_id, idempotency_key)") {
		t.Error("the unique index must be scoped to (loan_id, idempotency_key)")
	}
	if !strings.Contains(src, "WHERE idempotency_key IS NOT NULL") {
		t.Error("the index must be partial so unkeyed payments are unaffected")
	}
	if !strings.Contains(src, "ADD COLUMN IF NOT EXISTS idempotency_key") {
		t.Error("the column must be added idempotently (migrations re-run on every boot)")
	}
}
