package domain

import "time"

// PaymentProofStatus is the review state of a customer's payment screenshot.
// The DB enforces the same set (payment_proofs_status_valid CHECK).
type PaymentProofStatus string

const (
	ProofPending  PaymentProofStatus = "PENDING"
	ProofVerified PaymentProofStatus = "VERIFIED"
	ProofRejected PaymentProofStatus = "REJECTED"
)

// PaymentPurpose is what the borrower chose to pay in the portal. It is shown
// to staff; it does not decide the money split (see SplitPortalPayment).
type PaymentPurpose string

const (
	PurposeInterest       PaymentPurpose = "INTEREST"
	PurposeFullSettlement PaymentPurpose = "FULL_SETTLEMENT"
	PurposeOutstanding    PaymentPurpose = "OUTSTANDING"
	PurposeCustom         PaymentPurpose = "CUSTOM"
)

var validPurposes = map[PaymentPurpose]bool{
	PurposeInterest: true, PurposeFullSettlement: true, PurposeOutstanding: true, PurposeCustom: true,
}

// IsValidPaymentPurpose reports whether p is an accepted portal pay purpose.
func IsValidPaymentPurpose(p PaymentPurpose) bool { return validPurposes[p] }

// MaxPaymentProofBytes caps one screenshot (same limit the portal enforces).
const MaxPaymentProofBytes = MaxDocumentBytes

// MaxPendingProofsPerLoan bounds unreviewed uploads per loan, so a borrower
// cannot fill the database with screenshots before anyone looks at them.
const MaxPendingProofsPerLoan = 5

// IsAllowedProofMIME reports whether a SNIFFED content type is an accepted
// screenshot format. PDFs are documents, not screenshots.
func IsAllowedProofMIME(mime string) bool {
	return mime == "image/jpeg" || mime == "image/png" || mime == "image/webp"
}

// PaymentProof is a borrower-uploaded payment screenshot. Content is loaded
// only when the image itself is requested, never for lists.
type PaymentProof struct {
	ID          int64
	LoanID      int64
	LoanNumber  string
	CustomerID  int64
	Amount      Paise
	Purpose     PaymentPurpose
	FileName    string
	MimeType    string
	SizeBytes   int64
	Content     []byte
	Status      PaymentProofStatus
	SubmittedAt time.Time
	ReviewedAt  *time.Time
	ReceiptDate *time.Time
	// Filled on list reads when joined to users (submitted_by).
	SubmitterName string
	SubmitterRole Role
}

// PaymentProofInput is the borrower's upload, validated before storing.
type PaymentProofInput struct {
	LoanID  int64
	Amount  Paise
	Purpose PaymentPurpose
}

// Validate checks the non-file fields of an upload.
func (in *PaymentProofInput) Validate() error {
	fields := map[string]string{}
	if in.LoanID <= 0 {
		fields["loan_id"] = "Select a loan"
	}
	switch {
	case in.Amount <= 0:
		fields["amount"] = "Enter an amount greater than 0"
	case int64(in.Amount)%100 != 0:
		fields["amount"] = "Enter a whole rupee amount"
	case in.Amount > maxPrincipalPaise:
		fields["amount"] = "Amount is unrealistically large"
	}
	if !IsValidPaymentPurpose(in.Purpose) {
		fields["purpose"] = "Select what this payment is for"
	}
	if len(fields) > 0 {
		return NewValidation("Please fix the highlighted fields", fields)
	}
	return nil
}

// PaymentPart is one collection row an accepted proof becomes.
type PaymentPart struct {
	Kind   CollectionKind
	Amount Paise
}

// SplitPortalPayment decides how an approved portal proof or agent claim is
// recorded, matching what staff do in the ledger:
//
//   - Daily Collection, EMI Vehicle/Property: one INTEREST-kind payment. Kind
//     has no meaning for these loans; the ledger spreads an untargeted payment
//     over the dues it clears, oldest first.
//   - Interest-only behaviour (Daily/Monthly Interest, Flexible, monthly-mode
//     Vehicle/Property), where the kind decides profit and the principal.
//   - Interest-only, FULL balance (amount ≥ outstanding): a settlement — interest
//     due as INTEREST, the rest as PRINCIPAL, like the ledger's "Settle & close".
//   - Interest-only, up to the interest due plus ONE period ahead: an interest
//     payment, like the ledger's default Add. Interest collected a few days
//     before it falls due must stay interest, never shrink the principal.
//   - Interest-only, anything in between: it would repay part of the principal
//     and the borrower's intent can't be inferred, so it is refused (Conflict)
//     and staff record it on the ledger, choosing interest or principal.
//
// The caller has already checked amount ≤ outstanding.
func SplitPortalPayment(l *Loan, collected Collected, amount Paise, now time.Time) ([]PaymentPart, error) {
	if !l.BehavesInterestOnly() {
		return []PaymentPart{{Kind: KindInterest, Amount: amount}}, nil
	}
	interestDue := l.TotalDueForInterestOnly(collected.Interest, now)
	if interestDue < 0 {
		interestDue = 0 // interest paid ahead is not a credit
	}
	if amount >= l.Outstanding(collected, now) {
		parts := make([]PaymentPart, 0, 2)
		ip := interestDue
		if ip > amount {
			ip = amount
		}
		if ip > 0 {
			parts = append(parts, PaymentPart{Kind: KindInterest, Amount: ip})
		}
		if rest := amount.Sub(ip); rest > 0 {
			parts = append(parts, PaymentPart{Kind: KindPrincipal, Amount: rest})
		}
		return parts, nil
	}
	if limit := interestDue.Add(l.InterestPerPeriod()); amount > limit {
		return nil, NewConflict("Part of this payment (" + amount.String() + ") would repay principal: it is more than the interest due (" +
			interestDue.String() + ") plus one period ahead, but less than the full balance. Record it from the loan's ledger, " +
			"choosing interest or principal, then reject this request.")
	}
	return []PaymentPart{{Kind: KindInterest, Amount: amount}}, nil
}

// ProofReceiptDate is the date an accepted proof is recorded on: the day the
// borrower submitted it (they upload right after paying by UPI), never the day
// staff got round to approving it, because a collection is dated when the money
// was received. Clamped to the loan date, since nothing is recordable before
// disbursement.
func ProofReceiptDate(submittedAt, loanDate time.Time) time.Time {
	d := truncateToDay(submittedAt.In(time.Local))
	if ld := truncateToDay(loanDate); d.Before(ld) {
		return ld
	}
	return d
}
