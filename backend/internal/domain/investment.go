package domain

import (
	"strings"
	"time"
)

// PayoutFrequency is how often interest falls due to an investor.
type PayoutFrequency string

const (
	PayoutMonthly PayoutFrequency = "MONTHLY"
	PayoutYearly  PayoutFrequency = "YEARLY"
)

var validPayoutFrequencies = map[PayoutFrequency]bool{
	PayoutMonthly: true, PayoutYearly: true,
}

// IsValidPayoutFrequency reports whether f is an accepted cadence.
func IsValidPayoutFrequency(f PayoutFrequency) bool { return validPayoutFrequencies[f] }

// InvestmentStatus mirrors LoanStatus: ACTIVE until the capital is returned.
type InvestmentStatus string

const (
	InvestmentActive InvestmentStatus = "ACTIVE"
	InvestmentClosed InvestmentStatus = "CLOSED"
)

// Investment is capital the business BORROWED from an investor. The mirror of
// an interest-only loan: the principal stays outstanding until settled, and
// interest accrues every cycle. Amount fields are Paise; the human-readable
// INV-#### code is minted from a sequence on insert.
type Investment struct {
	ID           int64
	Code         string
	InvestorName string
	Mobile       *string
	Email        *string
	Principal    Paise
	// Rate is PER CYCLE: 2% monthly = 2% of principal every month;
	// 12% yearly = 12% once a year. Mirrors loan rate semantics.
	Rate        float64
	Frequency   PayoutFrequency
	StartDate   time.Time
	Status      InvestmentStatus
	SettledDate *time.Time
	Notes       *string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// InterestPerCycle = round(principal × rate / 100), the amount owed each cycle.
// Mirrors calcInterest for loans, so both sides of the book round identically.
func (i *Investment) InterestPerCycle() Paise {
	return CalcInterest(i.Principal, i.Rate)
}

// cycleStepMonths is 1 for monthly investors, 12 for yearly ones.
func (i *Investment) cycleStepMonths() int {
	if i.Frequency == PayoutYearly {
		return 12
	}
	return 1
}

// CycleDueDate returns the due date of cycle k (1-based).
func (i *Investment) CycleDueDate(k int) time.Time {
	return truncateToDay(i.StartDate).AddDate(0, k*i.cycleStepMonths(), 0)
}

// CyclesElapsed counts the cycles that have FALLEN DUE by `asOf`. Cycle k is
// due at start + k·step, so it counts from its due day and never a day early —
// the same rule as monthlyCyclesElapsed for loans. A settled investment stops
// accruing on its settlement date.
func (i *Investment) CyclesElapsed(asOf time.Time) int {
	end := truncateToDay(asOf)
	if i.Status == InvestmentClosed && i.SettledDate != nil {
		if s := truncateToDay(*i.SettledDate); s.Before(end) {
			end = s
		}
	}
	k := 0
	for {
		due := i.CycleDueDate(k + 1)
		if due.After(end) {
			break
		}
		k++
		if k > 1200 { // sanity bound against a corrupt start date
			break
		}
	}
	return k
}

// AccruedInterest is interest owed to date, whether paid or not.
func (i *Investment) AccruedInterest(asOf time.Time) Paise {
	return Paise(int64(i.CyclesElapsed(asOf)) * int64(i.InterestPerCycle()))
}

// InterestDue is accrued interest less what has been paid out. Never negative:
// paying ahead shows as nothing owed, not as a credit.
func (i *Investment) InterestDue(paid Paise, asOf time.Time) Paise {
	due := i.AccruedInterest(asOf) - paid
	if due < 0 {
		return 0
	}
	return due
}

// NextPayoutDate is the first cycle not yet fully funded, or nil once closed.
// Funded cycles are CAPPED at what has accrued, so paying in advance can never
// push the date past a cycle that is still unpaid (the arrears-masking bug the
// loan side hit).
func (i *Investment) NextPayoutDate(paid Paise, asOf time.Time) *time.Time {
	if i.Status == InvestmentClosed {
		return nil
	}
	per := i.InterestPerCycle()
	if per <= 0 {
		return nil
	}
	funded := int(paid / per)
	if elapsed := i.CyclesElapsed(asOf); funded > elapsed {
		funded = elapsed
	}
	d := i.CycleDueDate(funded + 1)
	return &d
}

const (
	maxInvestorNameLen  = 120
	maxInvestmentNotes  = 500
	maxPayoutRemarksLen = 300
)

// InvestmentInput is the validated create/update payload.
type InvestmentInput struct {
	InvestorName string
	Mobile       *string
	Email        *string
	Principal    Paise
	Rate         float64
	Frequency    PayoutFrequency
	StartDate    time.Time
	Notes        *string
}

// Validate asserts every field before a write. `now` is injected for testability.
func (in *InvestmentInput) Validate(now time.Time) error {
	fields := map[string]string{}

	name := strings.TrimSpace(in.InvestorName)
	if name == "" {
		fields["investor_name"] = "Investor name is required"
	} else if len([]rune(name)) > maxInvestorNameLen {
		fields["investor_name"] = "Max 120 characters"
	}

	if in.Principal <= 0 {
		fields["principal"] = "Enter an amount greater than 0"
	} else if int64(in.Principal)%100 != 0 {
		fields["principal"] = "Enter a whole rupee amount"
	} else if in.Principal > maxPrincipalPaise {
		fields["principal"] = "Amount is unrealistically large"
	}

	if in.Rate <= 0 {
		fields["rate"] = "Enter a rate greater than 0"
	} else if in.Rate > 100 {
		fields["rate"] = "Rate cannot exceed 100%"
	}

	if !IsValidPayoutFrequency(in.Frequency) {
		fields["frequency"] = "Select monthly or yearly"
	}

	if in.StartDate.IsZero() {
		fields["start_date"] = "Start date is required"
	} else if IsFutureDate(in.StartDate, now) {
		fields["start_date"] = "Start date cannot be in the future"
	}

	// Reuse the SAME validators customers use, so investor contact details are
	// held to the identical standard (10-digit 6-9 mobile, email shape).
	if msg := validateOptionalMobile("Mobile", in.Mobile); msg != "" {
		fields["mobile"] = msg
	}
	if msg := validateEmail(in.Email); msg != "" {
		fields["email"] = msg
	}
	if in.Notes != nil && len([]rune(*in.Notes)) > maxInvestmentNotes {
		fields["notes"] = "Max 500 characters"
	}

	if len(fields) > 0 {
		return NewValidation("Please fix the highlighted fields", fields)
	}
	return nil
}

// InvestorPayout is one interest payment to an investor. ExpenseID links the
// Expenses row created alongside it — that expense is the authoritative cost.
type InvestorPayout struct {
	ID           int64
	InvestmentID int64
	ExpenseID    *int64
	Date         time.Time
	Amount       Paise
	Mode         PayMode
	Remarks      *string
	PostedBy     *int64
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// PayoutInput is the validated payout payload. InvestmentID comes from the URL.
type PayoutInput struct {
	InvestmentID int64
	Amount       Paise
	Date         time.Time
	Mode         PayMode
	Remarks      *string
}

// Validate checks a payout against the investment it belongs to. `paid` is what
// has already been paid out, so the "at most one cycle ahead" ceiling can be
// enforced server-side rather than trusting the client.
func (in *PayoutInput) Validate(inv *Investment, paid Paise, now time.Time) error {
	fields := map[string]string{}

	if in.Amount <= 0 {
		fields["amount"] = "Enter an amount greater than 0"
	} else if int64(in.Amount)%100 != 0 {
		fields["amount"] = "Enter a whole rupee amount"
	} else if in.Amount > maxPrincipalPaise {
		fields["amount"] = "Amount is unrealistically large"
	}

	if !IsValidPayMode(in.Mode) {
		fields["mode"] = "Select a valid payment mode"
	}

	if in.Date.IsZero() {
		fields["date"] = "Payout date is required"
	} else if inv != nil {
		if truncateToDay(in.Date).Before(truncateToDay(inv.StartDate)) {
			fields["date"] = "Payout cannot predate the investment"
		} else if IsFutureDate(in.Date, now) {
			fields["date"] = "Payout date cannot be in the future"
		}
	} else if IsFutureDate(in.Date, now) {
		fields["date"] = "Payout date cannot be in the future"
	}

	// Ceiling: everything accrued but unpaid, PLUS one full cycle in advance.
	// Paying a cycle upfront is legitimate (including on day one), so the bound
	// is never below one cycle.
	if inv != nil && in.Amount > 0 && fields["amount"] == "" {
		ceiling := inv.InterestDue(paid, now) + inv.InterestPerCycle()
		if in.Amount > ceiling {
			fields["amount"] = "More than one cycle ahead of what has accrued"
		}
	}

	if in.Remarks != nil && len([]rune(*in.Remarks)) > maxPayoutRemarksLen {
		fields["remarks"] = "Max 300 characters"
	}

	if len(fields) > 0 {
		return NewValidation("Please fix the highlighted fields", fields)
	}
	return nil
}
