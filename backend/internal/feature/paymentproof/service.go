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
	p, err := s.repo.Create(ctx, customerID, in, domain.SanitizeFileName(fileName), mime, content, submittedBy)
	if isCheckViolation(err) {
		return nil, domain.NewValidation("This upload could not be accepted", nil)
	}
	return p, err
}

// SubmitForAgent stores a payment screenshot for a loan assigned to the agent.
func (s *Service) SubmitForAgent(ctx context.Context, agentID int64, submittedBy *int64,
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
	p, err := s.repo.Create(ctx, customerID, in, domain.SanitizeFileName(fileName), mime, content, submittedBy)
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
func (s *Service) Verify(ctx context.Context, id int64, reviewer *int64) (*domain.PaymentProof, []*domain.Collection, error) {
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
