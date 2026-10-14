package domain

import (
	"testing"
	"time"
)

// A CLOSED loan whose payments have been removed must be seen to have a balance
// again, so the collection service's status sync can reopen it.
//
// Regression: Outstanding() short-circuits to 0 for a CLOSED interest-only or
// EMI loan (correct for reporting — a settled loan owes nothing), which made
// IsFullyPaid always true for those loans and the `!fullyPaid && CLOSED` reopen
// branch unreachable. Deleting every collection left the loan at 0 collected
// but still CLOSED. Only DAILY_COLLECTION reopened, because it takes the
// IsInstalmentLoan path, which has no such short-circuit.
func TestClosedLoanWithNoPaymentsIsSeenAsUnpaid(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.Local)
	loanDate := time.Date(2026, 1, 1, 0, 0, 0, 0, time.Local)
	daily := Paise(10000)
	numDays := 100

	cases := []struct {
		name string
		loan Loan
	}{
		{"daily collection", Loan{
			Type: LoanDailyCollection, RepaymentMode: RepayEMI,
			Principal: 1000000, Interest: 50000, Deduction: ptr(Paise(150000)),
			DailyAmount: &daily, NumDays: &numDays, LoanDate: loanDate,
		}},
		{"daily interest", Loan{
			Type: LoanDailyInterest, RepaymentMode: RepayMonthlyInterest,
			Principal: 10000, Interest: 500, LoanDate: loanDate,
		}},
		{"monthly interest", Loan{
			Type: LoanMonthlyInterest, RepaymentMode: RepayMonthlyInterest,
			Principal: 1000000, Interest: 50000, LoanDate: loanDate,
		}},
		{"flexible", Loan{
			Type: LoanFlexible, RepaymentMode: RepayMonthlyInterest,
			Principal: 100000, Interest: 10000, NumDays: &numDays, LoanDate: loanDate,
		}},
		{"vehicle monthly-interest mode", Loan{
			Type: LoanVehicle, RepaymentMode: RepayMonthlyInterest,
			Principal: 1000000, Interest: 50000, LoanDate: loanDate,
		}},
		{"vehicle EMI mode", Loan{
			Type: LoanVehicle, RepaymentMode: RepayEMI,
			Principal: 600000, Interest: 60000, NumDays: &numDays, LoanDate: loanDate,
		}},
		{"property EMI mode", Loan{
			Type: LoanProperty, RepaymentMode: RepayEMI,
			Principal: 800000, Interest: 80000, NumDays: &numDays, LoanDate: loanDate,
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			l := tc.loan
			l.Status = StatusClosed
			none := Collected{}

			// The pre-existing behaviour, kept deliberately: a CLOSED loan reports
			// no outstanding, so reports about settled loans stay correct.
			if !l.IsFullyPaid(none, now) {
				t.Skip("type has no CLOSED short-circuit; reopen already worked")
			}

			// The fix: asked without regard to status, the loan clearly owes money.
			if l.HasNoBalanceIgnoringStatus(none, now) {
				t.Fatalf("%s: CLOSED loan with ZERO collections still reads as fully paid — "+
					"the status sync cannot reopen it, so deleting its payments leaves "+
					"0 collected but status CLOSED", tc.name)
			}
		})
	}
}

// The helper must not change the auto-CLOSE decision: a genuinely settled loan
// still reads as fully paid, so nothing reopens on its own.
func TestSettledLoanStillReadsFullyPaid(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.Local)
	l := Loan{
		Type: LoanDailyCollection, RepaymentMode: RepayEMI,
		Principal: 1000000, Interest: 50000, Deduction: ptr(Paise(150000)),
		LoanDate: time.Date(2026, 1, 1, 0, 0, 0, 0, time.Local),
		Status:   StatusClosed,
	}
	paid := Collected{Principal: 1000000}
	if !l.HasNoBalanceIgnoringStatus(paid, now) {
		t.Error("a fully repaid loan must still read as fully paid — otherwise it would reopen itself")
	}
}

// An ACTIVE loan must behave exactly as IsFullyPaid does today.
func TestActiveLoanUnaffectedByHelper(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.Local)
	l := Loan{
		Type: LoanDailyCollection, RepaymentMode: RepayEMI,
		Principal: 1000000, Interest: 50000, Deduction: ptr(Paise(150000)),
		LoanDate: time.Date(2026, 1, 1, 0, 0, 0, 0, time.Local),
		Status:   StatusActive,
	}
	for _, c := range []Collected{{}, {Principal: 400000}, {Principal: 1000000}} {
		if got, want := l.HasNoBalanceIgnoringStatus(c, now), l.IsFullyPaid(c, now); got != want {
			t.Errorf("ACTIVE loan diverged from IsFullyPaid: collected=%v got=%v want=%v", c, got, want)
		}
	}
}

func ptr[T any](v T) *T { return &v }
