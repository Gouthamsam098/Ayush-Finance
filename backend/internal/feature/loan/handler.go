package loan

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

// Handler exposes loan endpoints: parse/validate input, convert wire<->domain,
// shape responses. No business logic.
type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service: service} }

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/", h.create)
	r.Get("/", h.list)
	r.Get("/{id}", h.get)
	r.Patch("/{id}", h.update)
	r.Delete("/{id}", h.delete)
	r.Post("/{id}/close", h.close)
	r.Post("/{id}/reopen", h.reopen)
	return r
}

// loanRequest is the wire shape for create/update. Money arrives as rupees and
// is converted to paise here; the server derives interest/EMI/term/dates.
type loanRequest struct {
	CustomerID    int64    `json:"customer_id"`
	Type          string   `json:"type"`
	Principal     float64  `json:"principal"`
	Rate          float64  `json:"rate"`
	LoanDate      string   `json:"loan_date"` // YYYY-MM-DD
	NumDays       *int     `json:"num_days"`  // EMI months / Flexible days
	Contact       *string  `json:"contact"`
	Remarks       *string  `json:"remarks"`
	VehicleNumber *string  `json:"vehicle_number"`
	VehicleBrand  *string  `json:"vehicle_brand"`
	VehicleName   *string  `json:"vehicle_name"`
}

func (req loanRequest) toInput() (domain.LoanInput, error) {
	in := domain.LoanInput{
		CustomerID:    req.CustomerID,
		Type:          domain.LoanType(strings.TrimSpace(req.Type)),
		Principal:     domain.RupeesToPaise(req.Principal),
		Rate:          req.Rate,
		NumDays:       req.NumDays,
		Contact:       req.Contact,
		Remarks:       req.Remarks,
		VehicleNumber: req.VehicleNumber,
		VehicleBrand:  req.VehicleBrand,
		VehicleName:   req.VehicleName,
	}
	// Parse the local-calendar date string into a local-midnight time.Time,
	// matching the string-based date convention (no UTC shift).
	if s := strings.TrimSpace(req.LoanDate); s != "" {
		t, err := time.ParseInLocation("2006-01-02", s, time.Local)
		if err != nil {
			return in, domain.NewValidation("Invalid loan date", map[string]string{"loan_date": "Use YYYY-MM-DD"})
		}
		in.LoanDate = t
	}
	return in, nil
}

// loanResponse is the public snake_case projection. Money is emitted as rupees.
type loanResponse struct {
	ID            int64    `json:"id"`
	LoanNumber    string   `json:"loan_number"`
	CustomerID    int64    `json:"customer_id"`
	Type          string   `json:"type"`
	Principal     float64  `json:"principal"`
	Rate          float64  `json:"rate"`
	Interest      float64  `json:"interest"`
	Deduction     *float64 `json:"deduction,omitempty"`
	Disbursed     float64  `json:"disbursed_amount"`
	InstalmentAmount *float64 `json:"instalment_amount,omitempty"`
	NumDays       *int     `json:"num_days,omitempty"`
	LoanDate      string   `json:"loan_date"`
	NextDueDate   *string  `json:"next_due_date,omitempty"`
	Status        string   `json:"status"`
	Contact       *string  `json:"contact,omitempty"`
	Remarks       *string  `json:"remarks,omitempty"`
	VehicleNumber *string  `json:"vehicle_number,omitempty"`
	VehicleBrand  *string  `json:"vehicle_brand,omitempty"`
	VehicleName        *string  `json:"vehicle_name,omitempty"`
	Collected          float64  `json:"collected"`
	InterestCollected  float64  `json:"interest_collected"`
	PrincipalCollected float64  `json:"principal_collected"`
	Outstanding        float64  `json:"outstanding"`
	TotalDue           float64  `json:"total_due"`
	CreatedAt          string   `json:"created_at"`
	UpdatedAt          string   `json:"updated_at"`
}

func (h *Handler) toResponse(l *domain.Loan, collected domain.Collected) loanResponse {
	now := h.service.now()
	// Scheduled shortfall by today, per economic behaviour (0 for Flexible).
	// Instalment/EMI loans use the total collected; interest-only uses only the
	// interest bucket (principal payments settle, they don't cover interest due).
	var totalDue domain.Paise
	switch {
	case l.Type.IsInstalmentLoan():
		totalDue = l.TotalDueForDaily(collected.Total(), now)
	case l.Type.IsEmiLoan():
		totalDue = l.TotalDueForMonthly(collected.Total(), now)
	case l.Type.IsInterestOnly():
		totalDue = l.TotalDueForInterestOnly(collected.Interest, now)
	}
	if totalDue < 0 {
		totalDue = 0 // paid ahead of schedule
	}
	resp := loanResponse{
		ID: l.ID, LoanNumber: l.LoanNumber, CustomerID: l.CustomerID, Type: string(l.Type),
		Principal: l.Principal.Rupees(), Rate: l.Rate, Interest: l.Interest.Rupees(),
		Disbursed: l.Disbursed.Rupees(),
		NumDays: l.NumDays, LoanDate: l.LoanDate.Format("2006-01-02"), Status: string(l.Status),
		Contact: l.Contact, Remarks: l.Remarks,
		VehicleNumber: l.VehicleNumber, VehicleBrand: l.VehicleBrand, VehicleName: l.VehicleName,
		// Live figures from the real recorded collections.
		Collected:          collected.Total().Rupees(),
		InterestCollected:  collected.Interest.Rupees(),
		PrincipalCollected: collected.Principal.Rupees(),
		Outstanding:        l.Outstanding(collected, now).Rupees(),
		TotalDue:           totalDue.Rupees(),
		CreatedAt:          l.CreatedAt.Format(time.RFC3339),
		UpdatedAt:          l.UpdatedAt.Format(time.RFC3339),
	}
	if l.Deduction != nil {
		v := l.Deduction.Rupees()
		resp.Deduction = &v
	}
	if l.DailyAmount != nil {
		v := l.DailyAmount.Rupees()
		resp.InstalmentAmount = &v
	}
	// Live next-due derived from actual payments (domain.NextDue) — the stored
	// creation-time value would go stale the moment the first payment lands.
	if nd := l.NextDue(collected); nd != nil {
		s := nd.Format("2006-01-02")
		resp.NextDueDate = &s
	}
	return resp
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	in, err := decode(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	l, err := h.service.Create(r.Context(), in)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	// A brand-new loan has no collections yet.
	httpx.Created(w, h.toResponse(l, domain.Collected{}))
}

// respondLoan fetches the loan's real collected total and writes the DTO. Used
// by every single-loan endpoint so outstanding/due reflect actual payments.
func (h *Handler) respondLoan(w http.ResponseWriter, r *http.Request, l *domain.Loan, status int) {
	collected, err := h.service.Collected(r.Context(), l.ID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, status, h.toResponse(l, collected))
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewNotFound("loan"))
		return
	}
	l, err := h.service.Get(r.Context(), id)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	h.respondLoan(w, r, l, http.StatusOK)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var customerID int64
	if s := strings.TrimSpace(q.Get("customer_id")); s != "" {
		customerID, _ = strconv.ParseInt(s, 10, 64)
	}
	page := Page{
		Number:     atoiDefault(q.Get("page"), 1),
		Limit:      atoiDefault(q.Get("limit"), defaultLimit),
		Search:     strings.TrimSpace(q.Get("search")),
		Type:       strings.TrimSpace(q.Get("type")),
		Status:     strings.TrimSpace(q.Get("status")),
		CustomerID: customerID,
	}.Normalize()

	loans, total, err := h.service.List(r.Context(), page)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	// One batched query for the whole page's collected totals — no N+1.
	collectedBy, err := h.service.CollectedFor(r.Context(), loans)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	items := make([]loanResponse, 0, len(loans))
	for _, l := range loans {
		items = append(items, h.toResponse(l, collectedBy[l.ID]))
	}
	totalPages := int(math.Ceil(float64(total) / float64(page.Limit)))
	httpx.List(w, items, httpx.PaginationMeta{
		Page: page.Number, Limit: page.Limit, Total: total, TotalPages: totalPages,
	})
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	in, err := decode(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewNotFound("loan"))
		return
	}
	l, err := h.service.Update(r.Context(), id, in)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	h.respondLoan(w, r, l, http.StatusOK)
}

func (h *Handler) close(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewNotFound("loan"))
		return
	}
	// Outstanding is computed server-side from the loan's real recorded
	// collections; the close gate lives in the service.
	l, err := h.service.Close(r.Context(), id)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	h.respondLoan(w, r, l, http.StatusOK)
}

func (h *Handler) reopen(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewNotFound("loan"))
		return
	}
	l, err := h.service.Reopen(r.Context(), id)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	h.respondLoan(w, r, l, http.StatusOK)
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewNotFound("loan"))
		return
	}
	if err := h.service.Delete(r.Context(), id); err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.NoContent(w)
}

func decode(r *http.Request) (domain.LoanInput, error) {
	var req loanRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return domain.LoanInput{}, err
	}
	return req.toInput()
}

func atoiDefault(s string, fallback int) int {
	if s == "" {
		return fallback
	}
	if v, err := strconv.Atoi(s); err == nil {
		return v
	}
	return fallback
}

func floatQuery(r *http.Request, key string) float64 {
	if v, err := strconv.ParseFloat(r.URL.Query().Get(key), 64); err == nil {
		return v
	}
	return 0
}
