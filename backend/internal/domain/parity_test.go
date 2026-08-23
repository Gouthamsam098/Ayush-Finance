package domain

import (
	"math"
	"testing"
	"time"
)

// FRONT/BACK LOCK-STEP (CLAUDE.md): the frontend computes interest in RUPEE
// space with Math.round; the backend computes in PAISE space. Those differ
// internally, but every value that is stored or emitted passes through
// DBRupees()/Rupees() — so the OBSERVABLE figures must match exactly.
// This guards the boundary, which is what actually matters.
func TestInvestmentInterestMatchesFrontend(t *testing.T) {
	// frontendPerCycle mirrors src/lib/investments.ts interestPerCycle():
	//   Math.round(principal * rate / 100) on whole rupees.
	frontendPerCycle := func(principalRupees float64, rate float64) int64 {
		return int64(math.Round(principalRupees * rate / 100))
	}
	rates := []float64{0.25, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 5, 10, 12, 18, 24, 30}
	for p := int64(100); p <= 500000; p += 700 { // whole rupees, as validation enforces
		for _, r := range rates {
			inv := &Investment{Principal: RupeesToPaise(float64(p)), Rate: r}
			got := inv.InterestPerCycle().DBRupees() // what is stored / emitted
			want := frontendPerCycle(float64(p), r)
			if got != want {
				t.Fatalf("perCycle divergence: principal=%d rate=%v backend=%d frontend=%d", p, r, got, want)
			}
		}
	}
}

// Cycle counting must be identical on both sides: a cycle counts from its DUE
// day, never a day early, and a settled investment stops accruing.
func TestInvestmentCycleParity(t *testing.T) {
	cases := []struct {
		start, asOf string
		freq        PayoutFrequency
		want        int
	}{
		{"2026-01-10", "2026-01-10", PayoutMonthly, 0}, // start day
		{"2026-01-10", "2026-02-09", PayoutMonthly, 0}, // day before due
		{"2026-01-10", "2026-02-10", PayoutMonthly, 1}, // on the due day
		{"2026-01-10", "2026-08-24", PayoutMonthly, 7},
		{"2025-03-01", "2026-02-28", PayoutYearly, 0},
		{"2025-03-01", "2026-03-01", PayoutYearly, 1},
		// Month-end start: Jan 31 + 1 month lands on Feb 28/Mar 3 depending on
		// the engine. Asserting it pins the behaviour so it cannot drift.
		{"2026-01-31", "2026-03-03", PayoutMonthly, 1},
	}
	for _, c := range cases {
		st, _ := time.ParseInLocation("2006-01-02", c.start, time.Local)
		asOf, _ := time.ParseInLocation("2006-01-02", c.asOf, time.Local)
		inv := &Investment{
			Principal: RupeesToPaise(100000), Rate: 2,
			Frequency: c.freq, StartDate: st, Status: InvestmentActive,
		}
		if got := inv.CyclesElapsed(asOf); got != c.want {
			t.Errorf("cycles(%s..%s, %s) = %d, want %d", c.start, c.asOf, c.freq, got, c.want)
		}
	}
}
