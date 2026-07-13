package auth

import (
	"net/http"
	"strings"

	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/anush-capitals/lms-backend/internal/httpx"
	"github.com/go-chi/chi/v5"
)

// Handler exposes the auth endpoints over HTTP. It parses/validates input,
// delegates to the service, and shapes the response — no business logic here.
type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// Routes returns the auth sub-router. Login and refresh are public; /me is
// mounted behind the auth middleware by the top-level router.
func (h *Handler) PublicRoutes() chi.Router {
	r := chi.NewRouter()
	r.Post("/login", h.login)
	r.Post("/refresh", h.refresh)
	return r
}

// ProtectedRoutes are mounted at /me by the top-level router, so the handler
// registers at the mount root.
func (h *Handler) ProtectedRoutes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.me)
	return r
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type tokenResponse struct {
	AccessToken string `json:"access_token"`
	// Omitted entirely in hard-session mode where no refresh token is issued.
	RefreshToken string `json:"refresh_token,omitempty"`
	TokenType    string `json:"token_type"`
	// ExpiresInSeconds lets the client know the session length without decoding
	// the JWT — useful for showing a countdown or pre-emptive logout.
	ExpiresInSeconds int `json:"expires_in_seconds"`
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" || req.Password == "" {
		httpx.Error(w, r, domain.NewValidation("email and password are required", map[string]string{
			"email":    "required",
			"password": "required",
		}))
		return
	}

	pair, _, err := h.service.Login(r.Context(), email, req.Password)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}

	httpx.JSON(w, http.StatusOK, tokenResponse{
		AccessToken:      pair.AccessToken,
		RefreshToken:     pair.RefreshToken,
		TokenType:        "Bearer",
		ExpiresInSeconds: h.service.AccessTTLSeconds(),
	})
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

func (h *Handler) refresh(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	if strings.TrimSpace(req.RefreshToken) == "" {
		httpx.Error(w, r, domain.NewValidation("refresh_token is required", nil))
		return
	}

	pair, err := h.service.Refresh(r.Context(), req.RefreshToken)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}

	httpx.JSON(w, http.StatusOK, tokenResponse{
		AccessToken:      pair.AccessToken,
		RefreshToken:     pair.RefreshToken,
		TokenType:        "Bearer",
		ExpiresInSeconds: h.service.AccessTTLSeconds(),
	})
}

// userResponse is the public projection of a user. It deliberately omits
// password_hash and any other sensitive field.
type userResponse struct {
	ID         string `json:"id"`
	Email      string `json:"email"`
	FullName   string `json:"full_name"`
	MFAEnabled bool   `json:"mfa_enabled"`
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	userID := httpx.UserID(r.Context())
	user, err := h.service.CurrentUser(r.Context(), userID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}

	httpx.JSON(w, http.StatusOK, userResponse{
		ID:         user.ID,
		Email:      user.Email,
		FullName:   user.FullName,
		MFAEnabled: user.MFAEnabled,
	})
}
