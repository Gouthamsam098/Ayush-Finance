package expense

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

// Handler exposes expense endpoints: parse/validate input, convert wire<->domain,
// shape responses. No business logic.
type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service: service} }

// Routes mounts under /expenses — full flat CRUD.
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/", h.create)
	r.Get("/", h.list)
	r.Get("/{id}", h.get)
	r.Patch("/{id}", h.update)
	r.Delete("/{id}", h.delete)
	return r
}

// expenseRequest is the wire shape for create/update. Every field is a pointer
// so a PATCH can send only what changed: an absent field is left unset in the
// resulting ExpensePatch and the service preserves the stored value. Amount
// arrives as rupees and is converted to Paise. Create still validates the full
// entity, so a create that omits required fields is rejected as before.
type expenseRequest struct {
	Category    *string  `json:"category"`
	SubCategory *string  `json:"sub_category"`
	Name        *string  `json:"name"`
	Amount      *float64 `json:"amount"`
	Mode        *string  `json:"mode"`
	Date        *string  `json:"date"` // YYYY-MM-DD
	Remarks     *string  `json:"remarks"`
}

func (req expenseRequest) toPatch() (domain.ExpensePatch, error) {
	p := domain.ExpensePatch{SubCategory: req.SubCategory, Remarks: req.Remarks}
	if req.Category != nil {
		c := domain.ExpenseCategory(strings.TrimSpace(*req.Category))
		p.Category = &c
	}
	if req.Name != nil {
		n := strings.TrimSpace(*req.Name)
		p.Name = &n
	}
	if req.Amount != nil {
		a := domain.RupeesToPaise(*req.Amount)
		p.Amount = &a
	}
	if req.Mode != nil {
		m := domain.PayMode(strings.TrimSpace(*req.Mode))
		p.Mode = &m
	}
	if req.Date != nil {
		if s := strings.TrimSpace(*req.Date); s != "" {
			t, err := time.ParseInLocation("2006-01-02", s, time.Local)
			if err != nil {
				return p, domain.NewValidation("Invalid expense date", map[string]string{"date": "Use YYYY-MM-DD"})
			}
			p.Date = &t
		}
	}
	// SubCategory / Remarks: presence itself is the signal (they're already
	// pointers on the wire), so an explicit null clears them and an omitted key
	// leaves them untouched — distinguished by the field being nil vs set.
	p.SubCategorySet = req.SubCategory != nil
	p.RemarksSet = req.Remarks != nil
	return p, nil
}

// expenseResponse is the public snake_case projection. Money is emitted as rupees.
type expenseResponse struct {
	ID          int64   `json:"id"`
	Category    string  `json:"category"`
	SubCategory *string `json:"sub_category,omitempty"`
	Name        string  `json:"name"`
	Amount      float64 `json:"amount"`
	Mode        string  `json:"mode"`
	Date        string  `json:"date"`
	Remarks     *string `json:"remarks,omitempty"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
}

func toResponse(e *domain.Expense) expenseResponse {
	return expenseResponse{
		ID: e.ID, Category: string(e.Category), SubCategory: e.SubCategory, Name: e.Name,
		Amount: e.Amount.Rupees(), Mode: string(e.Mode), Date: e.Date.Format("2006-01-02"),
		Remarks:   e.Remarks,
		CreatedAt: e.CreatedAt.Format(time.RFC3339), UpdatedAt: e.UpdatedAt.Format(time.RFC3339),
	}
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	patch, err := decode(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	e, err := h.service.Create(r.Context(), patch.ToInput())
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.Created(w, toResponse(e))
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page := Page{
		Number:   atoiDefault(q.Get("page"), 1),
		Limit:    atoiDefault(q.Get("limit"), defaultLimit),
		Search:   strings.TrimSpace(q.Get("search")),
		Category: strings.TrimSpace(q.Get("category")),
		From:     strings.TrimSpace(q.Get("from")),
		To:       strings.TrimSpace(q.Get("to")),
	}.Normalize()

	items, total, err := h.service.List(r.Context(), page)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	out := make([]expenseResponse, 0, len(items))
	for _, e := range items {
		out = append(out, toResponse(e))
	}
	totalPages := int(math.Ceil(float64(total) / float64(page.Limit)))
	httpx.List(w, out, httpx.PaginationMeta{
		Page: page.Number, Limit: page.Limit, Total: total, TotalPages: totalPages,
	})
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	e, err := h.service.Get(r.Context(), id)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toResponse(e))
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	patch, err := decode(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	e, err := h.service.Update(r.Context(), id, patch)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toResponse(e))
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.service.Delete(r.Context(), id); err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.NoContent(w)
}

// ── helpers ──

func decode(r *http.Request) (domain.ExpensePatch, error) {
	var req expenseRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return domain.ExpensePatch{}, err
	}
	return req.toPatch()
}

// pathID parses the {id} URL param, writing a NotFound response and returning
// ok=false if it is missing or non-numeric.
func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewNotFound("expense"))
		return 0, false
	}
	return id, true
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
