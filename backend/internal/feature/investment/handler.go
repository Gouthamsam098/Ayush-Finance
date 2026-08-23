package investment

import (
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/anush-capitals/lms-backend/internal/httpx"
	"github.com/go-chi/chi/v5"
)

// Handler exposes investment endpoints: parse/validate input, convert
// wire<->domain, shape responses. No business logic.
type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service: service} }

// Routes mounts under /investments.
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.list)
	r.Post("/", h.create)
	r.Get("/totals", h.totals) // before /{id} so "totals" is not read as an id
	r.Get("/{id}", h.get)
	r.Patch("/{id}", h.update)
	r.Delete("/{id}", h.delete)
	r.Post("/{id}/settle", h.settle)
	r.Post("/{id}/reopen", h.reopen)
	r.Get("/{id}/payouts", h.listPayouts)
	r.Post("/{id}/payouts", h.payInterest)
	r.Delete("/payouts/{payoutId}", h.deletePayout)
	return r
}

// ── wire shapes ──

type investmentRequest struct {
	InvestorName string  `json:"investor_name"`
	Mobile       *string `json:"mobile"`
	Email        *string `json:"email"`
	Principal    float64 `json:"principal"`
	Rate         float64 `json:"rate"`
	Frequency    string  `json:"frequency"`
	StartDate    string  `json:"start_date"`
	Notes        *string `json:"notes"`
}

func (req investmentRequest) toInput() (domain.InvestmentInput, error) {
	in := domain.InvestmentInput{
		InvestorName: req.InvestorName,
		Mobile:       req.Mobile,
		Email:        req.Email,
		Principal:    domain.RupeesToPaise(req.Principal),
		Rate:         req.Rate,
		Frequency:    domain.PayoutFrequency(strings.ToUpper(strings.TrimSpace(req.Frequency))),
		Notes:        req.Notes,
	}
	if s := strings.TrimSpace(req.StartDate); s != "" {
		t, err := time.ParseInLocation("2006-01-02", s, time.Local)
		if err != nil {
			return in, domain.NewValidation("Invalid start date", map[string]string{"start_date": "Use YYYY-MM-DD"})
		}
		in.StartDate = t
	}
	return in, nil
}

type payoutRequest struct {
	Amount  float64 `json:"amount"`
	Date    string  `json:"date"`
	Mode    string  `json:"mode"`
	Remarks *string `json:"remarks"`
}

func (req payoutRequest) toInput() (domain.PayoutInput, error) {
	in := domain.PayoutInput{
		Amount:  domain.RupeesToPaise(req.Amount),
		Mode:    domain.PayMode(strings.ToUpper(strings.TrimSpace(req.Mode))),
		Remarks: req.Remarks,
	}
	if s := strings.TrimSpace(req.Date); s != "" {
		t, err := time.ParseInLocation("2006-01-02", s, time.Local)
		if err != nil {
			return in, domain.NewValidation("Invalid payout date", map[string]string{"date": "Use YYYY-MM-DD"})
		}
		in.Date = t
	}
	return in, nil
}

// investmentResponse is the public snake_case projection. Money is emitted as
// rupees; the derived figures are computed server-side so every client agrees.
type investmentResponse struct {
	ID           int64   `json:"id"`
	Code         string  `json:"code"`
	InvestorName string  `json:"investor_name"`
	Mobile       *string `json:"mobile,omitempty"`
	Email        *string `json:"email,omitempty"`
	Principal    float64 `json:"principal"`
	Rate         float64 `json:"rate"`
	Frequency    string  `json:"frequency"`
	StartDate    string  `json:"start_date"`
	Status       string  `json:"status"`
	SettledDate  *string `json:"settled_date,omitempty"`
	Notes        *string `json:"notes,omitempty"`
	// derived
	InterestPerCycle float64 `json:"interest_per_cycle"`
	AccruedInterest  float64 `json:"accrued_interest"`
	InterestPaid     float64 `json:"interest_paid"`
	InterestDue      float64 `json:"interest_due"`
	CyclesElapsed    int     `json:"cycles_elapsed"`
	NextPayoutDate   *string `json:"next_payout_date,omitempty"`
	CreatedAt        string  `json:"created_at"`
	UpdatedAt        string  `json:"updated_at"`
}

func toResponse(v View) investmentResponse {
	inv := v.Investment
	res := investmentResponse{
		ID: inv.ID, Code: inv.Code, InvestorName: inv.InvestorName,
		Mobile: inv.Mobile, Email: inv.Email,
		Principal: inv.Principal.Rupees(), Rate: inv.Rate,
		Frequency: string(inv.Frequency), StartDate: inv.StartDate.Format("2006-01-02"),
		Status: string(inv.Status), Notes: inv.Notes,
		InterestPerCycle: v.PerCycle.Rupees(),
		AccruedInterest:  v.Accrued.Rupees(),
		InterestPaid:     v.Paid.Rupees(),
		InterestDue:      v.InterestDue.Rupees(),
		CyclesElapsed:    v.Cycles,
		CreatedAt:        inv.CreatedAt.Format(time.RFC3339),
		UpdatedAt:        inv.UpdatedAt.Format(time.RFC3339),
	}
	if inv.SettledDate != nil {
		s := inv.SettledDate.Format("2006-01-02")
		res.SettledDate = &s
	}
	if v.NextPayout != nil {
		s := v.NextPayout.Format("2006-01-02")
		res.NextPayoutDate = &s
	}
	return res
}

type payoutResponse struct {
	ID           int64   `json:"id"`
	InvestmentID int64   `json:"investment_id"`
	ExpenseID    *int64  `json:"expense_id,omitempty"`
	Date         string  `json:"date"`
	Amount       float64 `json:"amount"`
	Mode         string  `json:"mode"`
	Remarks      *string `json:"remarks,omitempty"`
	CreatedAt    string  `json:"created_at"`
}

func toPayoutResponse(p *domain.InvestorPayout) payoutResponse {
	return payoutResponse{
		ID: p.ID, InvestmentID: p.InvestmentID, ExpenseID: p.ExpenseID,
		Date: p.Date.Format("2006-01-02"), Amount: p.Amount.Rupees(),
		Mode: string(p.Mode), Remarks: p.Remarks,
		CreatedAt: p.CreatedAt.Format(time.RFC3339),
	}
}

// ── handlers ──

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page := atoiDefault(q.Get("page"), 1)
	limit := atoiDefault(q.Get("limit"), defaultLimit)
	items, total, err := h.service.List(r.Context(), Page{
		Number: page, Limit: limit,
		Status: strings.ToUpper(strings.TrimSpace(q.Get("status"))),
		Search: strings.TrimSpace(q.Get("search")),
	})
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	out := make([]investmentResponse, 0, len(items))
	for _, v := range items {
		out = append(out, toResponse(v))
	}
	totalPages := int(math.Ceil(float64(total) / float64(max(limit, 1))))
	httpx.List(w, out, httpx.PaginationMeta{
		Page: page, Limit: limit, Total: total, TotalPages: totalPages,
	})
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var req investmentRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	in, err := req.toInput()
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	inv, err := h.service.Create(r.Context(), in)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	v, err := h.service.Get(r.Context(), inv.ID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.Created(w, toResponse(v))
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id", "investment")
	if !ok {
		return
	}
	v, err := h.service.Get(r.Context(), id)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toResponse(v))
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id", "investment")
	if !ok {
		return
	}
	var req investmentRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	in, err := req.toInput()
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	if _, err := h.service.Update(r.Context(), id, in); err != nil {
		httpx.Error(w, r, err)
		return
	}
	v, err := h.service.Get(r.Context(), id)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toResponse(v))
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id", "investment")
	if !ok {
		return
	}
	if err := h.service.Delete(r.Context(), id); err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.NoContent(w)
}

func (h *Handler) settle(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id", "investment")
	if !ok {
		return
	}
	if _, err := h.service.Settle(r.Context(), id); err != nil {
		httpx.Error(w, r, err)
		return
	}
	v, err := h.service.Get(r.Context(), id)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toResponse(v))
}

func (h *Handler) reopen(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id", "investment")
	if !ok {
		return
	}
	if _, err := h.service.Reopen(r.Context(), id); err != nil {
		httpx.Error(w, r, err)
		return
	}
	v, err := h.service.Get(r.Context(), id)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toResponse(v))
}

func (h *Handler) listPayouts(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id", "investment")
	if !ok {
		return
	}
	items, err := h.service.ListPayouts(r.Context(), id)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	out := make([]payoutResponse, 0, len(items))
	for _, p := range items {
		out = append(out, toPayoutResponse(p))
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) payInterest(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id", "investment")
	if !ok {
		return
	}
	var req payoutRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	in, err := req.toInput()
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	in.InvestmentID = id

	var postedBy *int64
	if uid, err := strconv.ParseInt(httpx.UserID(r.Context()), 10, 64); err == nil {
		postedBy = &uid
	}
	p, err := h.service.PayInterest(r.Context(), in, postedBy)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.Created(w, toPayoutResponse(p))
}

func (h *Handler) deletePayout(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "payoutId", "payout")
	if !ok {
		return
	}
	if err := h.service.DeletePayout(r.Context(), id); err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.NoContent(w)
}

func (h *Handler) totals(w http.ResponseWriter, r *http.Request) {
	t, err := h.service.Totals(r.Context())
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"investors":     t.Investors,
		"active_count":  t.ActiveCount,
		"capital":       t.Capital.Rupees(),
		"monthly_outgo": t.MonthlyOutgo.Rupees(),
		"interest_due":  t.InterestDue.Rupees(),
		"interest_paid": t.InterestPaid.Rupees(),
		"overdue_count": t.OverdueCount,
	})
}

// ── helpers ──

func atoiDefault(s string, fallback int) int {
	if s == "" {
		return fallback
	}
	if v, err := strconv.Atoi(s); err == nil {
		return v
	}
	return fallback
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// pathID parses an int64 URL param, writing a NotFound response and returning
// ok=false if it is missing or non-numeric.
func pathID(w http.ResponseWriter, r *http.Request, param, entity string) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, param), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewNotFound(entity))
		return 0, false
	}
	return id, true
}
