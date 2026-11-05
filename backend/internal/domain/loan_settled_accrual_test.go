package domain

import (
	"testing"
	"time"
)

// A settled interest-only loan must stay settled when one of its payments is
// later edited or deleted without changing what was paid.
//
// Regression: interest accrued UNCAPPED to `now`, even after the principal was
// repaid. The status sync after any edit/delete re-evaluated the loan as if
// ACTIVE today, found the months since settlement unpaid, reopened it with
// phantom arrears and handed it to recovery. Interest now stops on the day the
// principal is repaid in full (Collected.PrincipalRepaidOn).
func settledInterestOnlyLoans() []struct {
	name string
	loan Loan
} {
	return []struct {
		name string
		loan Loan
	}{
		{"monthly interest", Loan{Type: LoanMonthlyInterest, RepaymentMode: RepayMonthlyInterest,
			Principal: RupeesToPaise(100000), Interest: RupeesToPaise(2000), DailyAmount: ptrPaise(RupeesToPaise(2000)),
			LoanDate: day(2026, 1, 1)}},
		{"daily interest", Loan{Type: LoanDailyInterest, RepaymentMode: RepayMonthlyInterest,
			Principal: RupeesToPaise(100000), Interest: RupeesToPaise(100), DailyAmount: ptrPaise(RupeesToPaise(100)),
			LoanDate: day(2026, 1, 1)}},
		{"flexible 30-day", Loan{Type: LoanFlexible, RepaymentMode: RepayMonthlyInterest,
			Principal: RupeesToPaise(100000), Interest: RupeesToPaise(3000), DailyAmount: ptrPaise(RupeesToPaise(3000)),
			NumDays: ptrInt(30), LoanDate: day(2026, 1, 1)}},
		{"vehicle monthly-interest mode", Loan{Type: LoanVehicle, RepaymentMode: RepayMonthlyInterest,
			Principal: RupeesToPaise(100000), Interest: RupeesToPaise(2000), DailyAmount: ptrPaise(RupeesToPaise(2000)),
			LoanDate: day(2026, 1, 1)}},
		{"property monthly-interest mode", Loan{Type: LoanProperty, RepaymentMode: RepayMonthlyInterest,
			Principal: RupeesToPaise(100000), Interest: RupeesToPaise(2000), DailyAmount: ptrPaise(RupeesToPaise(2000)),
			LoanDate: day(2026, 1, 1)}},
	}
}

func TestSettledInterestOnlyLoanStaysSettled(t *testing.T) {
	settledOn := day(2026, 3, 15)
	later := day(2026, 7, 20) // months after settlement, several cycles on
	for _, tc := range settledInterestOnlyLoans() {
		t.Run(tc.name, func(t *testing.T) {
			l := tc.loan
			l.Status = StatusActive
			// What "Settle & close" collects on the settlement day: the interest
			// accrued so far plus the whole principal.
			owedInterest := l.AccruedInterest(settledOn)
			paid := Collected{Interest: owedInterest, Principal: l.Principal, PrincipalRepaidOn: &settledOn}
			if !l.IsFullyPaid(paid, settledOn) {
				t.Fatalf("fixture: settlement on %s should close the loan", settledOn.Format("2006-01-02"))
			}

			// Later: a payment is edited/deleted without changing the money.
			l.Status = StatusClosed
			if !l.HasNoBalanceIgnoringStatus(paid, later) {
				asActive := l
				asActive.Status = StatusActive
				t.Fatalf("settled loan re-evaluated on %s reopens with phantom arrears %s",
					later.Format("2006-01-02"), asActive.Outstanding(paid, later).INR())
			}

			// Even while ACTIVE (e.g. manually reopened) it owes and is behind on nothing.
			l.Status = StatusActive
			if got := l.Outstanding(paid, later); got != 0 {
				t.Errorf("outstanding after settlement = %s, want ₹0", got.INR())
			}
			if got := ScheduleShortfall(&l, paid, later); got != 0 {
				t.Errorf("recovery shortfall after settlement = %s, want ₹0 (no agent for a paid loan)", got.INR())
			}
			if got := l.NextDue(paid, later); got != nil {
				t.Errorf("next due after settlement = %s, want none", got.Format("2006-01-02"))
			}
		})
	}
}

// Removing money that WAS needed must still reopen the loan — and the arrears
// shown are exactly what was removed, not inflated by post-settlement periods.
func TestSettledInterestOnlyLoanReopensOnRealShortfall(t *testing.T) {
	settledOn := day(2026, 3, 15)
	later := day(2026, 7, 20)
	for _, tc := range settledInterestOnlyLoans() {
		t.Run(tc.name, func(t *testing.T) {
			l := tc.loan
			owedInterest := l.AccruedInterest(settledOn)
			per := l.InterestPerPeriod()

			// An interest payment deleted: one period short, frozen at settlement.
			l.Status = StatusClosed
			short := Collected{Interest: owedInterest.Sub(per), Principal: l.Principal, PrincipalRepaidOn: &settledOn}
			if l.HasNoBalanceIgnoringStatus(short, later) {
				t.Fatal("an interest payment removed from a settled loan must reopen it")
			}
			l.Status = StatusActive
			if got := l.Outstanding(short, later); got != per {
				t.Errorf("reopened outstanding = %s, want exactly the removed period %s", got.INR(), per.INR())
			}
			if got := ScheduleShortfall(&l, short, later); got != per {
				t.Errorf("recovery shortfall = %s, want %s", got.INR(), per.INR())
			}

			// The principal payment deleted: principal owed again, interest runs to today.
			l.Status = StatusClosed
			noPrincipal := Collected{Interest: owedInterest}
			if l.HasNoBalanceIgnoringStatus(noPrincipal, later) {
				t.Fatal("deleting the principal payment must reopen the loan")
			}
			l.Status = StatusActive
			want := l.Principal.Add(l.AccruedInterest(later).Sub(owedInterest))
			if got := l.Outstanding(noPrincipal, later); got != want {
				t.Errorf("outstanding with principal unpaid = %s, want %s", got.INR(), want.INR())
			}

			// The principal payment edited down: still owed, interest runs to today.
			l.Status = StatusClosed
			partPrincipal := Collected{Interest: owedInterest, Principal: l.Principal.Sub(RupeesToPaise(10000))}
			if l.HasNoBalanceIgnoringStatus(partPrincipal, later) {
				t.Fatal("principal edited below the loan principal must reopen the loan")
			}

			// The principal payment re-dated later than settlement: more interest was owed.
			l.Status = StatusClosed
			redated := day(2026, 6, 20)
			movedLater := Collected{Interest: owedInterest, Principal: l.Principal, PrincipalRepaidOn: &redated}
			if l.HasNoBalanceIgnoringStatus(movedLater, later) {
				t.Fatal("principal repaid later than the interest covers must reopen the loan")
			}
		})
	}
}

// Loans whose principal is NOT repaid in full keep accruing to `now` exactly as
// before — the cut-off changes nothing for them.
func TestAccrualUnchangedUntilPrincipalRepaid(t *testing.T) {
	now := day(2026, 7, 20)
	repaid := day(2026, 3, 15)
	for _, tc := range settledInterestOnlyLoans() {
		t.Run(tc.name, func(t *testing.T) {
			l := tc.loan
			l.Status = StatusActive
			for _, c := range []Collected{
				{},
				{Interest: RupeesToPaise(4000)},
				{Interest: RupeesToPaise(4000), Principal: RupeesToPaise(40000)},
				// A date with principal still owed (e.g. an edit-in-progress tally) is ignored.
				{Interest: RupeesToPaise(4000), Principal: RupeesToPaise(40000), PrincipalRepaidOn: &repaid},
			} {
				want := l.AccruedInterest(now).Sub(c.Interest)
				if got := l.TotalDueForInterestOnly(c, now); got != want {
					t.Errorf("collected=%+v: interest due %s, want %s (accrual to today)", c, got.INR(), want.INR())
				}
			}
			// Repaid today (or a future-dated receipt): accrual still runs to today.
			today := now
			future := now.AddDate(0, 0, 1)
			for _, on := range []*time.Time{&today, &future} {
				c := Collected{Interest: RupeesToPaise(4000), Principal: l.Principal, PrincipalRepaidOn: on}
				if got, want := l.TotalDueForInterestOnly(c, now), l.AccruedInterest(now).Sub(c.Interest); got != want {
					t.Errorf("repaid on %s: interest due %s, want %s", on.Format("2006-01-02"), got.INR(), want.INR())
				}
			}
		})
	}
}

// Daily Collection and EMI loans never read the repaid date.
func TestRepaidDateIgnoredOutsideInterestOnly(t *testing.T) {
	now := day(2026, 7, 20)
	on := day(2026, 3, 15)
	dc := Loan{Type: LoanDailyCollection, RepaymentMode: RepayEMI, Principal: RupeesToPaise(10000),
		Interest: RupeesToPaise(1000), DailyAmount: ptrPaise(RupeesToPaise(100)), NumDays: ptrInt(100),
		LoanDate: day(2026, 1, 1), Status: StatusActive}
	emi := Loan{Type: LoanVehicle, RepaymentMode: RepayEMI, Principal: RupeesToPaise(100000),
		Interest: RupeesToPaise(12000), DailyAmount: ptrPaise(EMI(RupeesToPaise(100000), RupeesToPaise(12000), 12)),
		NumDays: ptrInt(12), LoanDate: day(2026, 1, 1), Status: StatusActive}
	for _, l := range []Loan{dc, emi} {
		without := Collected{Interest: RupeesToPaise(5000)}
		with := without
		with.PrincipalRepaidOn = &on
		if a, b := l.Outstanding(without, now), l.Outstanding(with, now); a != b {
			t.Errorf("%s: outstanding changed by the repaid date: %s vs %s", l.Type, a.INR(), b.INR())
		}
		if a, b := ScheduleShortfall(&l, without, now), ScheduleShortfall(&l, with, now); a != b {
			t.Errorf("%s: shortfall changed by the repaid date: %s vs %s", l.Type, a.INR(), b.INR())
		}
	}
}
