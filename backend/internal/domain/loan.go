package domain

import "time"

// LoanType enumerates the six product types. Despite there being six, they
// collapse into three economic behaviours (see IsDailyLoan / IsMonthlyLike).
// This grouping is the core of the money math and must not be flattened.
type LoanType string

const (
	LoanDailyCollection LoanType = "DAILY_COLLECTION"
	LoanMonthlyInterest LoanType = "MONTHLY_INTEREST"
	LoanDailyInterest   LoanType = "DAILY_INTEREST"
	LoanVehicle         LoanType = "VEHICLE"
	LoanProperty        LoanType = "PROPERTY"
	LoanFlexible        LoanType = "FLEXIBLE"
)

// LoanStatus is the loan lifecycle state.
type LoanStatus string

const (
	StatusActive LoanStatus = "ACTIVE"
	StatusClosed LoanStatus = "CLOSED"
)

// standardCycleDays is the interest cycle length for every monthly-like loan
// except FLEXIBLE, which carries its own term in NumDays.
const standardCycleDays = 30

var validLoanTypes = map[LoanType]bool{
	LoanDailyCollection: true, LoanMonthlyInterest: true, LoanDailyInterest: true,
	LoanVehicle: true, LoanProperty: true, LoanFlexible: true,
}

// IsValidLoanType reports whether t is one of the six known types.
func IsValidLoanType(t LoanType) bool { return validLoanTypes[t] }

// IsDailyLoan reports whether the loan uses the daily-payment model: interest
// deducted upfront, daily instalments repay principal.
func (t LoanType) IsDailyLoan() bool {
	return t == LoanDailyCollection || t == LoanDailyInterest
}

// IsMonthlyLike reports whether the loan uses the recurring interest-cycle
// model (principal fixed, interest accrues each cycle).
func (t LoanType) IsMonthlyLike() bool {
	return t == LoanMonthlyInterest || t == LoanVehicle || t == LoanProperty || t == LoanFlexible
}

// Loan is the persisted loan entity. Monetary fields are Paise. NumDays and
// DailyAmount are pointers because they are meaningful only for some types
// and map to nullable columns.
type Loan struct {
	ID         string
	LoanNumber string
	CustomerID string
	Type       LoanType
	Principal  Paise
	Rate       float64
	Interest   Paise
	Deduction  *Paise
	DailyAmount *Paise
	NumDays    *int
	LoanDate   time.Time
	Status     LoanStatus
}

// cycleDays returns the interest cycle length for this loan. FLEXIBLE uses its
// own NumDays; everything else uses the standard 30-day cycle.
func (l *Loan) cycleDays() int {
	if l.Type == LoanFlexible && l.NumDays != nil && *l.NumDays > 0 {
		return *l.NumDays
	}
	return standardCycleDays
}

// ElapsedDaysSinceLoan returns calendar days elapsed since loanDate, with
// Day 1 = the loan date itself, uncapped. `now` is passed in (not read from
// the clock) so the calculation is pure and testable. Both instants are
// normalised to local midnight to match the frontend's date-string model.
func ElapsedDaysSinceLoan(loanDate, now time.Time) int {
	start := truncateToDay(loanDate)
	today := truncateToDay(now)
	days := int(today.Sub(start).Hours()/24) + 1
	if days < 0 {
		return 0
	}
	return days
}

// MonthlyCyclesElapsed returns the number of completed interest cycles
// (day 30 -> 1, day 59 -> 1, day 60 -> 2).
func MonthlyCyclesElapsed(loanDate, now time.Time, cycleDays int) int {
	if cycleDays <= 0 {
		cycleDays = standardCycleDays
	}
	return ElapsedDaysSinceLoan(loanDate, now) / cycleDays
}

// TotalDueForDaily is the cumulative shortfall for a daily loan:
// min(elapsed, term) × dailyAmount − collected. Can be negative if the
// borrower has paid ahead.
func (l *Loan) TotalDueForDaily(collected Paise, now time.Time) Paise {
	if l.DailyAmount == nil {
		return 0
	}
	elapsed := ElapsedDaysSinceLoan(l.LoanDate, now)
	billableDays := elapsed
	if l.NumDays != nil && elapsed > *l.NumDays {
		billableDays = *l.NumDays
	}
	expected := l.DailyAmount.MulInt(int64(billableDays))
	return expected.Sub(collected)
}

// TotalDueForMonthly is completedCycles × interest − collected.
func (l *Loan) TotalDueForMonthly(collected Paise, now time.Time) Paise {
	cycles := MonthlyCyclesElapsed(l.LoanDate, now, l.cycleDays())
	due := l.Interest.MulInt(int64(cycles))
	return due.Sub(collected)
}

// Outstanding dispatches on the three economic behaviours to compute the
// amount still owed. Mirrors the frontend's outstandingFor. A CLOSED loan
// owes nothing, except DAILY_COLLECTION where the principal genuinely shrinks
// with collections and the residual is meaningful even after closing.
func (l *Loan) Outstanding(collected Paise, now time.Time) Paise {
	if l.Status == StatusClosed && l.Type != LoanDailyCollection {
		return 0
	}

	switch {
	case l.Type == LoanDailyCollection:
		return l.Principal.Sub(collected)
	case l.Type == LoanDailyInterest:
		return l.Principal.Add(l.TotalDueForDaily(collected, now))
	default: // monthly-like
		return l.Principal.Add(l.TotalDueForMonthly(collected, now))
	}
}

func truncateToDay(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}
