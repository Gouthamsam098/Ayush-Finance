package paymentproof

import (
	"context"
	"strconv"
	"time"

	"github.com/anush-capitals/lms-backend/internal/audit"
	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/jackc/pgx/v5"
)

// PaymentRecorder is the collection service's accept path: it records the
// proof's money inside the caller's transaction (see collection.RecordSplitTx).
type PaymentRecorder interface {
	RecordSplitTx(ctx context.Context, tx pgx.Tx, loanID int64, amount domain.Paise, date time.Time,
		mode domain.PayMode, remarks string, postedBy *int64, keyPrefix string,
		collector *domain.Collector) ([]*domain.Collection, error)
}

// Auditor records review decisions on the audit trail.
type Auditor interface {
	RecordTx(ctx context.Context, tx pgx.Tx, e audit.Entry) error
	Record(ctx context.Context, e audit.Entry)
}

// Service holds the payment-proof rules: what a borrower may upload, and the
// accept flow that turns a proof into collections atomically.
type Service struct {
	repo     *Repository
	payments PaymentRecorder
	audits   Auditor
}

func NewService(repo *Repository, payments PaymentRecorder, audits Auditor) *Service {
	return &Service{repo: repo, payments: payments, audits: audits}
}

// Submit stores a borrower's screenshot for one of THEIR OWN active loans. The
// file type is decided by its bytes, not the client's claim.
func (s *Service) Submit(ctx context.Context, customerID int64, submittedBy *int64,
	in domain.PaymentProofInput, fileName, declaredMime string, content []byte,
) (*domain.PaymentProof, error) {
	if err := in.Validate(); err != nil {
		return nil, err
	}
	if len(content) == 0 {
		return nil, domain.NewValidation("Choose a screenshot to upload", map[string]string{"file": "Required"})
	}
	if len(content) > domain.MaxPaymentProofBytes {
		return nil, domain.NewValidation("Image must be 5 MB or smaller", map[string]string{"file": "Too large"})
	}
	mime := domain.DetectDocumentMIME(content)
	if !domain.IsAllowedProofMIME(mime) || (declaredMime != "" && declaredMime != mime) {
		return nil, domain.NewValidation("Please upload a screenshot (JPEG, PNG, or WebP)",
			map[string]string{"file": "Unsupported file"})
	}
	status, err := s.repo.LoanStatusForCustomer(ctx, in.LoanID, customerID)
	if err != nil {
		return nil, err
	}
	if status != domain.StatusActive {
		return nil, domain.NewConflict("This loan is closed — no payment is due on it")
	}
	pending, err := s.repo.CountPending(ctx, in.LoanID)
	if err != nil {
		return nil, err
	}
	if pending >= domain.MaxPendingProofsPerLoan {
		return nil, domain.NewConflict("You already have payments awaiting approval on this loan. Please wait for them to be reviewed.")
	}
	p, err := s.repo.Create(ctx, customerID, in, domain.SanitizeFileName(fileName), mime, content, submittedBy, nil)
	if isCheckViolation(err) {
		return nil, domain.NewValidation("This upload could not be accepted", nil)
	}
	return p, err
}

// SubmitForAgent stores a recovery agent's payment screenshot for a loan
// assigned to them. The screenshot is always attached to one of the agent's
// collection claims on that loan — claimID, or else their claim awaiting
// approval — because it is evidence for that claim: the claim records the
// money, the screenshot never does. Without a claim there is nothing to attach
// it to, and an unattached agent screenshot would be a second way to book the
// same payment.
func (s *Service) SubmitForAgent(ctx context.Context, agentID int64, submittedBy *int64,
	in domain.PaymentProofInput, claimID *int64, fileName, declaredMime string, content []byte,
) (*domain.PaymentProof, error) {
	if err := in.Validate(); err != nil {
		return nil, err
	}
	if len(content) == 0 {
		return nil, domain.NewValidation("Choose a screenshot to upload", map[string]string{"file": "Required"})
	}
	if len(content) > domain.MaxPaymentProofBytes {
		return nil, domain.NewValidation("Image must be 5 MB or smaller", map[string]string{"file": "Too large"})
	}
	mime := domain.DetectDocumentMIME(content)
	if !domain.IsAllowedProofMIME(mime) || (declaredMime != "" && declaredMime != mime) {
		return nil, domain.NewValidation("Please upload a screenshot (JPEG, PNG, or WebP)",
			map[string]string{"file": "Unsupported file"})
	}
	customerID, status, err := s.repo.CustomerForAssignedLoan(ctx, in.LoanID, agentID)
	if err != nil {
		return nil, err
	}
	if status != domain.StatusActive {
		return nil, domain.NewConflict("This loan is closed — no payment is due on it")
	}
	pending, err := s.repo.CountPending(ctx, in.LoanID)
	if err != nil {
		return nil, err
	}
	if pending >= domain.MaxPendingProofsPerLoan {
		return nil, domain.NewConflict("This loan already has payments awaiting approval. Please wait for them to be reviewed.")
	}
	if claimID == nil {
		if claimID, err = s.repo.PendingClaimForAgent(ctx, in.LoanID, agentID); err != nil {
			return nil, err
		}
		if claimID == nil {
			return nil, domain.NewConflict("Submit the payment with Collect first — the screenshot is attached to that collection.")
		}
	}
	p, err := s.repo.Create(ctx, customerID, in, domain.SanitizeFileName(fileName), mime, content, submittedBy,
		&ClaimLink{ClaimID: *claimID, AgentID: agentID})
	if isCheckViolation(err) {
		return nil, domain.NewValidation("This upload could not be accepted", nil)
	}
	return p, err
}

// ListForAgent returns proofs on the agent's assigned loans.
func (s *Service) ListForAgent(ctx context.Context, agentID int64) ([]*domain.PaymentProof, error) {
	return s.repo.ListForAgent(ctx, agentID)
}

// ImageForAgent returns a screenshot when the proof is on an assigned loan.
func (s *Service) ImageForAgent(ctx context.Context, agentID, proofID int64) (*domain.PaymentProof, error) {
	ok, err := s.repo.AgentCanAccessProof(ctx, proofID, agentID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.NewNotFound("payment proof")
	}
	return s.repo.Image(ctx, proofID, nil)
}

// List returns proofs; customerID nil = every customer's (staff).
func (s *Service) List(ctx context.Context, customerID *int64) ([]*domain.PaymentProof, error) {
	return s.repo.List(ctx, customerID)
}

// Image returns a proof's screenshot; customerID nil = staff access.
func (s *Service) Image(ctx context.Context, id int64, customerID *int64) (*domain.PaymentProof, error) {
	return s.repo.Image(ctx, id, customerID)
}

// Verify accepts a proof: its amount is recorded as UPI collection(s) dated the
// day the borrower submitted it, and the proof is marked VERIFIED — all in ONE
// transaction, so the money lands exactly once or not at all. Accepting an
// already-accepted proof returns it unchanged (a double-click records nothing).
//
// A recovery agent's screenshot attached to a claim records nothing here: see
// verifyClaimEvidence.
func (s *Service) Verify(ctx context.Context, id int64, reviewer *int64) (*domain.PaymentProof, []*domain.Collection, error) {
	claimID, err := s.repo.ClaimIDOf(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	if claimID != nil {
		p, err := s.verifyClaimEvidence(ctx, id, *claimID, reviewer)
		return p, nil, err
	}

	tx, err := s.repo.Pool().Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	locked, err := s.repo.LockTx(ctx, tx, id)
	if err != nil {
		return nil, nil, err
	}
	p := locked.Proof
	switch p.Status {
	case domain.ProofVerified:
		return p, nil, tx.Commit(ctx)
	case domain.ProofRejected:
		return nil, nil, domain.NewConflict("This payment proof was rejected and cannot be accepted")
	}
	// A recovery agent's screenshot with no claim (uploaded before screenshots
	// were attached to claims) may be the same payment as an agent claim, so it
	// is never booked from here.
	if locked.SubmitterRole == domain.RoleRecoveryAgent {
		return nil, nil, domain.NewConflict("This screenshot was uploaded by a recovery agent and is not attached to a collection. " +
			"Record the agent's payment through the Recovery queue, then reject this screenshot.")
	}

	receiptDate := domain.ProofReceiptDate(p.SubmittedAt, locked.LoanDate)
	key := "proof-" + strconv.FormatInt(p.ID, 10)
	paidBy := &domain.Collector{Type: domain.CollectorCustomer, Name: locked.CustomerName, UserID: locked.SubmittedBy}
	colls, err := s.payments.RecordSplitTx(ctx, tx, p.LoanID, p.Amount, receiptDate, domain.PayUPI,
		"Customer portal UPI payment (proof #"+strconv.FormatInt(p.ID, 10)+")", reviewer, key, paidBy)
	if err != nil {
		return nil, nil, err
	}
	if err := s.repo.MarkVerifiedTx(ctx, tx, p.ID, reviewer, receiptDate); err != nil {
		return nil, nil, err
	}
	if s.audits != nil {
		receipts := make([]string, 0, len(colls))
		for _, c := range colls {
			receipts = append(receipts, c.ReceiptNo)
		}
		if err := s.audits.RecordTx(ctx, tx, audit.Entry{
			EntityType: audit.EntityPaymentProof, EntityID: p.ID, Action: audit.ActionApprove,
			After: map[string]any{
				"loan_id": p.LoanID, "amount": p.Amount.Rupees(),
				"receipt_date": receiptDate.Format("2006-01-02"), "receipts": receipts,
			},
		}); err != nil {
			return nil, nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	out, err := s.repo.FindByID(ctx, p.ID, nil)
	return out, colls, err
}

// verifyClaimEvidence accepts a recovery agent's screenshot attached to a
// claim. It never records money — the claim does. Approving the claim accepts
// its screenshot automatically, so this is only reached for a screenshot sent
// after its claim was approved (e.g. a re-upload of a rejected one): it is
// marked VERIFIED on the claim's receipt date. While the claim is still
// pending the screenshot cannot be accepted here; the claim is reviewed in the
// Recovery queue, and approving it accepts the screenshot with it.
//
// Locks claim → proof, the same order as recovery.Service.Approve.
func (s *Service) verifyClaimEvidence(ctx context.Context, id, claimID int64, reviewer *int64) (*domain.PaymentProof, error) {
	tx, err := s.repo.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	claim, err := s.repo.LockClaimTx(ctx, tx, claimID)
	if err != nil {
		return nil, err
	}
	locked, err := s.repo.LockTx(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	switch locked.Proof.Status {
	case domain.ProofVerified:
		return locked.Proof, tx.Commit(ctx)
	case domain.ProofRejected:
		return nil, domain.NewConflict("This payment proof was rejected and cannot be accepted")
	}
	switch claim.Status {
	case domain.ClaimPending:
		return nil, domain.NewConflict("This screenshot belongs to " + claim.AgentName + "'s collection of " + claim.Amount.INR() +
			", which is awaiting approval. Accept that collection in the Recovery queue — the screenshot is accepted with it and the payment is recorded once.")
	case domain.ClaimRejected:
		return nil, domain.NewConflict("The collection this screenshot belongs to was rejected. Reject the screenshot too.")
	}
	if err := s.repo.MarkVerifiedTx(ctx, tx, id, reviewer, claim.ReceiptDate); err != nil {
		return nil, err
	}
	if s.audits != nil {
		if err := s.audits.RecordTx(ctx, tx, audit.Entry{
			EntityType: audit.EntityPaymentProof, EntityID: id, Action: audit.ActionApprove,
			After: map[string]any{
				"loan_id": locked.Proof.LoanID, "evidence_for_claim": claimID,
				"receipts": []string{}, "note": "screenshot accepted as evidence; the claim recorded the payment",
			},
		}); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.repo.FindByID(ctx, id, nil)
}

// Reject marks a pending proof REJECTED; no money is recorded. Rejecting an
// already-rejected proof is a no-op; an accepted one cannot be rejected (its
// money is on the ledger — reverse it there).
func (s *Service) Reject(ctx context.Context, id int64, reviewer *int64) (*domain.PaymentProof, error) {
	changed, err := s.repo.Reject(ctx, id, reviewer)
	if err != nil {
		return nil, err
	}
	p, err := s.repo.FindByID(ctx, id, nil)
	if err != nil {
		return nil, err
	}
	if !changed {
		if p.Status == domain.ProofVerified {
			return nil, domain.NewConflict("This payment proof was already accepted — its payment is on the ledger")
		}
		return p, nil
	}
	if s.audits != nil {
		s.audits.Record(ctx, audit.Entry{
			EntityType: audit.EntityPaymentProof, EntityID: p.ID, Action: audit.ActionUpdate,
			After: map[string]any{"status": string(domain.ProofRejected), "loan_id": p.LoanID, "amount": p.Amount.Rupees()},
		})
	}
	return p, nil
}
