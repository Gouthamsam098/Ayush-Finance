package recovery

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/anush-capitals/lms-backend/internal/httpx"
	"github.com/go-chi/chi/v5"
)

// Handler exposes recovery to staff (/recovery, behind the Collections
// permission; auto-assign settings admin-only) and to agents (/agent, behind
// httpx.RequireRecoveryAgent).
type Handler struct {
	service *Service
	users   httpx.UserLoader
}

func NewHandler(service *Service, users httpx.UserLoader) *Handler {
	return &Handler{service: service, users: users}
}

// StaffRoutes are mounted at /recovery.
func (h *Handler) StaffRoutes() chi.Router {
	r := chi.NewRouter()
	r.Get("/assignments", h.assignments)
	r.Get("/submissions", h.staffSubmissions)
	r.Post("/submissions/{id}/approve", h.approve)
	r.Post("/submissions/{id}/reject", h.reject)
	r.Get("/auto-assign", h.getAutoAssign)
	r.Put("/auto-assign", h.setAutoAssign)
	r.Post("/auto-assign/run", h.runAutoAssign)
	return r
}

// AgentRoutes are mounted at /agent (loans/customers/collections are mounted
// next to these by the router, from their own features).
func (h *Handler) AgentRoutes() chi.Router {
	r := chi.NewRouter()
	r.Get("/submissions", h.agentSubmissions)
	r.Post("/claims", h.submitClaim)
	r.Patch("/claims/{id}", h.updateClaim)
	r.Post("/promises", h.submitPromise)
	r.Post("/promises/{id}/close", h.closePromise)
	return r
}

// ── DTOs ─────────────────────────────────────────────────────────────────────

type submissionResponse struct {
	ID             int64    `json:"id"`
	Type           string   `json:"type"`
	Status         string   `json:"status"`
	LoanID         int64    `json:"loan_id"`
	LoanNumber     string   `json:"loan_number"`
	CustomerID     int64    `json:"customer_id"`
	CustomerName   string   `json:"customer_name"`
	AgentUserID    int64    `json:"agent_user_id"`
	AgentName      string   `json:"agent_name"`
	Amount         *float64 `json:"amount,omitempty"`
	Mode           *string  `json:"mode,omitempty"`
	ReceiptDate    *string  `json:"receipt_date,omitempty"`
	PromiseDate    *string  `json:"promise_date,omitempty"`
	PromisedAmount *float64 `json:"promised_amount,omitempty"`
	Note           *string  `json:"note,omitempty"`
	CreatedAt      string   `json:"created_at"`
	ReviewedAt     *string  `json:"reviewed_at,omitempty"`
	ReviewNote     *string  `json:"review_note,omitempty"`
	Receipts       []string `json:"receipts,omitempty"`
	// UPI claims: the UPI ID it was paid to (from Settings, stamped on filing).
	PayeeVPA  *string `json:"payee_vpa,omitempty"`
	PayeeName *string `json:"payee_name,omitempty"`
	// When the agent last edited the pending claim.
	EditedAt *string `json:"edited_at,omitempty"`
}

func dateStr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format("2006-01-02")
	return &s
}

func toResponse(s *domain.RecoverySubmission) submissionResponse {
	out := submissionResponse{
		ID: s.ID, Type: string(s.Type), Status: s.Status, LoanID: s.LoanID, LoanNumber: s.LoanNumber,
		CustomerID: s.CustomerID, CustomerName: s.CustomerName, AgentUserID: s.AgentUserID, AgentName: s.AgentName,
		ReceiptDate: dateStr(s.ReceiptDate), PromiseDate: dateStr(s.PromiseDate), Note: s.Note,
		CreatedAt: s.CreatedAt.Format(time.RFC3339), ReviewNote: s.ReviewNote,
	}
	if s.Amount != nil {
		v := s.Amount.Rupees()
		out.Amount = &v
	}
	if s.PromisedAmount != nil {
		v := s.PromisedAmount.Rupees()
		out.PromisedAmount = &v
	}
	if s.Mode != nil {
		m := string(*s.Mode)
		out.Mode = &m
	}
	if s.ReviewedAt != nil {
		v := s.ReviewedAt.Format(time.RFC3339)
		out.ReviewedAt = &v
	}
	out.PayeeVPA, out.PayeeName = s.PayeeVPA, s.PayeeName
	if s.EditedAt != nil {
		v := s.EditedAt.Format(time.RFC3339)
		out.EditedAt = &v
	}
	return out
}

func writeSubmissions(w http.ResponseWriter, items []*domain.RecoverySubmission) {
	out := make([]submissionResponse, 0, len(items))
	for _, s := range items {
		out = append(out, toResponse(s))
	}
	httpx.JSON(w, http.StatusOK, out)
}

// ── helpers ──────────────────────────────────────────────────────────────────

func callerID(r *http.Request) *int64 {
	if id, err := strconv.ParseInt(httpx.UserID(r.Context()), 10, 64); err == nil {
		return &id
	}
	return nil
}

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewNotFound("submission"))
		return 0, false
	}
	return id, true
}

func agentID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, ok := httpx.AgentUserID(r.Context())
	if !ok {
		httpx.Error(w, r, domain.NewForbidden("recovery agent access only"))
	}
	return id, ok
}

// requireAdmin guards the auto-assign settings, which live in Settings (admin).
func (h *Handler) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	id := callerID(r)
	if id == nil {
		httpx.Error(w, r, domain.NewUnauthorized("invalid or expired token"))
		return false
	}
	u, err := h.users(r.Context(), *id)
	if err != nil {
		httpx.Error(w, r, domain.NewUnauthorized("invalid or expired token"))
		return false
	}
	if !u.IsAdmin() {
		httpx.Error(w, r, domain.NewForbidden("admin access required"))
		return false
	}
	return true
}

func parseDate(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, true
	}
	t, err := time.ParseInLocation("2006-01-02", s, time.Local)
	return t, err == nil
}

// ── staff ────────────────────────────────────────────────────────────────────

type agentDTO struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Email    string `json:"email"`
	IsActive bool   `json:"is_active"`
}

type assignmentDTO struct {
	LoanID      int64  `json:"loan_id"`
	AgentUserID int64  `json:"agent_user_id"`
	Source      string `json:"source"`
}

func (h *Handler) assignments(w http.ResponseWriter, r *http.Request) {
	agents, err := h.service.Agents(r.Context())
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	rows, err := h.service.Assignments(r.Context())
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	out := struct {
		Agents      []agentDTO      `json:"agents"`
		Assignments []assignmentDTO `json:"assignments"`
	}{Agents: []agentDTO{}, Assignments: []assignmentDTO{}}
	for _, a := range agents {
		out.Agents = append(out.Agents, agentDTO{ID: a.ID, Name: a.Name, Email: a.Email, IsActive: a.IsActive})
	}
	for _, a := range rows {
		out.Assignments = append(out.Assignments, assignmentDTO{LoanID: a.LoanID, AgentUserID: a.AgentID, Source: a.Source})
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) staffSubmissions(w http.ResponseWriter, r *http.Request) {
	items, err := h.service.Submissions(r.Context(), nil)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	writeSubmissions(w, items)
}

func (h *Handler) approve(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	// What the reviewer saw (optional): the claim is approved only if it still
	// says exactly that — an agent's edit after the review must be looked at.
	var req struct {
		ExpectedAmount      *float64 `json:"expected_amount"`
		ExpectedReceiptDate *string  `json:"expected_receipt_date"`
		ExpectedMode        *string  `json:"expected_mode"`
	}
	if r.ContentLength != 0 {
		if err := httpx.DecodeJSON(r, &req); err != nil {
			httpx.Error(w, r, err)
			return
		}
	}
	var seen *ReviewedClaim
	if req.ExpectedAmount != nil && req.ExpectedReceiptDate != nil && req.ExpectedMode != nil {
		seen = &ReviewedClaim{Amount: domain.RupeesToPaise(*req.ExpectedAmount),
			ReceiptDate: *req.ExpectedReceiptDate, Mode: domain.PayMode(*req.ExpectedMode)}
	}
	sub, colls, err := h.service.Approve(r.Context(), id, callerID(r), seen)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	resp := toResponse(sub)
	for _, c := range colls {
		resp.Receipts = append(resp.Receipts, c.ReceiptNo)
	}
	httpx.JSON(w, http.StatusOK, resp)
}

func (h *Handler) reject(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if r.ContentLength != 0 {
		if err := httpx.DecodeJSON(r, &req); err != nil {
			httpx.Error(w, r, err)
			return
		}
	}
	sub, err := h.service.Reject(r.Context(), id, callerID(r), req.Reason)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toResponse(sub))
}

type scheduleDTO struct {
	RunTime     *string        `json:"run_time"`
	LastRunSlot *string        `json:"last_run_slot,omitempty"`
	LastRunAt   *string        `json:"last_run_at,omitempty"`
	LastResult  map[string]any `json:"last_result,omitempty"`
	NextRunAt   string         `json:"next_run_at"`
}

func (h *Handler) writeSchedule(w http.ResponseWriter, r *http.Request) {
	s, err := h.service.Schedule(r.Context())
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	out := scheduleDTO{RunTime: s.RunTime, LastRunSlot: s.LastRunSlot, LastResult: s.LastResult,
		NextRunAt: NextRun(time.Now(), s.RunTime).Format(time.RFC3339)}
	if s.LastRunAt != nil {
		v := s.LastRunAt.Format(time.RFC3339)
		out.LastRunAt = &v
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) getAutoAssign(w http.ResponseWriter, r *http.Request) { h.writeSchedule(w, r) }

func (h *Handler) setAutoAssign(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	var req struct {
		RunTime *string `json:"run_time"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	if req.RunTime != nil && strings.TrimSpace(*req.RunTime) == "" {
		req.RunTime = nil
	}
	if err := h.service.SetSchedule(r.Context(), req.RunTime, callerID(r)); err != nil {
		httpx.Error(w, r, err)
		return
	}
	h.writeSchedule(w, r)
}

func (h *Handler) runAutoAssign(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	res, err := h.service.AutoAssign(r.Context(), true)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}

// ── agent ────────────────────────────────────────────────────────────────────

func (h *Handler) agentSubmissions(w http.ResponseWriter, r *http.Request) {
	aid, ok := agentID(w, r)
	if !ok {
		return
	}
	items, err := h.service.Submissions(r.Context(), &aid)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	writeSubmissions(w, items)
}

type claimRequest struct {
	LoanID      int64   `json:"loan_id"`
	Amount      float64 `json:"amount"`
	Mode        string  `json:"mode"`
	ReceiptDate string  `json:"receipt_date"`
	Note        *string `json:"note"`
}

func (req claimRequest) toInput() (domain.ClaimInput, error) {
	d, ok := parseDate(req.ReceiptDate)
	if !ok {
		return domain.ClaimInput{}, domain.NewValidation("Please fix the highlighted fields",
			map[string]string{"receipt_date": "Use YYYY-MM-DD"})
	}
	return domain.ClaimInput{
		LoanID: req.LoanID, Amount: domain.RupeesToPaise(req.Amount),
		Mode: domain.PayMode(strings.TrimSpace(req.Mode)), ReceiptDate: d, Note: req.Note,
	}, nil
}

func (h *Handler) submitClaim(w http.ResponseWriter, r *http.Request) {
	aid, ok := agentID(w, r)
	if !ok {
		return
	}
	var req claimRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	in, err := req.toInput()
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	sub, err := h.service.SubmitClaim(r.Context(), aid, in)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.Created(w, toResponse(sub))
}

func (h *Handler) updateClaim(w http.ResponseWriter, r *http.Request) {
	aid, ok := agentID(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req claimRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	in, err := req.toInput()
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	sub, err := h.service.UpdateClaim(r.Context(), id, aid, in)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toResponse(sub))
}

func (h *Handler) submitPromise(w http.ResponseWriter, r *http.Request) {
	aid, ok := agentID(w, r)
	if !ok {
		return
	}
	var req struct {
		LoanID         int64    `json:"loan_id"`
		PromiseDate    string   `json:"promise_date"`
		PromisedAmount *float64 `json:"promised_amount"`
		Note           *string  `json:"note"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	d, ok := parseDate(req.PromiseDate)
	if !ok {
		httpx.Error(w, r, domain.NewValidation("Please fix the highlighted fields",
			map[string]string{"promise_date": "Use YYYY-MM-DD"}))
		return
	}
	in := domain.PromiseInput{LoanID: req.LoanID, PromiseDate: d, Note: req.Note}
	if req.PromisedAmount != nil {
		p := domain.RupeesToPaise(*req.PromisedAmount)
		in.PromisedAmount = &p
	}
	sub, err := h.service.SubmitPromise(r.Context(), aid, in)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.Created(w, toResponse(sub))
}

// closePromise: POST /agent/promises/{id}/close {"status": "FULFILLED"|"CANCELLED"}.
func (h *Handler) closePromise(w http.ResponseWriter, r *http.Request) {
	aid, ok := agentID(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req struct {
		Status string `json:"status"`
	}
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	sub, err := h.service.ClosePromise(r.Context(), id, aid, strings.TrimSpace(req.Status))
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toResponse(sub))
}
