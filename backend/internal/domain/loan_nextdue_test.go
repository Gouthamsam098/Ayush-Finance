package domain

import (
	"testing"
	"time"
)

// NextDue must equal the frontend's nextDueFor for every loan behaviour: the
// sidebar's overdue badge reads this value while the dashboard reads the
// frontend's, and the payment form's latest date must match the server's.
func TestNextDueMirrorsFrontend(t *testing.T) {
	iso := func(tt *time.Time) string {
		if tt == nil {
			return "<nil>"
		}
		return tt.Format("2006-01-02")
	}
	check := func(name string, got *time.Time, want string) {
		t.Helper()
		if iso(got) != want {
			t.Errorf("%s: got %s, want %s", name, iso(got), want)
		}
	}
	late := day(2026, 12, 1)

	// Monthly Interest: calendar months, clamped at month end like addMonths.
	mi := &Loan{Type: LoanMonthlyInterest, Principal: RupeesToPaise(20000), Interest: RupeesToPaise(400),
		LoanDate: day(2026, 1, 31), Status: StatusActive}
	check("monthly interest fresh (31 Jan → 28 Feb)", mi.NextDue(Collected{}, late), "2026-02-28")
	check("monthly interest 1 paid (→ 31 Mar)", mi.NextDue(Collected{Interest: RupeesToPaise(400)}, late), "2026-03-31")

	// Monthly-mode Vehicle: calendar months too (was 30-day: 19 Sep).
	vm := &Loan{Type: LoanVehicle, RepaymentMode: RepayMonthlyInterest, Principal: RupeesToPaise(50000),
		Interest: RupeesToPaise(1000), LoanDate: day(2026, 8, 20), Status: StatusActive}
	check("monthly-mode vehicle fresh", vm.NextDue(Collected{}, late), "2026-09-20")
	check("monthly-mode vehicle 2 paid", vm.NextDue(Collected{Interest: RupeesToPaise(2000)}, late), "2026-11-20")

	// CAP — interest paid ahead counts only once its cycle has accrued. On
	// 25 Oct two cycles (20 Sep, 20 Oct) have fallen due; four were paid.
	oct25 := day(2026, 10, 25)
	check("interest paid ahead is capped at accrual", mi2(oct25).NextDue(Collected{Interest: RupeesToPaise(1600)}, oct25), "2026-11-20")
	// …and before any cycle is due, money paid ahead still leaves the first due.
	check("paid ahead before the first cycle", mi2(day(2026, 9, 1)).NextDue(Collected{Interest: RupeesToPaise(1600)}, day(2026, 9, 1)), "2026-09-20")

	// CAP — Daily Collection: on 13 Jul three instalments (11–13 Jul) are due.
	dc := &Loan{Type: LoanDailyCollection, Principal: RupeesToPaise(100000), DailyAmount: ptrPaise(RupeesToPaise(1000)),
		NumDays: ptrInt(100), LoanDate: day(2026, 7, 10), Status: StatusActive}
	check("daily paid 10 ahead, capped at 3 fallen due", dc.NextDue(Collected{Interest: RupeesToPaise(10000)}, day(2026, 7, 13)), "2026-07-14")
	check("daily in arrears stays on the oldest unpaid day", dc.NextDue(Collected{Interest: RupeesToPaise(1000)}, day(2026, 7, 13)), "2026-07-12")
	check("daily on the loan date", dc.NextDue(Collected{}, day(2026, 7, 10)), "2026-07-11")
	check("daily fully collected", dc.NextDue(Collected{Interest: RupeesToPaise(100000)}, day(2026, 7, 13)), "<nil>")

	// CAP — EMI: on 15 Feb one EMI (1 Feb) is due; three were paid.
	emi := &Loan{Type: LoanVehicle, Principal: RupeesToPaise(100000), Interest: RupeesToPaise(12000),
		DailyAmount: ptrPaise(RupeesToPaise(9333)), NumDays: ptrInt(12), LoanDate: day(2026, 1, 1), Status: StatusActive}
	check("EMI paid ahead, capped", emi.NextDue(Collected{Interest: RupeesToPaise(27999)}, day(2026, 2, 15)), "2026-03-01")

	// Daily Interest and Flexible keep day steps (unchanged), with the cap.
	di := &Loan{Type: LoanDailyInterest, Principal: RupeesToPaise(50000), DailyAmount: ptrPaise(RupeesToPaise(100)),
		LoanDate: day(2026, 7, 1), Status: StatusActive}
	check("daily interest paid ahead, capped at 2 accrued", di.NextDue(Collected{Interest: RupeesToPaise(1000)}, day(2026, 7, 3)), "2026-07-04")
	flex := &Loan{Type: LoanFlexible, Principal: RupeesToPaise(150000), Interest: RupeesToPaise(4500),
		DailyAmount: ptrPaise(RupeesToPaise(4500)), NumDays: ptrInt(30), LoanDate: day(2026, 7, 1), Status: StatusActive}
	// On 5 Jul only the first cycle (due 1 Jul) has accrued; two were paid.
	check("flexible paid ahead, capped at 1 accrued", flex.NextDue(Collected{Interest: RupeesToPaise(9000)}, day(2026, 7, 5)), "2026-07-31")
}

func mi2(_ time.Time) *Loan {
	return &Loan{Type: LoanMonthlyInterest, Principal: RupeesToPaise(20000), Interest: RupeesToPaise(400),
		LoanDate: day(2026, 8, 20), Status: StatusActive}
}
