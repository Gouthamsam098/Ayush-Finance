package domain

import "time"

// PayMode is how a collection was paid. The DB enforces the same set
// (collections_mode_valid CHECK).
type PayMode string

const (
	PayCash   PayMode = "CASH"
	PayUPI    PayMode = "UPI"
	PayBank   PayMode = "BANK"
	PayCheque PayMode = "CHEQUE"
)

var validPayModes = map[PayMode]bool{
	PayCash: true, PayUPI: true, PayBank: true, PayCheque: true,
}

// IsValidPayMode reports whether m is an accepted payment mode.
func IsValidPayMode(m PayMode) bool { return validPayModes[m] }

// CollectionKind distinguishes an interest payment (income; does not reduce the
// principal) from a principal repayment/settlement (reduces the outstanding
// principal). It only changes behaviour for interest-only loans, where interest
// accrues each period and the principal is settled separately; for every other
// loan type a payment reduces the single balance regardless of kind.
type CollectionKind string

const (
	KindInterest  CollectionKind = "INTEREST"
	KindPrincipal CollectionKind = "PRINCIPAL"
)

var validCollectionKinds = map[CollectionKind]bool{
	KindInterest: true, KindPrincipal: true,
}

// IsValidCollectionKind reports whether k is an accepted collection kind.
func IsValidCollectionKind(k CollectionKind) bool { return validCollectionKinds[k] }

// Collection is a single payment recorded against a loan. Amount is Paise; the
// human-readable RCPT-###### receipt number is minted from a sequence on insert.
// PostedBy links to the operator who recorded it (audit trail); nullable so a
// deleted user doesn't cascade the payment away.
type Collection struct {
	ID        int64
	ReceiptNo string
	LoanID    int64
	Date      time.Time // YYYY-MM-DD, normalised to local midnight
	Amount    Paise
	Mode      PayMode
	Kind      CollectionKind
	Remarks   *string
	// TargetDueDate is the schedule slot the collector explicitly chose to pay
	// (the ledger row whose Add button was clicked). Attribution/display only —
	// never part of balance math. Nil = no explicit target (bulk/clear-overdue/
	// foreclosure/legacy): the ledger falls back to the receipt-date rule.
	TargetDueDate *time.Time
	PostedBy      *int64
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// Collected is the split of a loan's recorded collections. Interest and
// Principal are summed separately so interest-only loans can accrue interest
// while the principal is settled independently. Total() is what non-split loan
// types use.
type Collected struct {
	Interest  Paise
	Principal Paise
}

// Total is the sum of both buckets — the collected figure for loan types that
// don't distinguish interest from principal.
func (c Collected) Total() Paise { return c.Interest.Add(c.Principal) }

// Less returns the tally with one payment of `amount` removed from `kind`'s
// bucket. Used when EDITING a payment: the stored sum still holds the row's old
// amount, so validating a new amount against it would count that payment twice.
// Never returns a negative bucket.
func (c Collected) Less(kind CollectionKind, amount Paise) Collected {
	if kind == KindPrincipal {
		if c.Principal = c.Principal.Sub(amount); c.Principal < 0 {
			c.Principal = 0
		}
		return c
	}
	if c.Interest = c.Interest.Sub(amount); c.Interest < 0 {
		c.Interest = 0
	}
	return c
}

// CollectionInput is the validated create/update payload. LoanID comes from the
// URL, not the body. Amount is Paise. Date is the calendar day the payment was
// received.
type CollectionInput struct {
	LoanID  int64
	Amount  Paise
	Date    time.Time
	Mode    PayMode
	Kind    CollectionKind
	Remarks *string
	// Optional explicit schedule-slot target (see Collection.TargetDueDate).
	TargetDueDate *time.Time
}

const maxCollectionRemarksLen = 300

// Validate checks a collection against the loan it is being recorded for.
// `now` is injected for testability. The loan and its collected split are
// passed so the date can be range-checked against the loan's own timeline:
// a payment may be dated from the loan date THROUGH THE NEXT SCHEDULED DUE
// SLOT — collectors record the slot date being paid, so a daily loan may be
// dated tomorrow and a monthly loan its next cycle date — but never beyond
// it, and never before disbursement. Overpayment is NOT rejected here — that
// is a soft, UI-level warning by design (early settlement / advance payments
// are legitimate); the service only blocks payments on non-ACTIVE loans.
func (in *CollectionInput) Validate(loan *Loan, collected Collected, now time.Time) error {
	fields := map[string]string{}

	if in.Amount <= 0 {
		fields["amount"] = "Enter an amount greater than 0"
	} else if int64(in.Amount)%100 != 0 {
		// Money is whole rupees only, mirroring the loan rules.
		fields["amount"] = "Enter a whole rupee amount"
	} else if in.Amount > maxPrincipalPaise {
		fields["amount"] = "Amount is unrealistically large"
	}

	if !IsValidPayMode(in.Mode) {
		fields["mode"] = "Select a valid payment mode"
	}

	if !IsValidCollectionKind(in.Kind) {
		fields["kind"] = "Select interest or principal"
	} else if in.Kind == KindPrincipal && loan != nil && !loan.behavesInterestOnly() {
		// Only interest-accruing loans (incl. a monthly-mode Vehicle/Property)
		// split interest vs principal; for others a payment is just a payment.
		fields["kind"] = "Principal payments apply only to interest-only loans"
	}

	if in.Date.IsZero() {
		fields["date"] = "Payment date is required"
	} else if loan == nil {
		if IsFutureDate(in.Date, now) {
			fields["date"] = "Payment date cannot be in the future"
		}
	} else {
		// Latest recordable date: the next scheduled due slot (so a daily loan may
		// be dated tomorrow and a monthly loan its next 30-day cycle date), or
		// today + clock-skew tolerance — whichever is later.
		latest := truncateToDay(now).AddDate(0, 0, clockSkewToleranceDays)
		if nd := loan.NextDue(collected); nd != nil && truncateToDay(*nd).After(latest) {
			latest = truncateToDay(*nd)
		}
		if truncateToDay(in.Date).After(latest) {
			fields["date"] = "Payment date cannot be beyond the next due date"
		} else if truncateToDay(in.Date).Before(truncateToDay(loan.LoanDate)) {
			// Earliest: the loan date itself (a same-day foreclosure/settlement is
			// valid). Only a date BEFORE disbursement is rejected. The scheduled
			// instalment/interest timeline still starts the day after — that
			// governs due amounts, not what dates are recordable.
			fields["date"] = "Payment date cannot be before the loan date"
		}
	}

	if in.Remarks != nil && len([]rune(*in.Remarks)) > maxCollectionRemarksLen {
		fields["remarks"] = "Max 300 characters"
	}

	// Hard ceiling for FIXED-DEBT loans only (Daily Collection: interest is
	// deducted upfront, so `principal` is the whole repayable pool). Paying
	// beyond it is not "early settlement" — it is money the borrower does not
	// owe, and it is how a re-keyed collection session pushed two loans to 101
	// payments on a 100-day term.
	//
	// Deliberately NOT applied to interest-only or EMI loans: their debt grows
	// with time (accruing interest), so there is no fixed ceiling to test and a
	// cap would reject legitimate ongoing interest. Advance/early settlement
	// WITHIN the ceiling stays allowed — the existing soft UI warning still
	// covers that case, per this function's contract above.
	if loan != nil && in.Amount > 0 && loan.Type.IsInstalmentLoan() {
		if room := loan.Principal.Sub(collected.Total()); in.Amount > room {
			if room <= 0 {
				fields["amount"] = "This loan is already fully repaid"
			} else {
				fields["amount"] = "Amount exceeds the outstanding balance of " + room.String()
			}
		}
	}

	// Target slot (if supplied) must lie on the loan's timeline: never before
	// disbursement. No upper bound beyond sanity — it is display attribution,
	// not money math, and a valid target can sit anywhere on the schedule.
	if in.TargetDueDate != nil && loan != nil &&
		truncateToDay(*in.TargetDueDate).Before(truncateToDay(loan.LoanDate)) {
		fields["target_due_date"] = "Target day cannot be before the loan date"
	}

	if len(fields) > 0 {
		return NewValidation("Please fix the highlighted fields", fields)
	}
	return nil
}
