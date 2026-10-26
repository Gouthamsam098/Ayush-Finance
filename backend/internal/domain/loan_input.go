package domain

import (
	"regexp"
	"strings"
	"time"
)

// LoanInput is the validated, server-side create/update payload for a loan.
// Money is Paise. Rate is a percent. NumDays carries months for EMI loans and
// days for Flexible; it is derived (not trusted) for Daily Collection.
type LoanInput struct {
	CustomerID    int64
	Type          LoanType
	RepaymentMode RepaymentMode // EMI (default) | MONTHLY_INTEREST — only for Vehicle/Property
	Principal     Paise
	Rate          float64
	LoanDate      time.Time
	NumDays       *int // EMI: months; Flexible: days (from client). Ignored for others.
	Contact       *string
	Remarks       *string
	VehicleNumber *string
	VehicleBrand  *string
	VehicleName   *string
}

// isMonthlyInterestEMI reports whether this input is a Vehicle/Property loan
// created in MONTHLY_INTEREST repayment mode (interest-only behaviour). For
// every other type the mode is ignored.
func (in *LoanInput) isMonthlyInterestEMI() bool {
	return in.Type.IsEmiLoan() && in.RepaymentMode == RepayMonthlyInterest
}

// ── Field limits (mirror the frontend's industrial-standard validation) ──
const (
	minPrincipalPaise = 10_000         // ₹100
	maxPrincipalPaise = 10_000_000_000 // ₹10 crore
	maxRatePercent    = 100.0
	maxEmiMonths      = 360  // 30 years
	maxFlexDays       = 3650 // ~10 years
	maxRemarksLen     = 300
	dailyCollectTerm  = 100 // fixed Daily Collection term (days)
)

var (
	mobileRe  = regexp.MustCompile(`^[6-9]\d{9}$`)
	vehicleRe = regexp.MustCompile(`^[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{0,3}[ -]?\d{1,4}$`)
)

// Validate checks every field to industrial standard. `now` is injected so the
// "loan date not in the future" rule is testable. Returns a *Error with the
// per-field map on failure, matching the customer feature's convention.
func (in *LoanInput) Validate(now time.Time) error {
	fields := map[string]string{}

	if in.CustomerID <= 0 {
		fields["customer_id"] = "Select a customer"
	}
	if !IsValidLoanType(in.Type) {
		fields["type"] = "Invalid loan type"
	}
	// Repayment mode: only Vehicle/Property may carry MONTHLY_INTEREST; every
	// other type must be plain EMI (the default). An empty mode is treated as EMI.
	if in.RepaymentMode != "" && !IsValidRepaymentMode(in.RepaymentMode) {
		fields["repayment_mode"] = "Invalid repayment mode"
	} else if in.RepaymentMode == RepayMonthlyInterest && !in.Type.IsEmiLoan() {
		fields["repayment_mode"] = "Monthly interest mode applies only to Vehicle/Property loans"
	}

	// Principal — whole rupees only (no paise): must be an exact multiple of 100 paise.
	if in.Principal < minPrincipalPaise {
		fields["principal"] = "Minimum ₹100"
	} else if in.Principal > maxPrincipalPaise {
		fields["principal"] = "Cannot exceed ₹10 crore"
	} else if int64(in.Principal)%100 != 0 {
		fields["principal"] = "Enter a whole rupee amount"
	} else if in.Type == LoanDailyCollection && int64(in.Principal)%(int64(dailyCollectTerm)*100) != 0 {
		// Daily Collection divides the principal into exactly `dailyCollectTerm`
		// (100) equal instalments: daily = principal / 100. Money columns store
		// WHOLE RUPEES, so a principal that does not divide evenly rounds the
		// instalment up and over-collects across the term — e.g. ₹1,23,456 gives
		// ₹1,234.56/day, stored as ₹1,235, and 100 × ₹1,235 = ₹1,23,500: the
		// borrower repays ₹44 MORE than they borrowed.
		//
		// Requiring a multiple of ₹100 makes the division exact, so the schedule
		// always sums to precisely the principal. Only this type is affected —
		// no other product divides the principal this way.
		fields["principal"] = "Daily Collection principal must be a multiple of ₹100"
	}

	// Rate — up to 2 decimal places (e.g. 0.25, 1.5, 12).
	if in.Rate <= 0 {
		fields["rate"] = "Rate must be greater than 0"
	} else if in.Rate > maxRatePercent {
		fields["rate"] = "Rate cannot exceed 100%"
	} else if !HasAtMostTwoDecimals(in.Rate) {
		fields["rate"] = "Rate can have at most 2 decimals"
	}

	// Tenure — EMI (months) / Flexible (days). Other types (incl. a monthly-
	// interest-mode Vehicle/Property, which is open-ended) derive it server-side.
	switch {
	case in.Type.IsEmiLoan() && !in.isMonthlyInterestEMI():
		if in.NumDays == nil || *in.NumDays < 1 {
			fields["num_days"] = "Tenure is required"
		} else if *in.NumDays > maxEmiMonths {
			fields["num_days"] = "Max 360 months"
		}
	case in.Type == LoanFlexible:
		if in.NumDays == nil || *in.NumDays < 1 {
			fields["num_days"] = "Number of days is required"
		} else if *in.NumDays > maxFlexDays {
			fields["num_days"] = "Max 3650 days"
		}
	}

	// Loan date — required, not in the future, not absurdly old.
	if in.LoanDate.IsZero() {
		fields["loan_date"] = "Loan date is required"
	} else {
		dd := ElapsedDaysSinceLoan(in.LoanDate, now) // Day 1 = loan date; future dates → 0
		if IsFutureDate(in.LoanDate, now) {
			fields["loan_date"] = "Loan date cannot be in the future"
		} else if dd > maxFlexDays {
			fields["loan_date"] = "Date is too far in the past"
		}
	}

	// Contact — optional, but must be a valid Indian mobile if present.
	if in.Contact != nil && strings.TrimSpace(*in.Contact) != "" &&
		!mobileRe.MatchString(strings.TrimSpace(*in.Contact)) {
		fields["contact"] = "Enter a valid 10-digit mobile"
	}

	// Vehicle number — required + format-checked for Vehicle loans.
	if in.Type == LoanVehicle {
		vn := ""
		if in.VehicleNumber != nil {
			vn = strings.ToUpper(strings.TrimSpace(*in.VehicleNumber))
		}
		if vn == "" {
			fields["vehicle_number"] = "Vehicle number is required"
		} else if !vehicleRe.MatchString(vn) {
			fields["vehicle_number"] = "Format e.g. KL-07-AB-1234"
		}
	}

	// Remarks — length-capped.
	if in.Remarks != nil && len(strings.TrimSpace(*in.Remarks)) > maxRemarksLen {
		fields["remarks"] = "Max 300 characters"
	}

	if len(fields) > 0 {
		return NewValidation("Please fix the highlighted fields", fields)
	}
	return nil
}

// DerivedLoan holds the server-computed monetary/schedule fields for a loan.
// The client never dictates these — they are recomputed from principal, rate,
// type and (for EMI/Flexible) the entered tenure.
type DerivedLoan struct {
	Interest    Paise
	Deduction   *Paise     // Daily Collection only (3 months of interest)
	Disbursed   Paise      // net cash given = principal − deduction
	DailyAmount *Paise     // daily instalment / monthly EMI / per-period interest
	NumDays     *int       // 100 (daily), months (EMI), days (flexible), nil (interest-only)
	NextDueDate *time.Time // first due date
}

// Derive computes the authoritative money math + schedule for the input. This
// is the single source of truth on the write path; mirrors the frontend
// preview so the two never disagree.
func (in *LoanInput) Derive() DerivedLoan {
	// Whole rupees FIRST, exactly like the frontend preview's calcInterest
	// (Math.round(principal × rate / 100)), and every other figure is derived
	// from that. Rounding the deduction and the disbursed amount separately from
	// a fractional interest made them disagree by ₹1 — the DB's
	// disbursed = principal − deduction CHECK then refused common Daily
	// Collection loans (₹25,000 @ 1.25%, ₹5,000 @ 2.25%) and many accepted ones
	// stored a disbursed amount ₹1 off the preview. The stored interest itself is
	// unchanged: it was already rounded to whole rupees on write.
	interest := CalcInterest(in.Principal, in.Rate).WholeRupees()
	d := DerivedLoan{Interest: interest}

	switch {
	case in.Type == LoanDailyCollection:
		// Fixed 100-day term; daily = principal ÷ 100; 3 months interest retained.
		term := dailyCollectTerm
		daily := Paise(int64(in.Principal) / int64(term))
		ded := UpfrontDeduction(in.Type, interest)
		next := addDaysT(in.LoanDate, 1) // first collection next day
		d.DailyAmount = &daily
		d.NumDays = &term
		d.Deduction = &ded
		d.NextDueDate = &next

	case in.isMonthlyInterestEMI():
		// Vehicle/Property in monthly-interest mode: behaves like Monthly Interest.
		// Interest = principal × rate% due every 30 days on the original principal;
		// principal fixed until settled; open-ended (no tenure). Per-period interest
		// in DailyAmount; NumDays left nil.
		perPeriod := interest
		next := addDaysT(in.LoanDate, standardCycleDays) // first interest due +30 days
		d.DailyAmount = &perPeriod
		d.NextDueDate = &next

	case in.Type.IsEmiLoan():
		// Full principal disbursed; equal monthly EMIs over the entered months.
		months := valOr(in.NumDays, 0)
		emi := EMI(in.Principal, interest, months)
		next := addDaysT(in.LoanDate, standardCycleDays) // first EMI +30 days
		d.DailyAmount = &emi
		d.NumDays = &months
		d.NextDueDate = &next

	case in.Type == LoanFlexible:
		// Interest-accruing with a custom cycle: interest = principal × rate%
		// recurs every NumDays on the original principal until the principal is
		// settled. The FIRST cycle's interest applies on the loan date itself
		// (interest starts same day), so the first due IS the loan date. Per-period
		// interest stored in DailyAmount; NumDays is the cycle length.
		perPeriod := interest
		days := valOr(in.NumDays, 0)
		next := truncateToDay(in.LoanDate) // first interest due on the loan date
		d.DailyAmount = &perPeriod
		d.NumDays = &days
		d.NextDueDate = &next

	case in.Type.IsInterestOnly():
		// Interest per period = the overall interest figure; open-ended (no term).
		perPeriod := interest
		next := addDaysT(in.LoanDate, in.interestCadenceDays())
		d.DailyAmount = &perPeriod
		d.NextDueDate = &next
	}

	// Net cash disbursed = principal minus any upfront deduction. Only Daily
	// Collection retains interest; every other type disburses the full principal.
	d.Disbursed = in.Principal
	if d.Deduction != nil {
		d.Disbursed = in.Principal.Sub(*d.Deduction)
	}
	return d
}

// TermChanges lists the fields of an edit that would change what an existing
// loan is worth or when it falls due: customer, type, repayment mode (Vehicle/
// Property), principal, rate, loan date and the entered tenure (EMI months /
// Flexible days). Once payments are recorded these are locked — changing them
// re-prices every receipt already on the ledger (outstanding, overdue, profit)
// and can flip the loan's status behind the collector's back. Keys are the
// API's field names, so the form can mark each one.
func (in *LoanInput) TermChanges(l *Loan) []string {
	var out []string
	if in.CustomerID != l.CustomerID {
		out = append(out, "customer_id")
	}
	if in.Type != l.Type {
		out = append(out, "type")
	}
	mode := func(m RepaymentMode) RepaymentMode {
		if m == "" {
			return RepayEMI
		}
		return m
	}
	if in.Type.IsEmiLoan() && mode(in.RepaymentMode) != mode(l.RepaymentMode) {
		out = append(out, "repayment_mode")
	}
	if in.Principal != l.Principal {
		out = append(out, "principal")
	}
	if diff := in.Rate - l.Rate; diff > 1e-9 || diff < -1e-9 {
		out = append(out, "rate")
	}
	if !truncateToDay(in.LoanDate).Equal(truncateToDay(l.LoanDate)) {
		out = append(out, "loan_date")
	}
	if (in.Type.IsEmiLoan() && !in.isMonthlyInterestEMI()) || in.Type == LoanFlexible {
		if valOr(in.NumDays, 0) != valOr(l.NumDays, 0) {
			out = append(out, "num_days")
		}
	}
	return out
}

// StoredTerms returns the loan's money and schedule figures exactly as stored,
// for an edit that changes none of its terms: re-deriving them could move a
// figure by a rupee when the derivation rules have changed since the loan was
// created, silently re-pricing a loan nobody meant to touch.
func (l *Loan) StoredTerms() DerivedLoan {
	return DerivedLoan{
		Interest: l.Interest, Deduction: l.Deduction, Disbursed: l.Disbursed,
		DailyAmount: l.DailyAmount, NumDays: l.NumDays, NextDueDate: l.NextDueDate,
	}
}

// interestCadenceDays for a LoanInput (1 for Daily Interest, 30 for Monthly).
func (in *LoanInput) interestCadenceDays() int {
	if in.Type == LoanDailyInterest {
		return 1
	}
	return standardCycleDays
}

func addDaysT(t time.Time, n int) time.Time { return truncateToDay(t).AddDate(0, 0, n) }

func valOr(p *int, fallback int) int {
	if p == nil {
		return fallback
	}
	return *p
}
