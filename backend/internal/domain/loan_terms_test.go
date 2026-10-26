package domain

import (
	"reflect"
	"testing"
	"time"
)

// An edit is checked field by field: only changes to what the loan is worth or
// when it falls due count as term changes (they are refused once payments
// exist); contact, remarks and vehicle details never do.
func TestLoanTermChanges(t *testing.T) {
	loanDate := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC) // as scanned from a DATE column
	months := 12
	stored := &Loan{CustomerID: 7, Type: LoanVehicle, RepaymentMode: RepayEMI, Principal: RupeesToPaise(60000),
		Rate: 1.1, NumDays: &months, LoanDate: loanDate}
	same := func() LoanInput {
		m := 12
		return LoanInput{CustomerID: 7, Type: LoanVehicle, RepaymentMode: "", Principal: RupeesToPaise(60000),
			Rate: 1.1, NumDays: &m, LoanDate: time.Date(2026, 9, 1, 0, 0, 0, 0, time.Local)}
	}

	in := same()
	contact, remarks, plate := "9876543210", "moved house", "KA-05-MN-4321"
	in.Contact, in.Remarks, in.VehicleNumber = &contact, &remarks, &plate
	if got := in.TermChanges(stored); len(got) != 0 {
		t.Fatalf("contact/remarks/vehicle edit reported term changes %v", got)
	}

	cases := map[string]func(*LoanInput){
		"customer_id":    func(i *LoanInput) { i.CustomerID = 8 },
		"type":           func(i *LoanInput) { i.Type = LoanProperty },
		"repayment_mode": func(i *LoanInput) { i.RepaymentMode = RepayMonthlyInterest },
		"principal":      func(i *LoanInput) { i.Principal = RupeesToPaise(60100) },
		"rate":           func(i *LoanInput) { i.Rate = 1.15 },
		"loan_date":      func(i *LoanInput) { i.LoanDate = i.LoanDate.AddDate(0, 0, 1) },
		"num_days":       func(i *LoanInput) { m := 13; i.NumDays = &m },
	}
	for want, mutate := range cases {
		in := same()
		mutate(&in)
		got := in.TermChanges(stored)
		if want == "repayment_mode" {
			// Switching to monthly-interest mode also drops the tenure from the terms.
			if len(got) != 1 || got[0] != want {
				t.Errorf("%s change: got %v", want, got)
			}
			continue
		}
		if !reflect.DeepEqual(got, []string{want}) {
			t.Errorf("%s change: got %v, want [%s]", want, got, want)
		}
	}

	// Tenure is not a term for types that derive it (Daily Collection's fixed 100 days).
	dc := &Loan{CustomerID: 7, Type: LoanDailyCollection, Principal: RupeesToPaise(10000), Rate: 10, NumDays: ptrInt(100), LoanDate: loanDate}
	dcIn := LoanInput{CustomerID: 7, Type: LoanDailyCollection, Principal: RupeesToPaise(10000), Rate: 10, NumDays: ptrInt(30),
		LoanDate: time.Date(2026, 9, 1, 0, 0, 0, 0, time.Local)}
	if got := dcIn.TermChanges(dc); len(got) != 0 {
		t.Errorf("daily collection with a client num_days reported %v", got)
	}
}

// An edit that changes no term keeps every stored money figure as it is.
func TestStoredTermsRoundTrip(t *testing.T) {
	ded, daily, n := RupeesToPaise(938), RupeesToPaise(250), 100
	next := time.Date(2026, 9, 2, 0, 0, 0, 0, time.Local)
	l := &Loan{Interest: RupeesToPaise(313), Deduction: &ded, Disbursed: RupeesToPaise(24062), DailyAmount: &daily, NumDays: &n, NextDueDate: &next}
	d := l.StoredTerms()
	if d.Interest != l.Interest || *d.Deduction != ded || d.Disbursed != l.Disbursed || *d.DailyAmount != daily || *d.NumDays != n || !d.NextDueDate.Equal(next) {
		t.Fatalf("stored terms changed: %+v", d)
	}
}
