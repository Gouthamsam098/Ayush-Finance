package upisettings

import (
	"net/http"
	"strconv"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/anush-capitals/lms-backend/internal/httpx"
	"github.com/go-chi/chi/v5"
)

// Handler exposes the loan-type UPI settings: staff read and admins edit them
// at /settings/loan-type-upi; borrowers (/portal) and recovery agents (/agent)
// read them to pay or to show the customer where to pay.
type Handler struct {
	service *Service
	users   httpx.UserLoader
}

func NewHandler(service *Service, users httpx.UserLoader) *Handler {
	return &Handler{service: service, users: users}
}

// StaffRoutes are mounted at /settings/loan-type-upi. Reads need a staff
// login (admin or viewer); saving is admin-only, like the rest of Settings.
func (h *Handler) StaffRoutes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.staffGet)
	r.Put("/", h.save)
	return r
}

// ReadRoutes are mounted under /portal and /agent, whose groups already
// enforce the borrower / recovery-agent role.
func (h *Handler) ReadRoutes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.get)
	return r
}

type upiRow struct {
	PayeeVPA  string `json:"payee_vpa"`
	PayeeName string `json:"payee_name"`
}

type settingsResponse struct {
	// LoanTypes maps loan type → its UPI ID and payee name (saved rows only).
	LoanTypes map[string]upiRow `json:"loan_types"`
	// Complete is true when every loan type has one — UPI pay is offered only then.
	Complete bool `json:"complete"`
}

type saveRequest struct {
	LoanTypes map[string]upiRow `json:"loan_types"`
}

func toResponse(rows []domain.LoanTypeUPI) settingsResponse {
	out := settingsResponse{LoanTypes: map[string]upiRow{}}
	for _, r := range rows {
		out.LoanTypes[string(r.LoanType)] = upiRow{PayeeVPA: r.PayeeVPA, PayeeName: r.PayeeName}
	}
	out.Complete = true
	for _, t := range domain.UPILoanTypes {
		if _, ok := out.LoanTypes[string(t)]; !ok {
			out.Complete = false
		}
	}
	return out
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	rows, err := h.service.Get(r.Context())
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toResponse(rows))
}

// caller loads the signed-in user (active only), or writes 401.
func (h *Handler) caller(w http.ResponseWriter, r *http.Request) (*domain.User, bool) {
	id, err := strconv.ParseInt(httpx.UserID(r.Context()), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewUnauthorized("invalid or expired token"))
		return nil, false
	}
	u, err := h.users(r.Context(), id)
	if err != nil {
		httpx.Error(w, r, domain.NewUnauthorized("invalid or expired token"))
		return nil, false
	}
	return u, true
}

func (h *Handler) staffGet(w http.ResponseWriter, r *http.Request) {
	u, ok := h.caller(w, r)
	if !ok {
		return
	}
	if u.IsCustomer() || u.IsRecoveryAgent() {
		httpx.Error(w, r, domain.NewForbidden("you do not have permission to perform this action"))
		return
	}
	h.get(w, r)
}

func (h *Handler) save(w http.ResponseWriter, r *http.Request) {
	u, ok := h.caller(w, r)
	if !ok {
		return
	}
	if !u.IsAdmin() {
		httpx.Error(w, r, domain.NewForbidden("admin access required"))
		return
	}
	var req saveRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	in := make(map[domain.LoanType]domain.LoanTypeUPIInput, len(req.LoanTypes))
	for t, row := range req.LoanTypes {
		in[domain.LoanType(t)] = domain.LoanTypeUPIInput{PayeeVPA: row.PayeeVPA, PayeeName: row.PayeeName}
	}
	rows, err := h.service.Save(r.Context(), in, &u.ID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toResponse(rows))
}
