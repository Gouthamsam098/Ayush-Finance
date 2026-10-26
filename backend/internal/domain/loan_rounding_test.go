package domain

import (
	"fmt"
	"strconv"
	"testing"
	"time"
)

// Every rate with at most two decimals must be accepted, however it lands in
// floating point (1.1 × 100 = 110.00000000000001), and anything finer refused.
func TestRateTwoDecimalRule(t *testing.T) {
	for cents := 1; cents <= 10000; cents++ {
		s := fmt.Sprintf("%d.%02d", cents/100, cents%100)
		r, _ := strconv.ParseFloat(s, 64) // how a JSON number reaches the server
		if !HasAtMostTwoDecimals(r) {
			t.Fatalf("rate %s refused", s)
		}
	}
	for _, s := range []string{"1.105", "0.001", "12.345", "2.2001"} {
		r, _ := strconv.ParseFloat(s, 64)
		if HasAtMostTwoDecimals(r) {
			t.Errorf("rate %s must be refused", s)
		}
	}
}

// Daily Collection: the stored figures must satisfy the DB CHECK
// disbursed = principal − deduction in whole rupees, with deduction = 3 × the
// stored (whole-rupee) interest — the same arithmetic as the frontend preview.
// Before, deduction and disbursed were rounded separately from a fractional
// interest and ₹25,000 @ 1.25% was refused by the CHECK.
func TestDailyCollectionFiguresAreConsistent(t *testing.T) {
	when := time.Date(2026, 10, 1, 0, 0, 0, 0, time.Local)
	checked := 0
	for p := int64(1000); p <= 2000000; p += 900 { // multiples of ₹100 required
		p := p - p%100
		for cents := 1; cents <= 10000; cents += 37 {
			r, _ := strconv.ParseFloat(fmt.Sprintf("%d.%02d", cents/100, cents%100), 64)
			in := LoanInput{Type: LoanDailyCollection, Principal: RupeesToPaise(float64(p)), Rate: r, LoanDate: when}
			d := in.Derive()
			interest, ded, disb := d.Interest.DBRupees(), d.Deduction.DBRupees(), d.Disbursed.DBRupees()
			if disb != p-ded {
				t.Fatalf("₹%d @ %s%%: disbursed %d ≠ principal − deduction %d (DB CHECK would refuse)", p, strconv.FormatFloat(r, 'f', -1, 64), disb, p-ded)
			}
			if ded != 3*interest {
				t.Fatalf("₹%d @ %v%%: deduction %d ≠ 3 × interest %d", p, r, ded, interest)
			}
			if d.Interest != d.Interest.WholeRupees() {
				t.Fatalf("₹%d @ %v%%: interest %v is not whole rupees", p, r, d.Interest)
			}
			checked++
		}
	}
	// The two cases the audit found refused by the CHECK.
	for _, c := range []struct {
		p    int64
		r    float64
		want int64 // disbursed, as the preview shows it
	}{{25000, 1.25, 25000 - 3*313}, {5000, 2.25, 5000 - 3*113}} {
		d := (&LoanInput{Type: LoanDailyCollection, Principal: RupeesToPaise(float64(c.p)), Rate: c.r, LoanDate: when}).Derive()
		if got := d.Disbursed.DBRupees(); got != c.want {
			t.Errorf("₹%d @ %v%%: disbursed %d, want %d (the preview)", c.p, c.r, got, c.want)
		}
	}
	if checked < 10000 {
		t.Fatalf("only %d combinations checked", checked)
	}
}
