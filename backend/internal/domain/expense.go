package domain

import (
	"strings"
	"time"
)

// ExpenseCategory is the top-level bucket an expense belongs to. The DB enforces
// the same set (expenses_category_valid CHECK). The sub-category is free text.
type ExpenseCategory string

const (
	ExpensePersonal ExpenseCategory = "Personal"
	ExpenseOffice   ExpenseCategory = "Office"
	ExpenseSavings  ExpenseCategory = "Savings"
)

var validExpenseCategories = map[ExpenseCategory]bool{
	ExpensePersonal: true, ExpenseOffice: true, ExpenseSavings: true,
}

// IsValidExpenseCategory reports whether c is an accepted expense category.
func IsValidExpenseCategory(c ExpenseCategory) bool { return validExpenseCategories[c] }

// Expense is a single business/personal outgoing. Amount is Paise; the id is a
// plain identity PK (no human-readable code — expenses aren't referenced the way
// loans/receipts are). Soft-deleted like every other entity.
type Expense struct {
	ID          int64
	Category    ExpenseCategory
	SubCategory *string
	Name        string
	Amount      Paise
	Mode        PayMode
	Date        time.Time // YYYY-MM-DD, normalised to local midnight
	Remarks     *string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

const (
	maxExpenseNameLen        = 255
	maxExpenseSubCategoryLen = 100
	maxExpenseRemarksLen     = 300
)

// ExpenseInput is the validated create/update payload. Amount is Paise; Date is
// the calendar day the expense was incurred.
type ExpenseInput struct {
	Category    ExpenseCategory
	SubCategory *string
	Name        string
	Amount      Paise
	Mode        PayMode
	Date        time.Time
	Remarks     *string
}

// ExpensePatch is a partial update: only the set fields change. Nil pointers are
// left untouched. SubCategory/Remarks are nullable columns, so a distinct "set"
// flag lets an explicit null clear them while an omitted key preserves them.
type ExpensePatch struct {
	Category    *ExpenseCategory
	SubCategory *string
	Name        *string
	Amount      *Paise
	Mode        *PayMode
	Date        *time.Time
	Remarks     *string

	SubCategorySet bool // true when the caller included sub_category (even as null)
	RemarksSet     bool // true when the caller included remarks (even as null)
}

// ApplyTo folds the patch onto a base input (typically built from the stored
// expense) and returns the merged input to be validated + persisted.
func (p ExpensePatch) ApplyTo(base ExpenseInput) ExpenseInput {
	if p.Category != nil {
		base.Category = *p.Category
	}
	if p.Name != nil {
		base.Name = *p.Name
	}
	if p.Amount != nil {
		base.Amount = *p.Amount
	}
	if p.Mode != nil {
		base.Mode = *p.Mode
	}
	if p.Date != nil {
		base.Date = *p.Date
	}
	if p.SubCategorySet {
		base.SubCategory = p.SubCategory // may be nil → clears it
	}
	if p.RemarksSet {
		base.Remarks = p.Remarks // may be nil → clears it
	}
	return base
}

// ToInput builds a full input from a patch alone (used on create, where every
// required field must be present or validation will reject it).
func (p ExpensePatch) ToInput() ExpenseInput {
	return p.ApplyTo(ExpenseInput{})
}

// AsInput converts a stored expense back into an input (the merge base for updates).
func (e *Expense) AsInput() ExpenseInput {
	return ExpenseInput{
		Category:    e.Category,
		SubCategory: e.SubCategory,
		Name:        e.Name,
		Amount:      e.Amount,
		Mode:        e.Mode,
		Date:        e.Date,
		Remarks:     e.Remarks,
	}
}

// Validate checks an expense to industrial standard (mirrors the frontend
// inline rules). `now` is injected for testability. Money is whole rupees only,
// matching every other money entity; the date may not be in the future (beyond
// the clock-skew window).
func (in *ExpenseInput) Validate(now time.Time) error {
	fields := map[string]string{}

	if strings.TrimSpace(in.Name) == "" {
		fields["name"] = "Expense name is required"
	} else if len([]rune(strings.TrimSpace(in.Name))) > maxExpenseNameLen {
		fields["name"] = "Max 255 characters"
	}

	if !IsValidExpenseCategory(in.Category) {
		fields["category"] = "Select a valid category"
	}

	if in.SubCategory != nil && len([]rune(strings.TrimSpace(*in.SubCategory))) > maxExpenseSubCategoryLen {
		fields["sub_category"] = "Max 100 characters"
	}

	if in.Amount <= 0 {
		fields["amount"] = "Enter an amount greater than 0"
	} else if int64(in.Amount)%100 != 0 {
		// Money is whole rupees only, mirroring the loan/collection rules.
		fields["amount"] = "Enter a whole rupee amount"
	} else if in.Amount > maxPrincipalPaise {
		fields["amount"] = "Amount is unrealistically large"
	}

	if !IsValidPayMode(in.Mode) {
		fields["mode"] = "Select a valid payment mode"
	}

	if in.Date.IsZero() {
		fields["date"] = "Expense date is required"
	} else if IsFutureDate(in.Date, now) {
		fields["date"] = "Expense date cannot be in the future"
	}

	if in.Remarks != nil && len([]rune(*in.Remarks)) > maxExpenseRemarksLen {
		fields["remarks"] = "Max 300 characters"
	}

	if len(fields) > 0 {
		return NewValidation("Please fix the highlighted fields", fields)
	}
	return nil
}
