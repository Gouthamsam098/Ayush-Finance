package collection

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

// Handler exposes collection endpoints: parse/validate input, convert
// wire<->domain, shape responses. No business logic.
type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service: service} }

// LoanRoutes mounts under /loans/{loanId}/collections — record + list a loan's
// payments (the ledger).
func (h *Handler) LoanRoutes() chi.Router {
	r := chi.NewRouter()
	r.Post("/", h.record)
	r.Get("/", h.listByLoan)
	return r
}

// FlatRoutes mounts under /collections — the cross-loan daily feed plus
// edit/delete of an individual payment by its own id.
func (h *Handler) FlatRoutes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.feed)
	r.Get("/{id}", h.get)
	r.Patch("/{id}", h.update)
	r.Delete("/{id}", h.delete)
	return r
}

// collectionRequest is the wire shape for record/update. Amount arrives as
// rupees and is converted to Paise here.
type collectionRequest struct {
	Amount  float64 `json:"amount"`
	Date    string  `json:"date"` // YYYY-MM-DD
	Mode    string  `json:"mode"`
	Kind    string  `json:"kind"` // INTEREST (default) | PRINCIPAL
	Remarks *string `json:"remarks"`
}

func (req collectionRequest) toInput() (domain.CollectionInput, error) {
	kind := domain.CollectionKind(strings.TrimSpace(req.Kind))
	if kind == "" {
		kind = domain.KindInterest // default: a plain payment is interest/repayment
	}
	in := domain.CollectionInput{
		Amount:  domain.RupeesToPaise(req.Amount),
		Mode:    domain.PayMode(strings.TrimSpace(req.Mode)),
		Kind:    kind,
		Remarks: req.Remarks,
	}
	if s := strings.TrimSpace(req.Date); s != "" {
		t, err := time.ParseInLocation("2006-01-02", s, time.Local)
		if err != nil {
			return in, domain.NewValidation("Invalid payment date", map[string]string{"date": "Use YYYY-MM-DD"})
		}
		in.Date = t
	}
	return in, nil
}

// collectionResponse is the public snake_case projection. Money is emitted as rupees.
type collectionResponse struct {
	ID        int64   `json:"id"`
	ReceiptNo string  `json:"receipt_no"`
	LoanID    int64   `json:"loan_id"`
	Date      string  `json:"date"`
	Amount    float64 `json:"amount"`
	Mode      string  `json:"mode"`
	Kind      string  `json:"kind"`
	Remarks   *string `json:"remarks,omitempty"`
	PostedBy  *int64  `json:"posted_by,omitempty"`
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
}

func toResponse(c *domain.Collection) collectionResponse {
	return collectionResponse{
		ID: c.ID, ReceiptNo: c.ReceiptNo, LoanID: c.LoanID,
		Date: c.Date.Format("2006-01-02"), Amount: c.Amount.Rupees(), Mode: string(c.Mode),
		Kind: string(c.Kind), Remarks: c.Remarks, PostedBy: c.PostedBy,
		CreatedAt: c.CreatedAt.Format(time.RFC3339), UpdatedAt: c.UpdatedAt.Format(time.RFC3339),
	}
}

func (h *Handler) record(w http.ResponseWriter, r *http.Request) {
	loanID, ok := pathID(w, r, "loanId", "loan")
	if !ok {
		return
	}
	in, err := decode(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	in.LoanID = loanID

	var postedBy *int64
	if uid, err := strconv.ParseInt(httpx.UserID(r.Context()), 10, 64); err == nil {
		postedBy = &uid
	}

	c, err := h.service.Record(r.Context(), in, postedBy)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.Created(w, toResponse(c))
}

func (h *Handler) listByLoan(w http.ResponseWriter, r *http.Request) {
	loanID, ok := pathID(w, r, "loanId", "loan")
	if !ok {
		return
	}
	items, err := h.service.ListByLoan(r.Context(), loanID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, projectList(items))
}

func (h *Handler) feed(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from := strings.TrimSpace(q.Get("from"))
	to := strings.TrimSpace(q.Get("to"))
	pageStr := strings.TrimSpace(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))

	// Range/paginated mode: any of from/to/page present → return a paginated
	// envelope with meta (used by the Reports export). Otherwise fall back to the
	// legacy single-day feed so the existing daily collection view is unchanged.
	if from != "" || to != "" || pageStr != "" {
		page := atoiDefault(pageStr, 1)
		if page < 1 {
			page = 1
		}
		if limit <= 0 {
			limit = 100
		}
		offset := (page - 1) * limit
		items, total, err := h.service.FeedRange(r.Context(), from, to, limit, offset)
		if err != nil {
			httpx.Error(w, r, err)
			return
		}
		totalPages := int(math.Ceil(float64(total) / float64(limit)))
		httpx.List(w, projectList(items), httpx.PaginationMeta{
			Page: page, Limit: limit, Total: total, TotalPages: totalPages,
		})
		return
	}

	date := strings.TrimSpace(q.Get("date"))
	items, err := h.service.Feed(r.Context(), date, limit)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, projectList(items))
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

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id", "collection")
	if !ok {
		return
	}
	c, err := h.service.Get(r.Context(), id)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toResponse(c))
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id", "collection")
	if !ok {
		return
	}
	in, err := decode(r)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	c, err := h.service.Update(r.Context(), id, in)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toResponse(c))
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r, "id", "collection")
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

func decode(r *http.Request) (domain.CollectionInput, error) {
	var req collectionRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		return domain.CollectionInput{}, err
	}
	return req.toInput()
}

func projectList(items []*domain.Collection) []collectionResponse {
	out := make([]collectionResponse, 0, len(items))
	for _, c := range items {
		out = append(out, toResponse(c))
	}
	return out
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
