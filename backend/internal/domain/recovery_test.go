package domain

import (
	"reflect"
	"testing"
)

// Mirrors scripts/recovery-auto-assign-selftest.ts so the server job assigns
// exactly as the UI's demo did.
func TestBalanceOverdueAssignments(t *testing.T) {
	agents := []int64{10, 20}

	// Sticky: loan 1 stays on agent 10; new overdue split by count (tie → lower id).
	got := BalanceOverdueAssignments(agents, []int64{1, 2, 3}, map[int64]int64{1: 10, 99: 10})
	want := map[int64]int64{1: 10, 99: 10, 2: 20, 3: 10}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("sticky: got %v, want %v", got, want)
	}

	// Equal split on a fresh book.
	got = BalanceOverdueAssignments(agents, []int64{1, 2, 3, 4}, map[int64]int64{})
	count := map[int64]int{}
	for _, a := range got {
		count[a]++
	}
	if count[10] != 2 || count[20] != 2 {
		t.Fatalf("equal split: got %v", got)
	}

	// Overdue loan on an inactive agent is reassigned to an active one.
	got = BalanceOverdueAssignments(agents, []int64{5}, map[int64]int64{5: 99})
	if a := got[5]; a != 10 && a != 20 {
		t.Fatalf("inactive agent: loan 5 went to %d", a)
	}

	// A NON-overdue loan on an inactive agent is left alone.
	got = BalanceOverdueAssignments(agents, []int64{}, map[int64]int64{7: 99})
	if got[7] != 99 {
		t.Fatalf("non-overdue loan moved: %v", got)
	}

	// No active agents: nothing changes.
	cur := map[int64]int64{1: 99}
	if got = BalanceOverdueAssignments(nil, []int64{1, 2}, cur); !reflect.DeepEqual(got, cur) {
		t.Fatalf("no agents: got %v", got)
	}

	// Input map is not mutated.
	in := map[int64]int64{1: 99}
	_ = BalanceOverdueAssignments(agents, []int64{1}, in)
	if in[1] != 99 {
		t.Fatal("current map was mutated")
	}
}

func TestScheduleShortfall(t *testing.T) {
	rs := RupeesToPaise
	now := day(2026, 4, 15)
	monthly := &Loan{Type: LoanMonthlyInterest, Principal: rs(100000), Interest: rs(2000),
		DailyAmount: ptrPaise(rs(2000)), LoanDate: day(2026, 1, 1), Status: StatusActive}
	if got := ScheduleShortfall(monthly, Collected{Interest: rs(2000)}, now); got != rs(4000) {
		t.Errorf("interest-only: got %s, want ₹4,000", got)
	}
	// Principal payments never reduce interest due.
	if got := ScheduleShortfall(monthly, Collected{Interest: rs(2000), Principal: rs(50000)}, now); got != rs(4000) {
		t.Errorf("interest-only with principal paid: got %s, want ₹4,000", got)
	}
	// Paid ahead → 0, never negative.
	if got := ScheduleShortfall(monthly, Collected{Interest: rs(9000)}, now); got != 0 {
		t.Errorf("paid ahead: got %s, want 0", got)
	}
	daily := &Loan{Type: LoanDailyCollection, Principal: rs(10000), DailyAmount: ptrPaise(rs(100)),
		NumDays: ptrInt(100), LoanDate: day(2026, 4, 1), Status: StatusActive}
	// 15 Apr: elapsed 15 days → 14 billable × ₹100 = ₹1,400; ₹400 paid → ₹1,000.
	if got := ScheduleShortfall(daily, Collected{Interest: rs(400)}, now); got != rs(1000) {
		t.Errorf("daily: got %s, want ₹1,000", got)
	}
}

func TestClaimAndPromiseValidate(t *testing.T) {
	now := day(2026, 4, 15)
	ok := ClaimInput{LoanID: 1, Amount: RupeesToPaise(500), Mode: PayCash, ReceiptDate: day(2026, 4, 15)}
	if err := ok.Validate(now); err != nil {
		t.Fatalf("valid claim rejected: %v", err)
	}
	for i, bad := range []ClaimInput{
		{LoanID: 1, Amount: 0, Mode: PayCash, ReceiptDate: now},
		{LoanID: 1, Amount: Paise(50050), Mode: PayCash, ReceiptDate: now},
		{LoanID: 1, Amount: RupeesToPaise(5), Mode: "GOLD", ReceiptDate: now},
		{LoanID: 1, Amount: RupeesToPaise(5), Mode: PayCash},
		{LoanID: 1, Amount: RupeesToPaise(5), Mode: PayCash, ReceiptDate: day(2026, 4, 20)},
	} {
		if err := bad.Validate(now); err == nil {
			t.Errorf("claim case %d accepted", i)
		}
	}
	if err := (&PromiseInput{LoanID: 1, PromiseDate: now}).Validate(now); err != nil {
		t.Fatalf("promise for today rejected: %v", err)
	}
	if err := (&PromiseInput{LoanID: 1, PromiseDate: day(2026, 4, 14)}).Validate(now); err == nil {
		t.Error("past promise date accepted")
	}
	zero := Paise(0)
	if err := (&PromiseInput{LoanID: 1, PromiseDate: now, PromisedAmount: &zero}).Validate(now); err == nil {
		t.Error("zero promised amount accepted")
	}
}
