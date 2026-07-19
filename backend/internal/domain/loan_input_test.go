package domain

import "testing"

func strp(s string) *string { return &s }

// Base valid input for a given type; caller tweaks as needed.
func baseInput(t LoanType) LoanInput {
	return LoanInput{
		CustomerID: 1,
		Type:       t,
		Principal:  RupeesToPaise(100000),
		Rate:       12,
		LoanDate:   day(2026, 7, 18),
	}
}

func TestDeriveDailyCollection(t *testing.T) {
	in := baseInput(LoanDailyCollection)
	in.Rate = 5 // ₹5,000/month interest
	d := in.Derive()

	if d.Interest != RupeesToPaise(5000) {
		t.Errorf("interest: got %s want ₹5000", d.Interest)
	}
	// Fixed 100-day term.
	if d.NumDays == nil || *d.NumDays != 100 {
		t.Errorf("term: got %v want 100", d.NumDays)
	}
	// Daily = principal ÷ 100 = ₹1,000.
	if d.DailyAmount == nil || *d.DailyAmount != RupeesToPaise(1000) {
		t.Errorf("daily: got %v want ₹1000", d.DailyAmount)
	}
	// 3 months of interest retained upfront = ₹15,000.
	if d.Deduction == nil || *d.Deduction != RupeesToPaise(15000) {
		t.Errorf("deduction: got %v want ₹15000", d.Deduction)
	}
	// First collection is the next day.
	if d.NextDueDate == nil || !d.NextDueDate.Equal(day(2026, 7, 19)) {
		t.Errorf("next due: got %v want 2026-07-19", d.NextDueDate)
	}
}

func TestDeriveEmi(t *testing.T) {
	in := baseInput(LoanVehicle)
	in.Rate = 12
	months := 12
	in.NumDays = &months
	in.VehicleNumber = strp("KL-07-AB-1234")
	d := in.Derive()

	// Overall interest = 12% of ₹1,00,000 = ₹12,000. No upfront deduction.
	if d.Interest != RupeesToPaise(12000) {
		t.Errorf("interest: got %s want ₹12000", d.Interest)
	}
	if d.Deduction != nil {
		t.Errorf("EMI must have no upfront deduction, got %v", d.Deduction)
	}
	// EMI = (100000 + 12000) / 12 = ₹9,333.33 → 933333 paise.
	if d.DailyAmount == nil || *d.DailyAmount != Paise(933333) {
		t.Errorf("EMI: got %v want 933333 paise", d.DailyAmount)
	}
	// First EMI is +30 days.
	if d.NextDueDate == nil || !d.NextDueDate.Equal(day(2026, 8, 17)) {
		t.Errorf("next due: got %v want 2026-08-17", d.NextDueDate)
	}
}

func TestDeriveInterestOnlyOpenEnded(t *testing.T) {
	in := baseInput(LoanMonthlyInterest)
	in.Rate = 5
	d := in.Derive()

	if d.NumDays != nil {
		t.Errorf("interest-only must be open-ended (nil term), got %v", d.NumDays)
	}
	if d.Deduction != nil {
		t.Errorf("interest-only has no upfront deduction, got %v", d.Deduction)
	}
	// Per-period interest = ₹5,000.
	if d.DailyAmount == nil || *d.DailyAmount != RupeesToPaise(5000) {
		t.Errorf("per-period interest: got %v want ₹5000", d.DailyAmount)
	}
}

func TestValidateRejectsBadFields(t *testing.T) {
	now := day(2026, 7, 18)

	// Missing customer + zero rate + future date.
	in := LoanInput{Type: LoanDailyCollection, Principal: RupeesToPaise(100000), Rate: 0, LoanDate: day(2026, 8, 1)}
	err := in.Validate(now)
	if err == nil {
		t.Fatal("expected validation error")
	}
	de, ok := err.(*Error)
	if !ok {
		t.Fatalf("expected *Error, got %T", err)
	}
	for _, f := range []string{"customer_id", "rate", "loan_date"} {
		if _, has := de.Fields[f]; !has {
			t.Errorf("expected error on field %q", f)
		}
	}

	// Vehicle without a vehicle number.
	v := baseInput(LoanVehicle)
	m := 12
	v.NumDays = &m
	if err := v.Validate(now); err == nil {
		t.Error("expected vehicle_number required error")
	}

	// EMI without tenure.
	e := baseInput(LoanProperty)
	if err := e.Validate(now); err == nil {
		t.Error("expected num_days required error for EMI")
	}
}

func TestValidateMoneyPrecision(t *testing.T) {
	now := day(2026, 7, 18)

	// Principal with paise (₹99,999.99 = 9999999 paise) → rejected (whole rupees only).
	frac := baseInput(LoanDailyCollection)
	frac.Principal = Paise(9999999)
	if err := frac.Validate(now); err == nil {
		t.Error("expected whole-rupee principal error")
	} else if de, _ := err.(*Error); de.Fields["principal"] == "" {
		t.Errorf("expected principal field error, got %v", de.Fields)
	}

	// Rate with 3 decimals → rejected.
	r3 := baseInput(LoanDailyCollection)
	r3.Rate = 5.257
	if err := r3.Validate(now); err == nil {
		t.Error("expected rate-precision error")
	}

	// Rate with 2 decimals (0.25) → accepted.
	r2 := baseInput(LoanDailyCollection)
	r2.Rate = 0.25
	if err := r2.Validate(now); err != nil {
		t.Errorf("0.25%% rate should be valid, got %v", err)
	}
}

func TestValidateAcceptsGoodInput(t *testing.T) {
	now := day(2026, 7, 18)
	in := baseInput(LoanDailyCollection)
	in.Contact = strp("9812345670")
	if err := in.Validate(now); err != nil {
		t.Errorf("expected valid, got %v", err)
	}
}
