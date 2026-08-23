package domain

import (
	"testing"
	"time"
)

// A monthly investor: ₹1,00,000 at 2% per month = ₹2,000 every month.
func monthlyInv() *Investment {
	return &Investment{
		Principal: RupeesToPaise(100000),
		Rate:      2,
		Frequency: PayoutMonthly,
		StartDate: day(2026, time.January, 10),
		Status:    InvestmentActive,
	}
}

func TestInterestPerCycle(t *testing.T) {
	if got := monthlyInv().InterestPerCycle(); got != RupeesToPaise(2000) {
		t.Errorf("monthly per cycle = %v, want 2000", got.Rupees())
	}
	yearly := &Investment{Principal: RupeesToPaise(100000), Rate: 12, Frequency: PayoutYearly,
		StartDate: day(2026, time.January, 10), Status: InvestmentActive}
	if got := yearly.InterestPerCycle(); got != RupeesToPaise(12000) {
		t.Errorf("yearly per cycle = %v, want 12000", got.Rupees())
	}
}

// A cycle must count from its DUE DAY — never a day early. This is the rule
// that keeps accrual in step with the ledger rows the UI renders.
func TestCyclesElapsedCountsFromDueDay(t *testing.T) {
	inv := monthlyInv() // starts 10 Jan
	cases := []struct {
		asOf time.Time
		want int
	}{
		{day(2026, time.January, 10), 0},  // start day: nothing accrued
		{day(2026, time.February, 9), 0},  // one day BEFORE the first due
		{day(2026, time.February, 10), 1}, // first cycle falls due
		{day(2026, time.March, 9), 1},     // still one
		{day(2026, time.March, 10), 2},    // second cycle
		{day(2027, time.January, 10), 12}, // a full year
	}
	for _, c := range cases {
		if got := inv.CyclesElapsed(c.asOf); got != c.want {
			t.Errorf("CyclesElapsed(%s) = %d, want %d", c.asOf.Format("2006-01-02"), got, c.want)
		}
	}
}

func TestYearlyCyclesElapsed(t *testing.T) {
	inv := &Investment{Principal: RupeesToPaise(100000), Rate: 12, Frequency: PayoutYearly,
		StartDate: day(2025, time.March, 1), Status: InvestmentActive}
	if got := inv.CyclesElapsed(day(2026, time.February, 28)); got != 0 {
		t.Errorf("a day before the first anniversary = %d, want 0", got)
	}
	if got := inv.CyclesElapsed(day(2026, time.March, 1)); got != 1 {
		t.Errorf("on the anniversary = %d, want 1", got)
	}
}

// A settled investment must STOP accruing on its settlement date, otherwise a
// closed investor would keep appearing to owe interest forever.
func TestSettledInvestmentStopsAccruing(t *testing.T) {
	settled := day(2026, time.March, 10)
	inv := monthlyInv()
	inv.Status = InvestmentClosed
	inv.SettledDate = &settled
	// Long after settlement, accrual is frozen at the settlement date (2 cycles).
	if got := inv.CyclesElapsed(day(2026, time.December, 31)); got != 2 {
		t.Errorf("cycles after settlement = %d, want 2 (frozen)", got)
	}
}

func TestInterestDueNeverNegative(t *testing.T) {
	inv := monthlyInv()
	asOf := day(2026, time.February, 10) // 1 cycle accrued = ₹2,000
	// Paid MORE than accrued (a cycle in advance): due is 0, not a credit.
	if got := inv.InterestDue(RupeesToPaise(4000), asOf); got != 0 {
		t.Errorf("InterestDue with advance payment = %v, want 0", got.Rupees())
	}
	if got := inv.InterestDue(RupeesToPaise(500), asOf); got != RupeesToPaise(1500) {
		t.Errorf("InterestDue = %v, want 1500", got.Rupees())
	}
}

// Paying ahead must NOT push the next payout past a cycle that is still unpaid
// — the arrears-masking bug the loan side hit.
func TestNextPayoutCappedAtAccrued(t *testing.T) {
	inv := monthlyInv()
	asOf := day(2026, time.February, 10) // 1 cycle accrued
	// Paid 5 cycles' worth (₹10,000) while only 1 has accrued.
	nd := inv.NextPayoutDate(RupeesToPaise(10000), asOf)
	if nd == nil {
		t.Fatal("NextPayoutDate returned nil for an active investment")
	}
	// Funded is capped at 1 accrued cycle, so the next due is cycle 2: 10 Mar.
	if want := day(2026, time.March, 10); !nd.Equal(want) {
		t.Errorf("next payout = %s, want %s (capped at accrued)",
			nd.Format("2006-01-02"), want.Format("2006-01-02"))
	}
}

func TestNextPayoutNilWhenClosed(t *testing.T) {
	settled := day(2026, time.March, 10)
	inv := monthlyInv()
	inv.Status = InvestmentClosed
	inv.SettledDate = &settled
	if nd := inv.NextPayoutDate(0, day(2026, time.April, 1)); nd != nil {
		t.Errorf("closed investment next payout = %v, want nil", nd)
	}
}

func TestInvestmentInputValidate(t *testing.T) {
	now := day(2026, time.June, 1)
	valid := func() InvestmentInput {
		return InvestmentInput{
			InvestorName: "Ravi Kumar",
			Principal:    RupeesToPaise(100000),
			Rate:         2,
			Frequency:    PayoutMonthly,
			StartDate:    day(2026, time.January, 10),
		}
	}
	if in := valid(); in.Validate(now) != nil {
		t.Errorf("valid input rejected: %v", in.Validate(now))
	}

	bad := []struct {
		name   string
		mutate func(*InvestmentInput)
		field  string
	}{
		{"empty name", func(i *InvestmentInput) { i.InvestorName = "  " }, "investor_name"},
		{"zero principal", func(i *InvestmentInput) { i.Principal = 0 }, "principal"},
		{"paise principal", func(i *InvestmentInput) { i.Principal = 100050 }, "principal"},
		{"zero rate", func(i *InvestmentInput) { i.Rate = 0 }, "rate"},
		{"rate over 100", func(i *InvestmentInput) { i.Rate = 101 }, "rate"},
		{"bad frequency", func(i *InvestmentInput) { i.Frequency = "WEEKLY" }, "frequency"},
		{"future start", func(i *InvestmentInput) { i.StartDate = day(2026, time.July, 1) }, "start_date"},
	}
	for _, c := range bad {
		in := valid()
		c.mutate(&in)
		err := in.Validate(now)
		if err == nil {
			t.Errorf("%s: expected a validation error", c.name)
			continue
		}
		de, ok := err.(*Error)
		if !ok || de.Fields[c.field] == "" {
			t.Errorf("%s: expected field %q to be flagged, got %v", c.name, c.field, err)
		}
	}
}

// The server — not the client — must enforce how far ahead a payout may run.
func TestPayoutValidateCeiling(t *testing.T) {
	inv := monthlyInv()
	now := day(2026, time.February, 10) // 1 cycle accrued = ₹2,000, per cycle ₹2,000
	base := func(amount float64) PayoutInput {
		return PayoutInput{
			InvestmentID: 1, Amount: RupeesToPaise(amount),
			Date: now, Mode: PayCash,
		}
	}
	// accrued-unpaid (2,000) + one cycle (2,000) = 4,000 ceiling.
	if in := base(4000); in.Validate(inv, 0, now) != nil {
		t.Errorf("paying up to the ceiling was rejected: %v", in.Validate(inv, 0, now))
	}
	if in := base(4100); in.Validate(inv, 0, now) == nil {
		t.Error("paying beyond the ceiling was allowed")
	}
	// A brand-new investment (nothing accrued) must still allow ONE full cycle
	// upfront — day-one payouts are legitimate.
	fresh := monthlyInv()
	fresh.StartDate = now
	if in := base(2000); in.Validate(fresh, 0, now) != nil {
		t.Errorf("day-one full-cycle payout rejected: %v", in.Validate(fresh, 0, now))
	}
}

func TestPayoutValidateDates(t *testing.T) {
	inv := monthlyInv() // starts 10 Jan 2026
	now := day(2026, time.February, 10)
	in := PayoutInput{InvestmentID: 1, Amount: RupeesToPaise(2000), Mode: PayCash,
		Date: day(2026, time.January, 1)} // before the investment existed
	err := in.Validate(inv, 0, now)
	if err == nil {
		t.Fatal("payout dated before the investment was allowed")
	}
	if de, ok := err.(*Error); !ok || de.Fields["date"] == "" {
		t.Errorf("expected a date field error, got %v", err)
	}

	future := PayoutInput{InvestmentID: 1, Amount: RupeesToPaise(2000), Mode: PayCash,
		Date: day(2026, time.March, 1)}
	if future.Validate(inv, 0, now) == nil {
		t.Error("future-dated payout was allowed")
	}
}
