package domain

import "testing"

// Regression guard for the September 2026 incident: a re-keyed collection
// session recorded a second payment against days that were already paid,
// pushing two Daily Collection loans to 101 payments on a 100-day term and
// booking money the borrowers never owed.
//
// The rule under test is deliberately narrow — see CollectionInput.Validate:
//   - Daily Collection has a FIXED repayable pool (principal; interest was
//     deducted upfront), so a payment beyond it is rejected.
//   - Interest-only and EMI loans accrue with time and have no fixed ceiling,
//     so they must stay UNCAPPED or legitimate ongoing interest breaks.
//   - Advance/early settlement WITHIN the ceiling must still be allowed.
func TestValidateRejectsOverpaymentOnInstalmentLoanOnly(t *testing.T) {
	now := day(2026, 9, 5)

	dailyCollection := func() *Loan {
		return &Loan{
			Type:        LoanDailyCollection,
			Principal:   RupeesToPaise(100000),
			Deduction:   ptrPaise(RupeesToPaise(3000)),
			DailyAmount: ptrPaise(RupeesToPaise(1000)),
			NumDays:     ptrInt(100),
			LoanDate:    day(2026, 6, 1),
			Status:      StatusActive,
		}
	}

	input := func(rupees float64) *CollectionInput {
		return &CollectionInput{
			Amount: RupeesToPaise(rupees),
			Mode:   PayCash,
			Kind:   KindInterest,
			Date:   day(2026, 9, 5),
		}
	}

	t.Run("rejects payment beyond the fixed principal", func(t *testing.T) {
		// 99,000 already collected on a 1,00,000 principal → only 1,000 of room.
		collected := Collected{Interest: RupeesToPaise(99000)}
		if err := input(2000).Validate(dailyCollection(), collected, now); err == nil {
			t.Fatal("expected overpayment past principal to be rejected, got nil")
		}
	})

	t.Run("rejects any payment once fully repaid", func(t *testing.T) {
		collected := Collected{Interest: RupeesToPaise(100000)}
		if err := input(1000).Validate(dailyCollection(), collected, now); err == nil {
			t.Fatal("expected payment on a fully-repaid loan to be rejected, got nil")
		}
	})

	t.Run("allows a payment that exactly settles the balance", func(t *testing.T) {
		collected := Collected{Interest: RupeesToPaise(99000)}
		if err := input(1000).Validate(dailyCollection(), collected, now); err != nil {
			t.Fatalf("exact settlement must be allowed, got %v", err)
		}
	})

	t.Run("allows a large advance payment within the ceiling", func(t *testing.T) {
		// Early settlement / bulk advance is legitimate and must not regress.
		collected := Collected{Interest: RupeesToPaise(10000)}
		if err := input(90000).Validate(dailyCollection(), collected, now); err != nil {
			t.Fatalf("advance payment within the ceiling must be allowed, got %v", err)
		}
	})

	t.Run("does NOT cap interest-only loans", func(t *testing.T) {
		// Daily Interest accrues indefinitely: collected can far exceed
		// principal over the life of the loan. Capping it would break the
		// single largest category of real payments.
		interestOnly := &Loan{
			Type:        LoanDailyInterest,
			Principal:   RupeesToPaise(500000),
			DailyAmount: ptrPaise(RupeesToPaise(2000)),
			LoanDate:    day(2025, 12, 9),
			Status:      StatusActive,
		}
		collected := Collected{Interest: RupeesToPaise(600000)} // > principal, legitimately
		if err := input(2000).Validate(interestOnly, collected, now); err != nil {
			t.Fatalf("interest-only loans must stay uncapped, got %v", err)
		}
	})

	t.Run("does NOT cap EMI loans", func(t *testing.T) {
		emi := &Loan{
			Type:          LoanVehicle,
			RepaymentMode: RepayEMI,
			Principal:     RupeesToPaise(700000),
			Interest:      RupeesToPaise(35000),
			VehicleNumber: ptrStr("KA13HB9707"),
			NumDays:       ptrInt(12),
			LoanDate:      day(2026, 9, 1),
			Status:        StatusActive,
		}
		collected := Collected{Interest: RupeesToPaise(700000)}
		if err := input(35000).Validate(emi, collected, now); err != nil {
			t.Fatalf("EMI loans must stay uncapped by this rule, got %v", err)
		}
	})
}

// The overpayment ceiling must not break EDITING an existing payment. When a
// payment is updated, the stored collected-tally still holds that row's OLD
// amount; validating the new amount against it counts the payment twice and
// rejects a legitimate (even no-op) edit. Collected.Less removes the old row
// first — this locks that behaviour in.
func TestCollectedLessUnblocksPaymentEdits(t *testing.T) {
	now := day(2026, 9, 5)
	loan := &Loan{
		Type:        LoanDailyCollection,
		Principal:   RupeesToPaise(200000),
		Deduction:   ptrPaise(RupeesToPaise(6000)),
		DailyAmount: ptrPaise(RupeesToPaise(2000)),
		NumDays:     ptrInt(100),
		LoanDate:    day(2026, 1, 1),
		Status:      StatusActive,
	}
	// Loan is fully repaid: 2,00,000 collected against a 2,00,000 principal.
	stored := Collected{Interest: RupeesToPaise(200000)}
	edit := &CollectionInput{
		Amount: RupeesToPaise(20000),
		Mode:   PayCash,
		Kind:   KindInterest,
		Date:   day(2026, 9, 1),
	}

	// Validating against the raw tally double-counts the edited row.
	if err := edit.Validate(loan, stored, now); err == nil {
		t.Fatal("guard should reject when the edited row is still counted (double-count)")
	}

	// Removing the edited row's old amount first makes the same edit valid:
	// 2,00,000 − 20,000 + 20,000 = 2,00,000, exactly the principal.
	adjusted := stored.Less(KindInterest, RupeesToPaise(20000))
	if err := edit.Validate(loan, adjusted, now); err != nil {
		t.Fatalf("no-op edit of an existing payment must be allowed, got %v", err)
	}
}

func TestCollectedLessNeverGoesNegative(t *testing.T) {
	c := Collected{Interest: RupeesToPaise(500), Principal: RupeesToPaise(100)}
	if got := c.Less(KindInterest, RupeesToPaise(900)); got.Interest != 0 {
		t.Fatalf("interest bucket must clamp at 0, got %s", got.Interest)
	}
	if got := c.Less(KindPrincipal, RupeesToPaise(900)); got.Principal != 0 {
		t.Fatalf("principal bucket must clamp at 0, got %s", got.Principal)
	}
}
