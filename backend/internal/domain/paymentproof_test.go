package domain

import (
	"testing"
	"time"
)

// An approved portal proof / agent claim must be recorded exactly as staff
// would in the ledger. On interest-only loans the kind decides profit and the
// principal, so: full balance → settlement split; up to interest due + one
// period → interest (incl. interest paid a few days early); in between →
// refused, never guessed.
func TestSplitPortalPayment(t *testing.T) {
	rs := RupeesToPaise
	now := day(2026, 4, 15)

	// Monthly Interest: ₹1,00,000 at 2% (₹2,000/month) from 01 Jan → 3 months
	// accrued by 15 Apr = ₹6,000; ₹2,000 already paid → ₹4,000 due; outstanding
	// = ₹1,00,000 + ₹4,000 = ₹1,04,000.
	monthly := &Loan{
		Type: LoanMonthlyInterest, Principal: rs(100000), Rate: 2,
		Interest: rs(2000), DailyAmount: ptrPaise(rs(2000)),
		LoanDate: day(2026, 1, 1), Status: StatusActive,
	}
	paid := Collected{Interest: rs(2000)}
	if due := monthly.TotalDueForInterestOnly(paid, now); due != rs(4000) {
		t.Fatalf("fixture: interest due got %s, want ₹4,000", due)
	}
	emi := &Loan{
		Type: LoanVehicle, RepaymentMode: RepayEMI, Principal: rs(100000), Rate: 12,
		Interest: rs(12000), DailyAmount: ptrPaise(EMI(rs(100000), rs(12000), 12)),
		NumDays: ptrInt(12), LoanDate: day(2026, 1, 1), Status: StatusActive,
	}
	daily := &Loan{
		Type: LoanDailyCollection, Principal: rs(10000), Rate: 10, Interest: rs(1000),
		NumDays: ptrInt(100), LoanDate: day(2026, 1, 1), Status: StatusActive,
	}

	ok := []struct {
		name      string
		loan      *Loan
		collected Collected
		amount    Paise
		want      []PaymentPart
	}{
		{"interest-only: exactly the interest due", monthly, paid, rs(4000),
			[]PaymentPart{{KindInterest, rs(4000)}}},
		{"interest-only: part of the interest due", monthly, paid, rs(1500),
			[]PaymentPart{{KindInterest, rs(1500)}}},
		{"interest-only: due + one month ahead stays interest", monthly, paid, rs(6000),
			[]PaymentPart{{KindInterest, rs(6000)}}},
		{"interest-only: interest paid before it falls due stays interest", monthly, Collected{Interest: rs(6000)}, rs(2000),
			[]PaymentPart{{KindInterest, rs(2000)}}},
		{"interest-only: full balance = settlement split", monthly, paid, rs(104000),
			[]PaymentPart{{KindInterest, rs(4000)}, {KindPrincipal, rs(100000)}}},
		{"interest-only: full balance with nothing due = all principal", monthly, Collected{Interest: rs(6000)}, rs(100000),
			[]PaymentPart{{KindPrincipal, rs(100000)}}},
		{"EMI loan: one payment", emi, Collected{}, rs(20000),
			[]PaymentPart{{KindInterest, rs(20000)}}},
		{"daily collection: one payment", daily, Collected{Interest: rs(500)}, rs(9500),
			[]PaymentPart{{KindInterest, rs(9500)}}},
	}
	for _, tc := range ok {
		t.Run(tc.name, func(t *testing.T) {
			got, err := SplitPortalPayment(tc.loan, tc.collected, tc.amount, now)
			if err != nil {
				t.Fatalf("unexpected refusal: %v", err)
			}
			if len(got) != len(tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
			var sum Paise
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("part %d: got %v, want %v", i, got[i], tc.want[i])
				}
				sum = sum.Add(got[i].Amount)
			}
			if sum != tc.amount {
				t.Fatalf("parts sum to %s, want the full %s", sum, tc.amount)
			}
		})
	}

	// Between "interest due + one period" and the full balance = a part-principal
	// repayment whose intent can't be inferred → refused, nothing guessed.
	for _, amt := range []Paise{rs(6100), rs(50000), rs(103900)} {
		if parts, err := SplitPortalPayment(monthly, paid, amt, now); err == nil {
			t.Errorf("part-principal amount %s was recorded as %v instead of refused", amt, parts)
		}
	}
}

// The payment is dated when the borrower paid (submitted), not when staff
// approved, and never before the loan date.
func TestProofReceiptDate(t *testing.T) {
	loanDate := day(2026, 3, 10)
	submitted := time.Date(2026, 3, 30, 23, 40, 0, 0, time.Local)
	if got := ProofReceiptDate(submitted, loanDate); !got.Equal(day(2026, 3, 30)) {
		t.Errorf("got %v, want 30 Mar (submission day)", got)
	}
	early := time.Date(2026, 3, 9, 10, 0, 0, 0, time.Local)
	if got := ProofReceiptDate(early, loanDate); !got.Equal(loanDate) {
		t.Errorf("got %v, want the loan date", got)
	}
}

func TestPaymentProofInputValidate(t *testing.T) {
	ok := PaymentProofInput{LoanID: 1, Amount: RupeesToPaise(500), Purpose: PurposeCustom}
	if err := ok.Validate(); err != nil {
		t.Fatalf("valid input rejected: %v", err)
	}
	bad := []PaymentProofInput{
		{LoanID: 0, Amount: RupeesToPaise(500), Purpose: PurposeCustom},
		{LoanID: 1, Amount: 0, Purpose: PurposeCustom},
		{LoanID: 1, Amount: Paise(50050), Purpose: PurposeCustom}, // ₹500.50
		{LoanID: 1, Amount: RupeesToPaise(500), Purpose: "REFUND"},
	}
	for i, in := range bad {
		if err := in.Validate(); err == nil {
			t.Errorf("case %d: invalid input accepted: %+v", i, in)
		}
	}
}
