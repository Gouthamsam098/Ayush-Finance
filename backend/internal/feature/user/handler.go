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
	return r
}

// userRequest is the wire shape for create/update.
type userRequest struct {
	Email       string            `json:"email"`
	FullName    string            `json:"full_name"`
	Password    string            `json:"password"`
	Role        string            `json:"role"`
	Permissions map[string]string `json:"permissions"` // per-module access (VIEWER)
	IsActive    *bool             `json:"is_active"`   // pointer: omitted on create defaults to true
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
	return domain.UserInput{
		Email:       strings.TrimSpace(req.Email),
		FullName:    strings.TrimSpace(req.FullName),
		Password:    req.Password,
		Role:        domain.Role(strings.TrimSpace(req.Role)),
		Permissions: perms,
		IsActive:    active,
	}
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
}

func toResponse(u *domain.User) userResponse {
	perms := make(map[string]string, len(u.Permissions))
	for m, a := range u.Permissions {
		perms[m] = string(a)
	}
	resp := userResponse{
		ID: u.ID, Email: u.Email, FullName: u.FullName, Role: string(u.Role),
		Permissions: perms, IsActive: u.IsActive, CreatedAt: u.CreatedAt.Format(time.RFC3339),
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
	out := make([]userResponse, 0, len(users))
	for _, u := range users {
		out = append(out, toResponse(u))
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.requireAdmin(w, r); !ok {
		return
	}
	var req userRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	u, err := h.service.Create(r.Context(), req.toInput(true))
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.Created(w, toResponse(u))
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
	httpx.JSON(w, http.StatusOK, toResponse(u))
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

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewNotFound("user"))
		return 0, false
	}
	return id, true
}
