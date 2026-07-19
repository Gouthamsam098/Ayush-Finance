package domain

import "time"

// LoanType enumerates the six product types. Despite there being six, they
// collapse into three economic behaviours (see IsDailyLoan / IsMonthlyLike).
// This grouping is the core of the money math and must not be flattened.
type LoanType string

const (
	LoanDailyCollection   LoanType = "DAILY_COLLECTION"
	LoanVehicle           LoanType = "VEHICLE"
	LoanProperty          LoanType = "PROPERTY"
	LoanDailyInterest     LoanType = "DAILY_INTEREST"
	LoanMonthlyInterest   LoanType = "MONTHLY_INTEREST"
	LoanFlexible          LoanType = "FLEXIBLE"
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

// dailyCollectionRetainedMonths is how many months of interest a Daily
// Collection loan retains upfront (deduction = months × interest).
const dailyCollectionRetainedMonths = 3

// UpfrontDeduction is the interest retained at disbursement. Daily Collection
// keeps 3 months of interest; other instalment loans keep 1× interest;
// interest-only and Flexible keep nothing. Mirrors the frontend's upfrontDeduction.
func UpfrontDeduction(t LoanType, interest Paise) Paise {
	switch {
	case t == LoanDailyCollection:
		return interest.MulInt(dailyCollectionRetainedMonths)
	case t.IsInstalmentLoan():
		return interest
	default:
		return 0
	}
}

var validLoanTypes = map[LoanType]bool{
	LoanDailyCollection: true, LoanVehicle: true, LoanProperty: true,
	LoanDailyInterest: true, LoanMonthlyInterest: true, LoanFlexible: true,
}

// IsValidLoanType reports whether t is one of the six known types.
func IsValidLoanType(t LoanType) bool { return validLoanTypes[t] }

// IsDailyLoan reports whether the loan collects a fixed instalment every day.
func (t LoanType) IsDailyLoan() bool {
	return t == LoanDailyCollection
}

// IsEmiLoan reports whether the loan is a flat-interest EMI loan (Vehicle,
// Property): full principal disbursed, overall interest added, repaid in equal
// monthly EMIs = (principal + interest) ÷ months.
func (t LoanType) IsEmiLoan() bool {
	return t == LoanVehicle || t == LoanProperty
}

// IsMonthlyLike is retained for callers; EMI loans use a 30-day cadence.
func (t LoanType) IsMonthlyLike() bool { return t.IsEmiLoan() }

// IsInstalmentLoan reports whether the loan uses the upfront-interest instalment
// model (only Daily Collection): interest deducted upfront, fixed daily
// instalments repay the full principal.
func (t LoanType) IsInstalmentLoan() bool {
	return t.IsDailyLoan()
}

// EMI computes the monthly instalment for a flat-interest EMI loan:
// (principal + interest) ÷ months, rounded. Interest is the overall loan
// interest (principal × rate/100), not per month.
func EMI(principal, interest Paise, months int) Paise {
	if months <= 0 {
		return 0
	}
	total := int64(principal.Add(interest))
	m := int64(months)
	return Paise((total + m/2) / m) // rounded to nearest paise
}

// IsInterestOnly reports whether the loan accrues recurring interest while the
// principal stays fixed until separately settled: the customer pays the interest
// amount each cycle, and the principal is closed by a settlement/foreclosure.
// Covers Daily Interest (1-day cycle), Monthly Interest (30-day), and Flexible
// (its own NumDays cycle). Open-ended — no fixed term.
func (t LoanType) IsInterestOnly() bool {
	return t == LoanDailyInterest || t == LoanMonthlyInterest || t == LoanFlexible
}

// interestCadenceDays returns the accrual period for an interest-accruing loan:
// 1 day for Daily Interest, 30 days for Monthly Interest, and the entered NumDays
// for Flexible (interest = principal × rate% recurs every NumDays on the original
// principal until the principal is settled).
func (l *Loan) interestCadenceDays() int {
	if l.Type == LoanDailyInterest {
		return 1
	}
	if l.Type == LoanFlexible && l.NumDays != nil && *l.NumDays > 0 {
		return *l.NumDays
	}
	return standardCycleDays
}

// Loan is the persisted loan entity. Monetary fields are Paise. NumDays,
// DailyAmount, Deduction and the vehicle/optional fields are pointers because
// they are meaningful only for some types and map to nullable columns.
type Loan struct {
	ID          int64
	LoanNumber  string
	CustomerID  int64
	Type        LoanType
	Principal   Paise
	Rate        float64
	Interest    Paise
	Deduction   *Paise
	Disbursed   Paise // net cash given to the borrower = principal − deduction
	DailyAmount *Paise
	NumDays     *int
	LoanDate    time.Time
	NextDueDate *time.Time
	Status      LoanStatus
	Contact     *string
	Remarks     *string
	VehicleNumber *string
	VehicleBrand  *string
	VehicleName   *string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	ClosedAt    *time.Time
}

// cycleDays returns the interest cycle length for this loan. FLEXIBLE uses its
// own NumDays; everything else uses the standard 30-day cycle.
func (l *Loan) cycleDays() int {
	if l.Type == LoanFlexible && l.NumDays != nil && *l.NumDays > 0 {
		return *l.NumDays
	}
	return standardCycleDays
}

// NextDue is the live next-due date, derived from what has actually been paid —
// the single source of truth for "when is the next payment due", replacing the
// static value stored at creation. The rule for scheduled loans:
//
//	fullyPaidInstalments = floor(collected ÷ instalment)
//	nextDue              = loanDate + (fullyPaidInstalments + 1) × step
//
// One formula covers every state: fresh loan → first scheduled day; partial
// payment → due date does not advance; overdue → returns the OLDEST unpaid slot
// (a past date, which is what overdue means); paid ahead → advances past today.
// Interest-accruing loans (Daily/Monthly Interest and Flexible) use the interest
// bucket and their accrual cadence. A CLOSED or fully-collected loan has no next
// due (nil).
func (l *Loan) NextDue(c Collected) *time.Time {
	if l.Status == StatusClosed {
		return nil
	}
	switch {
	case l.Type.IsInterestOnly():
		// Interest accrues per cadence period (1-day / 30-day / Flexible NumDays).
		// The next due is the first not-fully-paid period. Daily/Monthly Interest
		// charge cycle k at loanDate + k·cadence (first due at +cadence). Flexible
		// charges the first cycle on the loan date itself, so its cycles are one
		// step earlier: with `paid` funded, the next falls at loanDate + paid·cadence.
		perPeriod := l.Interest
		if l.DailyAmount != nil {
			perPeriod = *l.DailyAmount
		}
		if perPeriod <= 0 {
			return l.NextDueDate
		}
		paid := int(int64(c.Interest) / int64(perPeriod))
		step := paid + 1
		if l.Type == LoanFlexible {
			step = paid // first cycle due on the loan date (day 0)
		}
		t := addDaysT(l.LoanDate, step*l.interestCadenceDays())
		return &t

	default:
		// Instalment (Daily Collection) / EMI (Vehicle, Property): instalment N
		// is due at loanDate + N·step.
		if l.DailyAmount == nil || *l.DailyAmount <= 0 {
			return l.NextDueDate
		}
		paid := int64(c.Total()) / int64(*l.DailyAmount)
		if l.NumDays != nil && paid >= int64(*l.NumDays) {
			return nil // every instalment collected — nothing further falls due
		}
		step := 1
		if l.Type.IsEmiLoan() {
			step = standardCycleDays
		}
		t := addDaysT(l.LoanDate, int(paid+1)*step)
		return &t
	}
}

// FirstCollectionDate is the earliest date a payment may be recorded. Every
// daily-cadence loan (Daily Collection AND Daily Interest) starts collecting the
// day AFTER disbursement — interest accrues / instalments fall from the next day
// — so their first collection is loanDate + 1. Monthly/EMI/Flexible loans may be
// paid from the loan date onward.
func (l *Loan) FirstCollectionDate() time.Time {
	if l.Type == LoanDailyCollection || l.Type == LoanDailyInterest {
		return addDaysT(l.LoanDate, 1)
	}
	return truncateToDay(l.LoanDate)
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

// TotalDueForDaily is the scheduled shortfall for a DAILY_COLLECTION loan.
// Collection starts the DAY AFTER disbursement, so the expected instalment
// count by `now` is (elapsed − 1), capped at the term. × dailyAmount − collected.
// Measures whether the borrower is on schedule; negative if they have paid ahead.
func (l *Loan) TotalDueForDaily(collected Paise, now time.Time) Paise {
	if l.DailyAmount == nil {
		return 0
	}
	billableDays := ElapsedDaysSinceLoan(l.LoanDate, now) - 1
	if billableDays < 0 {
		billableDays = 0
	}
	if l.NumDays != nil && billableDays > *l.NumDays {
		billableDays = *l.NumDays
	}
	expected := l.DailyAmount.MulInt(int64(billableDays))
	return expected.Sub(collected)
}

// TotalDueForMonthly is the scheduled shortfall for a monthly-cadence instalment
// loan: min(completedCycles, term) × monthly instalment − collected. The
// instalment is DailyAmount (per-month for monthly loans); falls back to
// Interest for legacy rows without an instalment amount.
func (l *Loan) TotalDueForMonthly(collected Paise, now time.Time) Paise {
	cycles := MonthlyCyclesElapsed(l.LoanDate, now, l.cycleDays())
	if l.NumDays != nil && cycles > *l.NumDays {
		cycles = *l.NumDays
	}
	instalment := l.Interest
	if l.DailyAmount != nil {
		instalment = *l.DailyAmount
	}
	due := instalment.MulInt(int64(cycles))
	return due.Sub(collected)
}

// AccruedInterest is the total interest that has accrued on an interest-only
// loan by `now`: periodsElapsed (daily or 30-day, UNCAPPED — the loan runs until
// settled) × interest per period. Interest per period is DailyAmount, falling
// back to Interest for legacy rows.
func (l *Loan) AccruedInterest(now time.Time) Paise {
	cadence := l.interestCadenceDays()
	var periods int
	switch {
	case l.Type == LoanFlexible:
		// Flexible charges the FIRST cycle's interest on the loan date itself
		// (interest starts same day), then one more each NumDays. So the count is
		// completed cycles + 1: day 0 → 1 cycle, day N → 2, day 2N → 3, …
		periods = MonthlyCyclesElapsed(l.LoanDate, now, cadence) + 1
	case cadence == 1:
		// Daily Interest accrues from the DAY AFTER disbursement: 0 on the loan
		// date, 1 the next day. ElapsedDaysSinceLoan counts Day 1 = loan date, so
		// subtract one (matching how Daily Collection's schedule starts next day).
		periods = ElapsedDaysSinceLoan(l.LoanDate, now) - 1
		if periods < 0 {
			periods = 0
		}
	default:
		// Monthly Interest: completed 30-day cycles; interest falls due at cycle end.
		periods = MonthlyCyclesElapsed(l.LoanDate, now, cadence)
	}
	perPeriod := l.Interest
	if l.DailyAmount != nil {
		perPeriod = *l.DailyAmount
	}
	return perPeriod.MulInt(int64(periods))
}

// TotalDueForInterestOnly is the accrued-but-unpaid INTEREST for an
// interest-only loan: accruedInterest − interestPaid. Principal repayments do
// not reduce this (they settle the principal, tracked separately).
func (l *Loan) TotalDueForInterestOnly(interestPaid Paise, now time.Time) Paise {
	return l.AccruedInterest(now).Sub(interestPaid)
}

// RemainingPrincipal is the principal still owed on an interest-only loan:
// principal − principalPaid (never negative). For interest-only loans the
// principal only falls when a PRINCIPAL-kind payment is recorded (settlement).
func (l *Loan) RemainingPrincipal(principalPaid Paise) Paise {
	rem := l.Principal.Sub(principalPaid)
	if rem < 0 {
		return 0
	}
	return rem
}

// Outstanding computes the amount still owed. Mirrors the frontend's
// outstandingFor.
//   - Daily Collection (instalment): interest deducted upfront, only principal
//     payable, shrinking with every collection → principal − collected.
//   - EMI loans (Vehicle/Property): full principal + flat interest, repaid by
//     EMIs → total payable − collected.
//   - Interest-accruing loans (Daily/Monthly Interest, Flexible): principal stays
//     fixed until settled → remaining principal + accrued-but-unpaid interest.
//
// A CLOSED loan owes nothing, except DAILY_COLLECTION where the principal
// genuinely shrinks with collections and the residual is meaningful even after
// closing.
func (l *Loan) Outstanding(c Collected, now time.Time) Paise {
	if l.Type.IsInstalmentLoan() {
		return l.Principal.Sub(c.Total())
	}
	if l.Type.IsEmiLoan() {
		if l.Status == StatusClosed {
			return 0
		}
		return l.Principal.Add(l.Interest).Sub(c.Total())
	}
	// Interest-accruing (Daily/Monthly Interest, Flexible).
	if l.Status == StatusClosed {
		return 0
	}
	// Remaining principal (settled via PRINCIPAL payments) plus any
	// accrued-but-unpaid interest. Interest payments never touch principal.
	interestDue := l.TotalDueForInterestOnly(c.Interest, now)
	if interestDue < 0 {
		interestDue = 0 // paid ahead; surplus interest is not a credit
	}
	return l.RemainingPrincipal(c.Principal).Add(interestDue)
}

// IsFullyPaid reports whether the loan has no remaining balance and should be
// auto-closed. For interest-only loans this means the principal is fully settled
// AND no interest is currently due; for other types, outstanding ≤ 0.
func (l *Loan) IsFullyPaid(c Collected, now time.Time) bool {
	return l.Outstanding(c, now) <= 0
}

// clockSkewToleranceDays is how far ahead of the server's own clock a
// user-entered date may be before it's treated as "in the future". The browser
// and backend can sit in different timezones / drift by up to a day; without
// slack a legitimate today/tomorrow date gets falsely rejected. A genuinely
// future date (beyond this window) is still refused.
const clockSkewToleranceDays = 1

// IsFutureDate reports whether `date` is beyond the acceptable window around the
// server clock `now` — i.e. more than clockSkewToleranceDays ahead. Callers use
// this instead of a bare `date.After(now)` so client/server clock skew doesn't
// block valid entries. Only loosens the check; nothing previously accepted
// becomes rejected.
func IsFutureDate(date, now time.Time) bool {
	latest := truncateToDay(now).AddDate(0, 0, clockSkewToleranceDays)
	return truncateToDay(date).After(latest)
}

// truncateToDay returns the local-time calendar day at midnight. It converts to
// the local zone FIRST so comparisons are day-vs-day in one timezone: a Postgres
// DATE column comes back at UTC midnight, while a parsed input date is at local
// midnight — comparing them without normalising would be off by the UTC offset
// (e.g. IST midnight is "before" UTC midnight of the same date).
func truncateToDay(t time.Time) time.Time {
	lt := t.In(time.Local)
	y, m, d := lt.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.Local)
}
