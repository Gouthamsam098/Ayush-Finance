package domain

import (
	"testing"
	"time"
)

// day returns a fixed local date, keeping tests deterministic (never reads
// the wall clock).
func day(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, time.Local)
}

func ptrInt(n int) *int { return &n }
func strPtr(s string) *string { return &s }

func ptrPaise(p Paise) *Paise { return &p }

func TestElapsedDaysSinceLoan(t *testing.T) {
	tests := []struct {
		name     string
		loanDate time.Time
		now      time.Time
		want     int
	}{
		{"same day is day 1", day(2026, 7, 4), day(2026, 7, 4), 1},
		{"next day is day 2", day(2026, 7, 4), day(2026, 7, 5), 2},
		{"nine days later is day 10", day(2026, 7, 4), day(2026, 7, 13), 10},
		{"future loan date clamps to 0", day(2026, 7, 20), day(2026, 7, 13), 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ElapsedDaysSinceLoan(tt.loanDate, tt.now); got != tt.want {
				t.Errorf("got %d, want %d", got, tt.want)
			}
		})
	}
}

func TestMonthlyCyclesElapsed(t *testing.T) {
	loan := day(2026, 1, 1)
	tests := []struct {
		name string
		now  time.Time
		want int
	}{
		{"day 30 -> 1 cycle", day(2026, 1, 30), 1},
		{"day 59 -> 1 cycle", day(2026, 2, 28), 1},
		{"day 60 -> 2 cycles", day(2026, 3, 1), 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := MonthlyCyclesElapsed(loan, tt.now, standardCycleDays); got != tt.want {
				t.Errorf("got %d, want %d", got, tt.want)
			}
		})
	}
}

func TestCalcInterest(t *testing.T) {
	// 12,00,000 rupees at 2% = 24,000 rupees = 2,400,000 paise.
	principal := RupeesToPaise(1200000)
	got := CalcInterest(principal, 2)
	want := RupeesToPaise(24000)
	if got != want {
		t.Errorf("got %d paise, want %d paise", got, want)
	}
}

func TestOutstandingDailyCollection(t *testing.T) {
	// Principal shrinks as collected: 300000 - 2000 = 298000 rupees.
	loan := &Loan{
		Type:        LoanDailyCollection,
		Principal:   RupeesToPaise(300000),
		DailyAmount: ptrPaise(RupeesToPaise(750)),
		NumDays:     ptrInt(100),
		LoanDate:    day(2026, 7, 4),
		Status:      StatusActive,
	}
	collected := Collected{Interest: RupeesToPaise(2000)}
	got := loan.Outstanding(collected, day(2026, 7, 13))
	want := RupeesToPaise(298000)
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestEmiLoan(t *testing.T) {
	// VEHICLE is a flat-interest EMI loan. ₹1,00,000 at 12% overall = ₹12,000
	// interest; total payable ₹1,12,000 over 12 months → EMI ₹9,333.
	principal := RupeesToPaise(100000)
	interest := CalcInterest(principal, 12) // 12% overall = ₹12,000
	// Total payable ₹1,12,000 = 1,12,00,000 paise; ÷ 12 = 933333 paise (rounded).
	if got := EMI(principal, interest, 12); got != Paise(933333) {
		t.Errorf("EMI got %s, want 933333 paise", got)
	}
	// Outstanding = total payable − collected. After one EMI (~₹9,333) collected:
	loan := &Loan{
		Type:        LoanVehicle,
		Principal:   principal,
		Rate:        12,
		Interest:    interest,
		DailyAmount: ptrPaise(EMI(principal, interest, 12)),
		NumDays:     ptrInt(12),
		LoanDate:    day(2026, 1, 1),
		Status:      StatusActive,
	}
	collected := EMI(principal, interest, 12) // one EMI paid
	got := loan.Outstanding(Collected{Interest: collected}, day(2026, 3, 1))
	want := principal.Add(interest).Sub(collected)
	if got != want {
		t.Errorf("EMI outstanding: got %s, want %s", got, want)
	}
}

// A Vehicle/Property loan in MONTHLY_INTEREST mode behaves exactly like Monthly
// Interest: interest = principal × rate% every 30 days, principal fixed until
// settled. It must NOT use the EMI schedule.
func TestVehicleMonthlyInterestMode(t *testing.T) {
	principal := RupeesToPaise(500000)
	in := LoanInput{
		Type: LoanVehicle, RepaymentMode: RepayMonthlyInterest,
		Principal: principal, Rate: 2, LoanDate: day(2026, 1, 1),
		VehicleNumber: strPtr("KL-07-AB-1234"),
	}
	d := in.Derive()
	perMonth := CalcInterest(principal, 2) // ₹10,000/mo
	if d.DailyAmount == nil || *d.DailyAmount != perMonth {
		t.Fatalf("derive: per-period interest got %v, want %s", d.DailyAmount, perMonth)
	}
	if d.NumDays != nil {
		t.Errorf("derive: monthly-mode EMI should have no tenure, got %v", *d.NumDays)
	}
	loan := &Loan{
		Type: LoanVehicle, RepaymentMode: RepayMonthlyInterest,
		Principal: principal, Rate: 2, Interest: perMonth, DailyAmount: ptrPaise(perMonth),
		LoanDate: day(2026, 1, 1), Status: StatusActive,
	}
	if !loan.BehavesInterestOnly() || loan.BehavesEMI() {
		t.Fatal("monthly-mode Vehicle must behave interest-only, not EMI")
	}
	// Day 31 = 1 cycle → ₹10,000 interest due; principal stays → outstanding 510000.
	if got := loan.Outstanding(Collected{}, day(2026, 1, 31)); got != RupeesToPaise(510000) {
		t.Errorf("month 1 outstanding: got %s, want 510000", got)
	}
	// Day 61 = 2 cycles → ₹20,000 → outstanding 520000.
	if got := loan.Outstanding(Collected{}, day(2026, 3, 2)); got != RupeesToPaise(520000) {
		t.Errorf("month 2 outstanding: got %s, want 520000", got)
	}
	// Settle: 2 cycles interest (₹20,000) + full principal → outstanding 0.
	full := Collected{Interest: RupeesToPaise(20000), Principal: principal}
	if got := loan.Outstanding(full, day(2026, 3, 2)); got != 0 {
		t.Errorf("settled: got %s, want 0", got)
	}
}

func TestUpfrontDeduction(t *testing.T) {
	interest := RupeesToPaise(5000) // 5% of 1,00,000
	// Daily Collection retains 3 months of interest = 15,000.
	if got := UpfrontDeduction(LoanDailyCollection, interest); got != RupeesToPaise(15000) {
		t.Errorf("daily collection: got %s, want %s", got, RupeesToPaise(15000))
	}
	// EMI (Vehicle/Property), interest-only and Flexible retain nothing upfront.
	if got := UpfrontDeduction(LoanVehicle, interest); got != 0 {
		t.Errorf("vehicle (EMI): got %s, want 0", got)
	}
	if got := UpfrontDeduction(LoanDailyInterest, interest); got != 0 {
		t.Errorf("daily interest: got %s, want 0", got)
	}
	if got := UpfrontDeduction(LoanFlexible, interest); got != 0 {
		t.Errorf("flexible: got %s, want 0", got)
	}
}

func TestOutstandingInterestOnly(t *testing.T) {
	// MONTHLY_INTEREST: ₹1,00,000 at ₹5,000/month interest. At day 60 = 2 cycles,
	// due = 10,000, collected 5,000 → accrued 5,000. Principal stays fixed.
	// Outstanding = 100000 + 5000 = 105000.
	loan := &Loan{
		Type:        LoanMonthlyInterest,
		Principal:   RupeesToPaise(100000),
		Rate:        5,
		Interest:    RupeesToPaise(5000),
		DailyAmount: ptrPaise(RupeesToPaise(5000)), // interest per 30-day period
		LoanDate:    day(2026, 1, 1),
		Status:      StatusActive,
	}
	collected := Collected{Interest: RupeesToPaise(5000)}
	got := loan.Outstanding(collected, day(2026, 3, 1))
	want := RupeesToPaise(105000)
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}

	// DAILY_INTEREST accrues from the DAY AFTER disbursement: loan on 7/1, now
	// 7/15 → 14 accrual days at ₹100/day = 1,400 accrued, interest collected 500
	// → 900 unpaid. Outstanding = 50000 + 900 = 50900.
	dloan := &Loan{
		Type:        LoanDailyInterest,
		Principal:   RupeesToPaise(50000),
		DailyAmount: ptrPaise(RupeesToPaise(100)),
		LoanDate:    day(2026, 7, 1),
		Status:      StatusActive,
	}
	if got := dloan.Outstanding(Collected{Interest: RupeesToPaise(500)}, day(2026, 7, 15)); got != RupeesToPaise(50900) {
		t.Errorf("daily-interest outstanding: got %s, want %s", got, RupeesToPaise(50900))
	}

	// On the loan date itself, no interest has accrued yet → outstanding = principal.
	if got := dloan.Outstanding(Collected{}, day(2026, 7, 1)); got != RupeesToPaise(50000) {
		t.Errorf("daily-interest on loan date should owe principal only, got %s", got)
	}
}

// TestInterestOnlyPreclosure verifies a principal-kind payment settles the loan.
func TestInterestOnlyPreclosure(t *testing.T) {
	// MONTHLY_INTEREST ₹1,00,000, ₹5,000/mo. At day 60 = 2 cycles, ₹10,000 accrued.
	loan := &Loan{
		Type:        LoanMonthlyInterest,
		Principal:   RupeesToPaise(100000),
		Interest:    RupeesToPaise(5000),
		DailyAmount: ptrPaise(RupeesToPaise(5000)),
		LoanDate:    day(2026, 1, 1),
		Status:      StatusActive,
	}
	now := day(2026, 3, 1) // 2 cycles → ₹10,000 interest accrued

	// Interest ₹10,000 fully paid, principal ₹1,00,000 paid → outstanding 0, settled.
	full := Collected{Interest: RupeesToPaise(10000), Principal: RupeesToPaise(100000)}
	if got := loan.Outstanding(full, now); got != 0 {
		t.Errorf("fully settled interest-only should owe 0, got %s", got)
	}
	if !loan.IsFullyPaid(full, now) {
		t.Error("expected IsFullyPaid=true after full interest + principal payment")
	}

	// Interest ₹10,000 paid but principal only ₹40,000 → outstanding = ₹60,000 remaining principal.
	partial := Collected{Interest: RupeesToPaise(10000), Principal: RupeesToPaise(40000)}
	if got := loan.Outstanding(partial, now); got != RupeesToPaise(60000) {
		t.Errorf("partial principal: got %s, want %s", got, RupeesToPaise(60000))
	}

	// Interest payments alone never reduce principal, even if they exceed accrued interest.
	interestOnly := Collected{Interest: RupeesToPaise(100000)}
	if got := loan.Outstanding(interestOnly, now); got != RupeesToPaise(100000) {
		t.Errorf("interest-only payment must leave full principal, got %s", got)
	}
}

func TestOutstandingFlexible(t *testing.T) {
	// FLEXIBLE now accrues interest every NumDays on the original principal
	// (interest-only with a custom cycle). ₹1,50,000 @ 3% every 30 days → ₹4,500
	// per cycle. Per-period interest lives in DailyAmount.
	principal := RupeesToPaise(150000)
	perPeriod := CalcInterest(principal, 3) // ₹4,500
	loan := &Loan{
		Type:        LoanFlexible,
		Principal:   principal,
		Rate:        3,
		Interest:    perPeriod,
		DailyAmount: ptrPaise(perPeriod),
		NumDays:     ptrInt(30),
		LoanDate:    day(2026, 1, 1),
		Status:      StatusActive,
	}
	// Flexible charges the FIRST cycle's interest on the loan date itself.
	// Day 1 (loan date): 1 cycle → ₹4,500 due → outstanding = 154500.
	if got := loan.Outstanding(Collected{}, day(2026, 1, 1)); got != RupeesToPaise(154500) {
		t.Errorf("loan date (1st cycle upfront): got %s, want %s", got, RupeesToPaise(154500))
	}
	// Day 15 (still within cycle 1): still 1 cycle → ₹4,500.
	if got := loan.Outstanding(Collected{}, day(2026, 1, 15)); got != RupeesToPaise(154500) {
		t.Errorf("day 15: got %s, want %s", got, RupeesToPaise(154500))
	}
	// Day 31 (cycle 2 begun): 2 cycles → ₹9,000 → outstanding = 159000.
	if got := loan.Outstanding(Collected{}, day(2026, 1, 31)); got != RupeesToPaise(159000) {
		t.Errorf("day 31 (2 cycles): got %s, want %s", got, RupeesToPaise(159000))
	}
	// 2 cycles' interest (₹9,000) paid + full principal settled → outstanding 0.
	full := Collected{Interest: RupeesToPaise(9000), Principal: principal}
	if got := loan.Outstanding(full, day(2026, 1, 31)); got != 0 {
		t.Errorf("settled flexible: got %s, want 0", got)
	}
}

// TestFlexibleRecurringInterest is the user's canonical example: ₹1,00,000 at
// 5% every 7 days. Interest recurs on the original principal each 7-day cycle.
func TestFlexibleRecurringInterest(t *testing.T) {
	principal := RupeesToPaise(100000)
	per := CalcInterest(principal, 5) // ₹5,000 per 7-day cycle
	l := &Loan{
		Type: LoanFlexible, Principal: principal, Rate: 5,
		Interest: per, DailyAmount: ptrPaise(per), NumDays: ptrInt(7),
		LoanDate: day(2026, 7, 1), Status: StatusActive,
	}
	// Interest starts SAME DAY: cycle 1 is owed on the loan date.
	// Day 0 (loan date) → 1 cycle → ₹5,000 due → outstanding ₹1,05,000.
	if got := l.Outstanding(Collected{}, day(2026, 7, 1)); got != RupeesToPaise(105000) {
		t.Errorf("day 0: got %s, want 105000", got)
	}
	// Day 7 → 2 cycles → ₹10,000 → outstanding ₹1,10,000.
	if got := l.Outstanding(Collected{}, day(2026, 7, 8)); got != RupeesToPaise(110000) {
		t.Errorf("day 7: got %s, want 110000", got)
	}
	// Day 14 → 3 cycles → ₹15,000 → outstanding ₹1,15,000.
	if got := l.Outstanding(Collected{}, day(2026, 7, 15)); got != RupeesToPaise(115000) {
		t.Errorf("day 14: got %s, want 115000", got)
	}
	// Same-day settlement: even on day 0 must pay principal + 1st cycle interest.
	sameDay := Collected{Interest: RupeesToPaise(5000), Principal: principal}
	if got := l.Outstanding(sameDay, day(2026, 7, 1)); got != 0 {
		t.Errorf("same-day settle: got %s, want 0", got)
	}
}

func TestClosedLoanOwesNothingExceptDailyCollection(t *testing.T) {
	monthly := &Loan{
		Type:        LoanVehicle,
		Principal:   RupeesToPaise(500000),
		DailyAmount: ptrPaise(RupeesToPaise(50000)),
		Interest:    RupeesToPaise(10000),
		LoanDate:    day(2026, 1, 1),
		Status:      StatusClosed,
	}
	if got := monthly.Outstanding(Collected{}, day(2026, 6, 1)); got != 0 {
		t.Errorf("closed monthly instalment loan should owe 0, got %s", got)
	}

	// DAILY_COLLECTION residual is still meaningful after closing.
	daily := &Loan{
		Type:      LoanDailyCollection,
		Principal: RupeesToPaise(300000),
		LoanDate:  day(2026, 1, 1),
		Status:    StatusClosed,
	}
	if got := daily.Outstanding(Collected{Interest: RupeesToPaise(250000)}, day(2026, 6, 1)); got != RupeesToPaise(50000) {
		t.Errorf("closed daily-collection residual wrong, got %s", got)
	}
}

// TestNextDue exercises the amount-based next-due formula across every loan
// type and payment state: fresh, partial, exactly-paid, overdue, paid-ahead,
// fully-collected, and closed.
func TestNextDue(t *testing.T) {
	iso := func(tt *time.Time) string {
		if tt == nil {
			return "<nil>"
		}
		return tt.Format("2006-01-02")
	}
	daily := &Loan{
		Type:        LoanDailyCollection,
		Principal:   RupeesToPaise(100000),
		DailyAmount: ptrPaise(RupeesToPaise(1000)),
		NumDays:     ptrInt(100),
		LoanDate:    day(2026, 7, 10),
		Status:      StatusActive,
	}
	cases := []struct {
		name      string
		collected Collected
		want      string
	}{
		{"fresh loan → first instalment day", Collected{}, "2026-07-11"},
		{"partial payment does NOT advance", Collected{Interest: RupeesToPaise(500)}, "2026-07-11"},
		{"one instalment paid → next day", Collected{Interest: RupeesToPaise(1000)}, "2026-07-12"},
		{"overdue: formula returns oldest unpaid slot", Collected{Interest: RupeesToPaise(3000)}, "2026-07-14"},
		{"paid ahead advances past today", Collected{Interest: RupeesToPaise(10000)}, "2026-07-21"},
	}
	for _, tc := range cases {
		if got := iso(daily.NextDue(tc.collected)); got != tc.want {
			t.Errorf("daily %s: got %s, want %s", tc.name, got, tc.want)
		}
	}
	// Every instalment collected → nothing further falls due.
	if got := daily.NextDue(Collected{Interest: RupeesToPaise(100000)}); got != nil {
		t.Errorf("fully collected daily should have no next due, got %s", iso(got))
	}
	// Closed → nil regardless of balance.
	closed := *daily
	closed.Status = StatusClosed
	if got := closed.NextDue(Collected{}); got != nil {
		t.Errorf("closed loan should have no next due, got %s", iso(got))
	}

	// EMI: 30-day cycles.
	emi := &Loan{
		Type:        LoanVehicle,
		Principal:   RupeesToPaise(100000),
		Interest:    RupeesToPaise(12000),
		DailyAmount: ptrPaise(RupeesToPaise(9333)),
		NumDays:     ptrInt(12),
		LoanDate:    day(2026, 1, 1),
		Status:      StatusActive,
	}
	if got := iso(emi.NextDue(Collected{})); got != "2026-01-31" {
		t.Errorf("fresh EMI: got %s, want 2026-01-31", got)
	}
	if got := iso(emi.NextDue(Collected{Interest: RupeesToPaise(9333)})); got != "2026-03-02" {
		t.Errorf("one EMI paid: got %s, want 2026-03-02", got)
	}

	// Interest-only (daily cadence): periods paid from the interest bucket only;
	// a principal settlement payment must NOT advance the interest due date.
	di := &Loan{
		Type:        LoanDailyInterest,
		Principal:   RupeesToPaise(50000),
		DailyAmount: ptrPaise(RupeesToPaise(100)),
		LoanDate:    day(2026, 7, 1),
		Status:      StatusActive,
	}
	if got := iso(di.NextDue(Collected{})); got != "2026-07-02" {
		t.Errorf("fresh daily-interest: got %s, want 2026-07-02", got)
	}
	if got := iso(di.NextDue(Collected{Interest: RupeesToPaise(300)})); got != "2026-07-05" {
		t.Errorf("3 periods paid: got %s, want 2026-07-05", got)
	}
	if got := iso(di.NextDue(Collected{Principal: RupeesToPaise(50000)})); got != "2026-07-02" {
		t.Errorf("principal payment must not advance interest due: got %s, want 2026-07-02", got)
	}

	// Flexible: first cycle's interest is due on the loan date itself.
	flex := &Loan{
		Type: LoanFlexible, Principal: RupeesToPaise(150000),
		Interest: RupeesToPaise(4500), DailyAmount: ptrPaise(RupeesToPaise(4500)),
		NumDays: ptrInt(30), LoanDate: day(2026, 7, 1), Status: StatusActive,
	}
	if got := iso(flex.NextDue(Collected{})); got != "2026-07-01" {
		t.Errorf("flexible fresh (1st cycle due day 0): got %s, want 2026-07-01", got)
	}
	// First cycle's interest paid → next due advances to the second cycle (+30d).
	if got := iso(flex.NextDue(Collected{Interest: RupeesToPaise(4500)})); got != "2026-07-31" {
		t.Errorf("flexible 1 cycle paid: got %s, want 2026-07-31", got)
	}
}

func TestFlexibleUsesOwnCycle(t *testing.T) {
	// FLEXIBLE with 15-day cycle: at day 30 that is 2 cycles.
	principal := RupeesToPaise(150000)
	loan := &Loan{
		Type:      LoanFlexible,
		Principal: principal,
		Rate:      3,
		Interest:  CalcInterest(principal, 3),
		NumDays:   ptrInt(15),
		LoanDate:  day(2026, 1, 1),
		Status:    StatusActive,
	}
	cycles := MonthlyCyclesElapsed(loan.LoanDate, day(2026, 1, 30), loan.cycleDays())
	if cycles != 2 {
		t.Fatalf("expected 2 cycles for 15-day flexible loan at day 30, got %d", cycles)
	}
}
