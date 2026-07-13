package customer

import (
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/anush-capitals/lms-backend/internal/httpx"
	"github.com/go-chi/chi/v5"
)

// Handler exposes customer endpoints. It parses input, converts between the
// wire DTO and the domain input, and shapes responses. No business logic.
type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// Routes returns the customer sub-router (mounted behind auth).
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/", h.create)
	r.Get("/", h.list)
	r.Get("/{id}", h.get)
	r.Patch("/{id}", h.update)
	r.Delete("/{id}", h.delete)
	return r
}

// customerRequest is the wire shape for create/update. Money arrives as a
// rupee number and is converted to paise at this boundary; it is never stored
// as a float.
type customerRequest struct {
	Name            string   `json:"name"`
	FatherName      *string  `json:"father_name"`
	Mobile          string   `json:"mobile"`
	AltMobile       *string  `json:"alt_mobile"`
	Email           *string  `json:"email"`
	DateOfBirth     *string  `json:"date_of_birth"`
	Address         *string  `json:"address"`
	City            *string  `json:"city"`
	State           *string  `json:"state"`
	Pincode         *string  `json:"pincode"`
	Occupation      *string  `json:"occupation"`
	MonthlyIncome   *float64 `json:"monthly_income"`
	ReferenceName   *string  `json:"reference_name"`
	ReferenceMobile *string  `json:"reference_mobile"`
	AadhaarNumber   *string  `json:"aadhaar_number"`
	PANNumber       *string  `json:"pan_number"`
}

func (req customerRequest) toInput() domain.CustomerInput {
	in := domain.CustomerInput{
		Name:            strings.TrimSpace(req.Name),
		FatherName:      req.FatherName,
		Mobile:          strings.TrimSpace(req.Mobile),
		AltMobile:       req.AltMobile,
		Email:           trimLowerPtr(req.Email),
		DateOfBirth:     req.DateOfBirth,
		Address:         req.Address,
		City:            req.City,
		State:           req.State,
		Pincode:         req.Pincode,
		Occupation:      req.Occupation,
		ReferenceName:   req.ReferenceName,
		ReferenceMobile: req.ReferenceMobile,
		AadhaarNumber:   trimPtr(req.AadhaarNumber),
		PANNumber:       upperTrimPtr(req.PANNumber),
	}
	if req.MonthlyIncome != nil {
		p := domain.RupeesToPaise(*req.MonthlyIncome)
		in.MonthlyIncome = &p
	}
	return in
}

func trimPtr(s *string) *string {
	if s == nil {
		return nil
	}
	t := strings.TrimSpace(*s)
	return &t
}

func trimLowerPtr(s *string) *string {
	if s == nil {
		return nil
	}
	t := strings.ToLower(strings.TrimSpace(*s))
	return &t
}

func upperTrimPtr(s *string) *string {
	if s == nil {
		return nil
	}
	t := strings.ToUpper(strings.TrimSpace(*s))
	return &t
}

// customerResponse is the public projection. Money is emitted as rupees for
// the frontend, derived from the stored paise.
type customerResponse struct {
	ID              string   `json:"id"`
	Code            string   `json:"code"`
	Name            string   `json:"name"`
	FatherName      *string  `json:"father_name,omitempty"`
	Mobile          string   `json:"mobile"`
	AltMobile       *string  `json:"alt_mobile,omitempty"`
	Email           *string  `json:"email,omitempty"`
	DateOfBirth     *string  `json:"date_of_birth,omitempty"`
	Address         *string  `json:"address,omitempty"`
	City            *string  `json:"city,omitempty"`
	State           *string  `json:"state,omitempty"`
	Pincode         *string  `json:"pincode,omitempty"`
	Occupation      *string  `json:"occupation,omitempty"`
	MonthlyIncome   *float64 `json:"monthly_income,omitempty"`
	ReferenceName   *string  `json:"reference_name,omitempty"`
	ReferenceMobile *string  `json:"reference_mobile,omitempty"`
	// KYC values are returned MASKED only (e.g. XXXX-XXXX-1234). The full
	// number is never sent to the client. Booleans indicate presence so the
	// UI can show "verified/on file" without exposing the value.
	AadhaarMasked *string `json:"aadhaar_masked,omitempty"`
	PANMasked     *string `json:"pan_masked,omitempty"`
	HasAadhaar    bool    `json:"has_aadhaar"`
	HasPAN        bool    `json:"has_pan"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
}

func toResponse(c *domain.Customer) customerResponse {
	resp := customerResponse{
		ID: c.ID, Code: c.Code, Name: c.Name, FatherName: c.FatherName,
		Mobile: c.Mobile, AltMobile: c.AltMobile, Email: c.Email,
		DateOfBirth: c.DateOfBirth, Address: c.Address, City: c.City,
		State: c.State, Pincode: c.Pincode, Occupation: c.Occupation,
		ReferenceName: c.ReferenceName, ReferenceMobile: c.ReferenceMobile,
		AadhaarMasked: domain.MaskAadhaar(c.AadhaarNumber),
		PANMasked:     domain.MaskPAN(c.PANNumber),
		HasAadhaar:    c.AadhaarNumber != nil,
		HasPAN:        c.PANNumber != nil,
		CreatedAt:     c.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:     c.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
	if c.MonthlyIncome != nil {
		r := c.MonthlyIncome.Rupees()
		resp.MonthlyIncome = &r
	}
	return resp
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var req customerRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	c, err := h.service.Create(r.Context(), req.toInput())
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.Created(w, toResponse(c))
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	c, err := h.service.Get(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toResponse(c))
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	page := Page{
		Number: atoiDefault(r.URL.Query().Get("page"), 1),
		Limit:  atoiDefault(r.URL.Query().Get("limit"), defaultLimit),
		Search: strings.TrimSpace(r.URL.Query().Get("search")),
	}.Normalize()

	customers, total, err := h.service.List(r.Context(), page)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}

	items := make([]customerResponse, 0, len(customers))
	for _, c := range customers {
		items = append(items, toResponse(c))
	}

	totalPages := int(math.Ceil(float64(total) / float64(page.Limit)))
	httpx.List(w, items, httpx.PaginationMeta{
		Page: page.Number, Limit: page.Limit, Total: total, TotalPages: totalPages,
	})
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	var req customerRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	c, err := h.service.Update(r.Context(), chi.URLParam(r, "id"), req.toInput())
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toResponse(c))
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	if err := h.service.Delete(r.Context(), chi.URLParam(r, "id")); err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.NoContent(w)
}

func atoiDefault(s string, fallback int) int {
	if s == "" {
		return fallback
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return fallback
	}
	return v
}
