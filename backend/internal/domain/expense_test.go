package domain

import (
	"testing"
	"time"
)

// expenseNow is a fixed clock so date rules are deterministic.
func expenseNow() time.Time { return day(2026, 7, 26) }

// baseExpense is a valid input; callers tweak one field to test each rule.
func baseExpense() ExpenseInput {
	return ExpenseInput{
		Category: ExpenseOffice,
		Name:     "Office Rent",
		Amount:   RupeesToPaise(15000),
		Mode:     PayCash,
		Date:     day(2026, 7, 20),
	}
}

func TestExpenseValidateOK(t *testing.T) {
	in := baseExpense()
	in.SubCategory = strPtr("Office Rent")
	in.Remarks = strPtr("July")
	if err := in.Validate(expenseNow()); err != nil {
		t.Fatalf("valid expense rejected: %v", err)
	}
}

// fieldErr runs Validate and returns the field-error map (nil if it passed).
func fieldErr(t *testing.T, in ExpenseInput) map[string]string {
	t.Helper()
	err := in.Validate(expenseNow())
	if err == nil {
		return nil
	}
	de, ok := err.(*Error)
	if !ok {
		t.Fatalf("expected *domain.Error, got %T", err)
	}
	return de.Fields
}

func TestExpenseValidateRejects(t *testing.T) {
	cases := []struct {
		name  string
		mut   func(*ExpenseInput)
		field string
	}{
		{"empty name", func(in *ExpenseInput) { in.Name = "  " }, "name"},
		{"bad category", func(in *ExpenseInput) { in.Category = "Travel" }, "category"},
		{"zero amount", func(in *ExpenseInput) { in.Amount = 0 }, "amount"},
		{"negative amount", func(in *ExpenseInput) { in.Amount = RupeesToPaise(-5) }, "amount"},
		{"paise amount", func(in *ExpenseInput) { in.Amount = 15050 }, "amount"}, // ₹150.50 — not whole rupees
		{"bad mode", func(in *ExpenseInput) { in.Mode = "CARD" }, "mode"},
		{"missing date", func(in *ExpenseInput) { in.Date = time.Time{} }, "date"},
		{"future date", func(in *ExpenseInput) { in.Date = day(2026, 8, 30) }, "date"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			in := baseExpense()
			c.mut(&in)
			f := fieldErr(t, in)
			if f == nil {
				t.Fatalf("expected rejection on %s", c.field)
			}
			if _, ok := f[c.field]; !ok {
				t.Errorf("expected field error on %q, got %v", c.field, f)
			}
		})
	}
}

// Whole-rupee amounts and the clock-skew window (tomorrow) must be accepted.
func TestExpenseValidateBoundaries(t *testing.T) {
	in := baseExpense()
	in.Date = day(2026, 7, 27) // tomorrow — inside the 1-day clock-skew tolerance
	if err := in.Validate(expenseNow()); err != nil {
		t.Errorf("tomorrow should be allowed (clock skew): %v", err)
	}
}
