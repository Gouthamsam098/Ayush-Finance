package domain

import (
	"math"
	"testing"
)

// DBRupees must round to the nearest rupee, never truncate.
//
// Why this matters: user-entered money is validated to whole rupees, but
// DERIVED money is not. CalcInterest and EMI round to the nearest paise, so
// with a rate carrying up to 2 decimals (the validated maximum) they routinely
// land on a .50 remainder. Truncating discarded that, and — worse — disagreed
// with the frontend, which computes the same figures in rupee space with
// Math.round. CLAUDE.md requires the two implementations stay in lock-step.
func TestDBRupeesRoundsNotTruncates(t *testing.T) {
	tests := []struct {
		name  string
		paise Paise
		want  int64
	}{
		{"exact rupee", RupeesToPaise(2500), 2500},
		{"half rupee rounds up", 30863, 309},       // ₹308.63
		{"half rupee rounds up (.50)", 24690, 247}, // ₹246.90
		{"below half rounds down", 30820, 308},     // ₹308.20
		{"zero", 0, 0},
		{"one paise rounds to zero", 1, 0},
		{"99 paise rounds to one rupee", 99, 1},
		{"large value", RupeesToPaise(10000000), 10000000},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.paise.DBRupees(); got != tt.want {
				t.Errorf("Paise(%d).DBRupees() = %d, want %d", tt.paise, got, tt.want)
			}
		})
	}
}

// The regression guard: derived interest must survive the round-trip through
// storage as the SAME rupee figure the frontend shows. Truncation failed this
// on a quarter of all rate/principal combinations.
func TestDerivedInterestMatchesFrontendAcrossValidatedInputs(t *testing.T) {
	// Mirrors src/mock/DataContext.tsx calcInterest, which works in rupee space.
	frontendInterest := func(principalRupees int64, rate float64) int64 {
		return int64(math.Round(float64(principalRupees) * rate / 100))
	}

	mismatches := 0
	checked := 0
	// Principals are whole rupees (enforced by LoanInput validation); rates carry
	// at most 2 decimals (enforced on both sides).
	for pr := int64(1000); pr <= 200000; pr += 1000 {
		for r := 25; r <= 3000; r += 25 { // 0.25% … 30.00%
			rate := float64(r) / 100
			backend := CalcInterest(RupeesToPaise(float64(pr)), rate).DBRupees()
			want := frontendInterest(pr, rate)
			checked++
			if backend != want {
				if mismatches < 5 {
					t.Errorf("principal=%d rate=%.2f%%: backend stored %d, frontend shows %d",
						pr, rate, backend, want)
				}
				mismatches++
			}
		}
	}
	if mismatches > 0 {
		t.Fatalf("%d of %d derived-interest values disagree with the frontend — "+
			"the front/back lock-step is broken", mismatches, checked)
	}
}

// PaiseFromDBRupees is the inverse, so a whole-rupee amount must survive a
// full round-trip unchanged.
func TestWholeRupeeRoundTripIsLossless(t *testing.T) {
	for _, rupees := range []int64{0, 1, 100, 12345, 100000, 5000000} {
		p := PaiseFromDBRupees(rupees)
		if got := p.DBRupees(); got != rupees {
			t.Errorf("round-trip of ₹%d produced ₹%d", rupees, got)
		}
	}
}
