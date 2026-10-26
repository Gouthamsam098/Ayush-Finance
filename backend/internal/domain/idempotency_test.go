package domain

import (
	"testing"
	"time"
)

// A client must not be able to occupy the keys the server mints for claim and
// proof approvals ("claim-<id>-<n>", "proof-<id>-<n>"): a ₹1 payment planted
// under "claim-77-1" would otherwise be "replayed" when claim 77 is approved.
func TestReservedIdempotencyKeys(t *testing.T) {
	for _, k := range []string{"claim-77-1", "proof-5-2", "CLAIM-1", "Proof-x", "claim-"} {
		if !IsReservedIdempotencyKey(k) {
			t.Errorf("%q must be reserved", k)
		}
	}
	for _, k := range []string{"", "3f2b6c1e-0d8a-4c56-9a5e-1f2b3c4d5e6f", "k-lzx1-abc", "my-claim-1", "proofread"} {
		if IsReservedIdempotencyKey(k) {
			t.Errorf("%q must be allowed", k)
		}
	}
}

// A replayed key returns the original payment only when it IS that payment.
func TestReplayMustMatchThePayment(t *testing.T) {
	stored := &Collection{Amount: RupeesToPaise(500), Kind: KindInterest,
		Date: time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)} // a DATE column scans as UTC midnight
	same := CollectionInput{Amount: RupeesToPaise(500), Kind: KindInterest,
		Date: time.Date(2026, 10, 26, 0, 0, 0, 0, time.Local)}
	if !stored.SameMoneyAs(same) {
		t.Fatal("an identical retry must match the stored payment")
	}
	for name, in := range map[string]CollectionInput{
		"amount": {Amount: RupeesToPaise(10000), Kind: KindInterest, Date: same.Date},
		"kind":   {Amount: RupeesToPaise(500), Kind: KindPrincipal, Date: same.Date},
		"date":   {Amount: RupeesToPaise(500), Kind: KindInterest, Date: same.Date.AddDate(0, 0, 1)},
	} {
		if stored.SameMoneyAs(in) {
			t.Errorf("a different %s must not match the stored payment", name)
		}
	}
}
