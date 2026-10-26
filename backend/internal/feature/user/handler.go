package user

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/anush-capitals/lms-backend/internal/httpx"
	"github.com/go-chi/chi/v5"
)

// Handler exposes admin-only managed-user endpoints. Every route first confirms
// the authenticated caller is an active ADMIN (RBAC).
type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service: service} }

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.list)
	r.Post("/", h.create)
	r.Patch("/{id}", h.update)
	r.Delete("/{id}", h.delete)
	// "Forgot password?" requests from the login page. Setting the user's new
	// password through PATCH /{id} closes their request automatically.
	r.Get("/password-reset-requests", h.listPasswordResetRequests)
	r.Post("/password-reset-requests/{id}/dismiss", h.dismissPasswordResetRequest)
	return r
}

type passwordResetResponse struct {
	ID              int64     `json:"id"`
	UserID          int64     `json:"user_id"`
	Email           string    `json:"email"`
	FullName        string    `json:"full_name"`
	Role            string    `json:"role"`
	RequestCount    int       `json:"request_count"`
	RequestedAt     time.Time `json:"requested_at"`
	LastRequestedAt time.Time `json:"last_requested_at"`
}

func (h *Handler) listPasswordResetRequests(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.requireAdmin(w, r); !ok {
		return
	}
	reqs, err := h.service.OpenPasswordResetRequests(r.Context())
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	out := make([]passwordResetResponse, 0, len(reqs))
	for _, p := range reqs {
		out = append(out, passwordResetResponse{
			ID: p.ID, UserID: p.UserID, Email: p.Email, FullName: p.FullName, Role: string(p.Role),
			RequestCount: p.RequestCount, RequestedAt: p.RequestedAt, LastRequestedAt: p.LastRequestedAt,
		})
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) dismissPasswordResetRequest(w http.ResponseWriter, r *http.Request) {
	actingID, ok := h.requireAdmin(w, r)
	if !ok {
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewNotFound("password reset request"))
		return
	}
	if err := h.service.DismissPasswordResetRequest(r.Context(), id, actingID); err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.NoContent(w)
}

// userRequest is the wire shape for create/update.
type userRequest struct {
	Email       string            `json:"email"`
	FullName    string            `json:"full_name"`
	Password    string            `json:"password"`
	Role        string            `json:"role"`
	Permissions map[string]string `json:"permissions"` // per-module access (VIEWER)
	IsActive    *bool             `json:"is_active"`   // pointer: omitted on create defaults to true
	// CustomerID links a CUSTOMER portal login to its customer record.
	CustomerID *int64 `json:"customer_id"`
	// AssignedLoanIDs is a RECOVERY_AGENT's loan set; omitted = unchanged.
	AssignedLoanIDs *[]int64 `json:"assigned_loan_ids"`
}

func (req userRequest) toInput(defaultActive bool) domain.UserInput {
	active := defaultActive
	if req.IsActive != nil {
		active = *req.IsActive
	}
	perms := make(domain.Permissions, len(req.Permissions))
	for m, a := range req.Permissions {
		perms[m] = domain.Access(a)
	}
	in := domain.UserInput{
		Email:       strings.TrimSpace(req.Email),
		FullName:    strings.TrimSpace(req.FullName),
		Password:    req.Password,
		Role:        domain.Role(strings.TrimSpace(req.Role)),
		Permissions: perms,
		IsActive:    active,
		CustomerID:  req.CustomerID,
	}
	if req.AssignedLoanIDs != nil {
		in.AssignedLoanIDs = append([]int64{}, *req.AssignedLoanIDs...)
	}
	return in
}

// userResponse is the public projection — never includes the password hash.
type userResponse struct {
	ID          int64             `json:"id"`
	Email       string            `json:"email"`
	FullName    string            `json:"full_name"`
	Role        string            `json:"role"`
	Permissions map[string]string `json:"permissions"`
	IsActive    bool              `json:"is_active"`
	LastLoginAt *string           `json:"last_login_at,omitempty"`
	CreatedAt   string            `json:"created_at"`
	// CustomerID is set for a CUSTOMER portal login.
	CustomerID *int64 `json:"customer_id,omitempty"`
	// AssignedLoanIDs is a RECOVERY_AGENT's loan set.
	AssignedLoanIDs []int64 `json:"assigned_loan_ids,omitempty"`
}

func toResponse(u *domain.User, agentLoans map[int64][]int64) userResponse {
	perms := make(map[string]string, len(u.Permissions))
	for m, a := range u.Permissions {
		perms[m] = string(a)
	}
	resp := userResponse{
		ID: u.ID, Email: u.Email, FullName: u.FullName, Role: string(u.Role),
		Permissions: perms, IsActive: u.IsActive, CreatedAt: u.CreatedAt.Format(time.RFC3339),
		CustomerID: u.CustomerID,
	}
	if u.IsRecoveryAgent() {
		resp.AssignedLoanIDs = agentLoans[u.ID]
		if resp.AssignedLoanIDs == nil {
			resp.AssignedLoanIDs = []int64{}
		}
	}
	if u.LastLoginAt != nil {
		s := u.LastLoginAt.Format(time.RFC3339)
		resp.LastLoginAt = &s
	}
	return resp
}

// requireAdmin resolves the authenticated caller and confirms they are an admin.
// Returns the caller's id and ok=false (after writing the error) otherwise.
func (h *Handler) requireAdmin(w http.ResponseWriter, r *http.Request) (int64, bool) {
	uid, err := strconv.ParseInt(httpx.UserID(r.Context()), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewUnauthorized("invalid or expired token"))
		return 0, false
	}
	caller, err := h.service.Get(r.Context(), uid)
	if err != nil {
		httpx.Error(w, r, domain.NewUnauthorized("invalid or expired token"))
		return 0, false
	}
	// A DEACTIVATED admin must lose access immediately, not when their token
	// expires. Every other module is protected by RequirePermission, which loads
	// the caller through auth.FindByID (that query filters `is_active = TRUE`).
	// These /users routes are guarded here instead, and user.FindByID filters
	// only `deleted_at` — so without this check a just-disabled admin kept full
	// user-management (create/delete users, change roles) for the remaining life
	// of their 1-hour token, on the single most privileged surface in the app.
	if !caller.IsActive {
		httpx.Error(w, r, domain.NewUnauthorized("your account is no longer active"))
		return 0, false
	}
	if !caller.IsAdmin() {
		httpx.Error(w, r, domain.NewForbidden("admin access required"))
		return 0, false
	}
	return uid, true
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.requireAdmin(w, r); !ok {
		return
	}
	users, err := h.service.List(r.Context())
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	agentLoans, err := h.service.AgentLoans(r.Context())
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	out := make([]userResponse, 0, len(users))
	for _, u := range users {
		out = append(out, toResponse(u, agentLoans))
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	actingID, ok := h.requireAdmin(w, r)
	if !ok {
		return
	}
	var req userRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	u, err := h.service.Create(r.Context(), actingID, req.toInput(true))
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	h.writeUser(w, r, u, http.StatusCreated)
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	actingID, ok := h.requireAdmin(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req userRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	// Load current so an omitted is_active preserves the stored value.
	cur, err := h.service.Get(r.Context(), id)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	u, err := h.service.Update(r.Context(), id, actingID, req.toInput(cur.IsActive))
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	h.writeUser(w, r, u, http.StatusOK)
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	actingID, ok := h.requireAdmin(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := h.service.Delete(r.Context(), id, actingID); err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.NoContent(w)
}

// writeUser responds with one user, including an agent's current loan set.
func (h *Handler) writeUser(w http.ResponseWriter, r *http.Request, u *domain.User, status int) {
	agentLoans, err := h.service.AgentLoans(r.Context())
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, status, toResponse(u, agentLoans))
}

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewNotFound("user"))
		return 0, false
	}
	return id, true
}

// PortalLoginRoutes are mounted at /customers/{customerId}/portal-login behind
// the Customers permission: staff who may edit a customer may give it a login.
func (h *Handler) PortalLoginRoutes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.getPortalLogin)
	r.Post("/", h.createPortalLogin)
	return r
}

type portalLoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// portalLoginResponse never carries the password or its hash.
type portalLoginResponse struct {
	Email       string  `json:"email"`
	IsActive    bool    `json:"is_active"`
	LastLoginAt *string `json:"last_login_at,omitempty"`
}

func toPortalLoginResponse(p *PortalLogin) portalLoginResponse {
	resp := portalLoginResponse{Email: p.Email, IsActive: p.IsActive}
	if p.LastLoginAt != nil {
		s := p.LastLoginAt.Format(time.RFC3339)
		resp.LastLoginAt = &s
	}
	return resp
}

func (h *Handler) getPortalLogin(w http.ResponseWriter, r *http.Request) {
	customerID, ok := customerPathID(w, r)
	if !ok {
		return
	}
	p, err := h.service.PortalLogin(r.Context(), customerID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toPortalLoginResponse(p))
}

func (h *Handler) createPortalLogin(w http.ResponseWriter, r *http.Request) {
	customerID, ok := customerPathID(w, r)
	if !ok {
		return
	}
	var req portalLoginRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	p, err := h.service.CreatePortalLogin(r.Context(), customerID,
		domain.PortalLoginInput{Email: strings.TrimSpace(req.Email), Password: req.Password})
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.Created(w, toPortalLoginResponse(p))
}

func customerPathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "customerId"), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewNotFound("customer"))
		return 0, false
	}
	return id, true
}
