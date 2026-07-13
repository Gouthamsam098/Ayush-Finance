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
	collected := RupeesToPaise(2000)
	got := loan.Outstanding(collected, day(2026, 7, 13))
	want := RupeesToPaise(298000)
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestOutstandingDailyInterestRisesWhenBehind(t *testing.T) {
	// DAILY_INTEREST: outstanding = principal + shortfall. With 10 elapsed
	// days at 750/day = 7500 expected, minus 2000 collected = 5500 shortfall.
	loan := &Loan{
		Type:        LoanDailyInterest,
		Principal:   RupeesToPaise(100000),
		DailyAmount: ptrPaise(RupeesToPaise(750)),
		NumDays:     ptrInt(100),
		LoanDate:    day(2026, 7, 4),
		Status:      StatusActive,
	}
	collected := RupeesToPaise(2000)
	got := loan.Outstanding(collected, day(2026, 7, 13))
	want := RupeesToPaise(105500)
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestOutstandingMonthlyLike(t *testing.T) {
	// MONTHLY_INTEREST at day 60 = 2 cycles. Interest = 2% of 1,200,000 =
	// 24,000/cycle. Due = 48,000, collected 24,000, outstanding =
	// principal + (48000 - 24000) = 1,224,000.
	principal := RupeesToPaise(1200000)
	loan := &Loan{
		Type:      LoanMonthlyInterest,
		Principal: principal,
		Rate:      2,
		Interest:  CalcInterest(principal, 2),
		LoanDate:  day(2026, 1, 1),
		Status:    StatusActive,
	}
	collected := RupeesToPaise(24000)
	got := loan.Outstanding(collected, day(2026, 3, 1))
	want := RupeesToPaise(1224000)
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestClosedLoanOwesNothingExceptDailyCollection(t *testing.T) {
	monthly := &Loan{
		Type:      LoanMonthlyInterest,
		Principal: RupeesToPaise(500000),
		Interest:  RupeesToPaise(10000),
		LoanDate:  day(2026, 1, 1),
		Status:    StatusClosed,
	}
	if got := monthly.Outstanding(0, day(2026, 6, 1)); got != 0 {
		t.Errorf("closed monthly loan should owe 0, got %s", got)
	}

	// DAILY_COLLECTION residual is still meaningful after closing.
	daily := &Loan{
		Type:      LoanDailyCollection,
		Principal: RupeesToPaise(300000),
		LoanDate:  day(2026, 1, 1),
		Status:    StatusClosed,
	}
	if got := daily.Outstanding(RupeesToPaise(250000), day(2026, 6, 1)); got != RupeesToPaise(50000) {
		t.Errorf("closed daily-collection residual wrong, got %s", got)
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
