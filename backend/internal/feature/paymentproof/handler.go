package paymentproof

import (
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/anush-capitals/lms-backend/internal/httpx"
	"github.com/go-chi/chi/v5"
)

// Handler exposes payment proofs to borrowers (/portal/payment-proofs, own
// proofs only) and to staff (/payment-proofs, behind the Collections permission).
type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service: service} }

// PortalRoutes are mounted behind httpx.RequireCustomer.
func (h *Handler) PortalRoutes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.portalList)
	r.Post("/", h.portalSubmit)
	r.Get("/{id}/image", h.portalImage)
	return r
}

// AgentRoutes are mounted at /agent/payment-proofs behind RequireRecoveryAgent.
func (h *Handler) AgentRoutes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.agentList)
	r.Post("/", h.agentSubmit)
	r.Get("/{id}/image", h.agentImage)
	return r
}

// StaffRoutes are mounted behind RequirePermission("Collections"): reads need
// view, accept/reject (POST) need edit — the same right as recording a payment.
func (h *Handler) StaffRoutes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.staffList)
	r.Get("/{id}/image", h.staffImage)
	r.Post("/{id}/verify", h.verify)
	r.Post("/{id}/reject", h.reject)
	return r
}

type proofResponse struct {
	ID          int64   `json:"id"`
	LoanID      int64   `json:"loan_id"`
	LoanNumber  string  `json:"loan_number"`
	CustomerID  int64   `json:"customer_id"`
	Amount      float64 `json:"amount"`
	Purpose     string  `json:"purpose"`
	FileName    string  `json:"file_name"`
	MimeType    string  `json:"mime_type"`
	SizeBytes   int64   `json:"size_bytes"`
	Status      string  `json:"status"`
	SubmittedAt string  `json:"submitted_at"`
	ReviewedAt  *string `json:"reviewed_at,omitempty"`
	ReceiptDate *string `json:"receipt_date,omitempty"`
	// Receipts lists the collection receipt numbers created by an accept.
	Receipts []string `json:"receipts,omitempty"`
	// Present when a recovery agent uploaded from /agent/payment-proofs.
	RecoveryAgentName *string `json:"recovery_agent_name,omitempty"`
	// Present when the screenshot is a recovery agent's evidence for a claim:
	// the claim records the money, never the screenshot.
	ClaimID     *int64  `json:"claim_id,omitempty"`
	ClaimStatus *string `json:"claim_status,omitempty"`
}

func toResponse(p *domain.PaymentProof) proofResponse {
	resp := proofResponse{
		ID: p.ID, LoanID: p.LoanID, LoanNumber: p.LoanNumber, CustomerID: p.CustomerID,
		Amount: p.Amount.Rupees(), Purpose: string(p.Purpose), FileName: p.FileName,
		MimeType: p.MimeType, SizeBytes: p.SizeBytes, Status: string(p.Status),
		SubmittedAt: p.SubmittedAt.Format(time.RFC3339),
	}
	if p.ReviewedAt != nil {
		s := p.ReviewedAt.Format(time.RFC3339)
		resp.ReviewedAt = &s
	}
	if p.ReceiptDate != nil {
		s := p.ReceiptDate.Format("2006-01-02")
		resp.ReceiptDate = &s
	}
	if p.SubmitterRole == domain.RoleRecoveryAgent && p.SubmitterName != "" {
		resp.RecoveryAgentName = &p.SubmitterName
	}
	if p.ClaimID != nil {
		resp.ClaimID = p.ClaimID
		status := p.ClaimStatus
		resp.ClaimStatus = &status
	}
	return resp
}

func writeList(w http.ResponseWriter, items []*domain.PaymentProof) {
	out := make([]proofResponse, 0, len(items))
	for _, p := range items {
		out = append(out, toResponse(p))
	}
	httpx.JSON(w, http.StatusOK, out)
}

func callerID(r *http.Request) *int64 {
	if id, err := strconv.ParseInt(httpx.UserID(r.Context()), 10, 64); err == nil {
		return &id
	}
	return nil
}

func proofID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewNotFound("payment proof"))
		return 0, false
	}
	return id, true
}

func portalCustomer(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, ok := httpx.PortalCustomerID(r.Context())
	if !ok {
		httpx.Error(w, r, domain.NewForbidden("customer portal access only"))
	}
	return id, ok
}

func (h *Handler) portalList(w http.ResponseWriter, r *http.Request) {
	customerID, ok := portalCustomer(w, r)
	if !ok {
		return
	}
	items, err := h.service.List(r.Context(), &customerID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	writeList(w, items)
}

// portalSubmit takes multipart fields file, loan_id, amount (rupees), purpose.
func (h *Handler) portalSubmit(w http.ResponseWriter, r *http.Request) {
	customerID, ok := portalCustomer(w, r)
	if !ok {
		return
	}
	// Cap the body before parsing so an oversized upload cannot exhaust memory.
	r.Body = http.MaxBytesReader(w, r.Body, domain.MaxPaymentProofBytes+(1<<20))
	if err := r.ParseMultipartForm(domain.MaxPaymentProofBytes + (1 << 20)); err != nil {
		httpx.Error(w, r, domain.NewValidation("Image must be 5 MB or smaller", map[string]string{"file": "Too large"}))
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		httpx.Error(w, r, domain.NewValidation("Choose a screenshot to upload", map[string]string{"file": "Required"}))
		return
	}
	defer file.Close()
	content, err := io.ReadAll(file)
	if err != nil {
		httpx.Error(w, r, domain.NewValidation("Could not read the uploaded file", nil))
		return
	}

	loanID, _ := strconv.ParseInt(strings.TrimSpace(r.FormValue("loan_id")), 10, 64)
	amount, err := strconv.ParseFloat(strings.TrimSpace(r.FormValue("amount")), 64)
	if err != nil {
		amount = 0 // reported by validation as "greater than 0"
	}
	in := domain.PaymentProofInput{
		LoanID:  loanID,
		Amount:  domain.RupeesToPaise(amount),
		Purpose: domain.PaymentPurpose(strings.TrimSpace(r.FormValue("purpose"))),
	}
	p, err := h.service.Submit(r.Context(), customerID, callerID(r), in,
		header.Filename, header.Header.Get("Content-Type"), content)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.Created(w, toResponse(p))
}

func agentID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, ok := httpx.AgentUserID(r.Context())
	if !ok {
		httpx.Error(w, r, domain.NewForbidden("recovery agent access only"))
		return 0, false
	}
	return id, true
}

func (h *Handler) agentList(w http.ResponseWriter, r *http.Request) {
	aid, ok := agentID(w, r)
	if !ok {
		return
	}
	items, err := h.service.ListForAgent(r.Context(), aid)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	writeList(w, items)
}

func (h *Handler) agentSubmit(w http.ResponseWriter, r *http.Request) {
	aid, ok := agentID(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, domain.MaxPaymentProofBytes+(1<<20))
	if err := r.ParseMultipartForm(domain.MaxPaymentProofBytes + (1 << 20)); err != nil {
		httpx.Error(w, r, domain.NewValidation("Image must be 5 MB or smaller", map[string]string{"file": "Too large"}))
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		httpx.Error(w, r, domain.NewValidation("Choose a screenshot to upload", map[string]string{"file": "Required"}))
		return
	}
	defer file.Close()
	content, err := io.ReadAll(file)
	if err != nil {
		httpx.Error(w, r, domain.NewValidation("Could not read the uploaded file", nil))
		return
	}
	loanID, _ := strconv.ParseInt(strings.TrimSpace(r.FormValue("loan_id")), 10, 64)
	amount, err := strconv.ParseFloat(strings.TrimSpace(r.FormValue("amount")), 64)
	if err != nil {
		amount = 0
	}
	in := domain.PaymentProofInput{
		LoanID:  loanID,
		Amount:  domain.RupeesToPaise(amount),
		Purpose: domain.PaymentPurpose(strings.TrimSpace(r.FormValue("purpose"))),
	}
	// claim_id: the agent's collection this screenshot proves. Optional — when
	// absent the server uses the agent's claim awaiting approval on the loan.
	var claimID *int64
	if raw := strings.TrimSpace(r.FormValue("claim_id")); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || id <= 0 {
			httpx.Error(w, r, domain.NewValidation("Please fix the highlighted fields",
				map[string]string{"claim_id": "Invalid collection"}))
			return
		}
		claimID = &id
	}
	p, err := h.service.SubmitForAgent(r.Context(), aid, &aid, in, claimID,
		header.Filename, header.Header.Get("Content-Type"), content)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.Created(w, toResponse(p))
}

func (h *Handler) agentImage(w http.ResponseWriter, r *http.Request) {
	aid, ok := agentID(w, r)
	if !ok {
		return
	}
	id, ok := proofID(w, r)
	if !ok {
		return
	}
	p, err := h.service.ImageForAgent(r.Context(), aid, id)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	w.Header().Set("Content-Type", p.MimeType)
	w.Header().Set("Content-Length", strconv.Itoa(len(p.Content)))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Disposition", `inline; filename="`+domain.SanitizeFileName(p.FileName)+`"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(p.Content)
}

func (h *Handler) portalImage(w http.ResponseWriter, r *http.Request) {
	customerID, ok := portalCustomer(w, r)
	if !ok {
		return
	}
	h.writeImage(w, r, &customerID)
}

func (h *Handler) staffList(w http.ResponseWriter, r *http.Request) {
	items, err := h.service.List(r.Context(), nil)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	writeList(w, items)
}

func (h *Handler) staffImage(w http.ResponseWriter, r *http.Request) { h.writeImage(w, r, nil) }

func (h *Handler) writeImage(w http.ResponseWriter, r *http.Request, customerID *int64) {
	id, ok := proofID(w, r)
	if !ok {
		return
	}
	p, err := h.service.Image(r.Context(), id, customerID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	// Stored type was sniffed from the bytes on upload; nosniff stops the browser
	// second-guessing it, and the image is private, so never cache it shared.
	w.Header().Set("Content-Type", p.MimeType)
	w.Header().Set("Content-Length", strconv.Itoa(len(p.Content)))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Disposition", `inline; filename="`+domain.SanitizeFileName(p.FileName)+`"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(p.Content)
}

func (h *Handler) verify(w http.ResponseWriter, r *http.Request) {
	id, ok := proofID(w, r)
	if !ok {
		return
	}
	p, colls, err := h.service.Verify(r.Context(), id, callerID(r))
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	resp := toResponse(p)
	for _, c := range colls {
		resp.Receipts = append(resp.Receipts, c.ReceiptNo)
	}
	httpx.JSON(w, http.StatusOK, resp)
}

func (h *Handler) reject(w http.ResponseWriter, r *http.Request) {
	id, ok := proofID(w, r)
	if !ok {
		return
	}
	p, err := h.service.Reject(r.Context(), id, callerID(r))
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toResponse(p))
}
