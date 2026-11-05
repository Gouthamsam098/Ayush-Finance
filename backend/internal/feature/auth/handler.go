package auth

import (
	"net/http"
	"strconv"
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
	r.Post("/login/mfa", h.loginMFA)
	r.Post("/refresh", h.refresh)
	r.Post("/password-reset-requests", h.requestPasswordReset)
	r.Post("/change-password", h.changePasswordWithCredentials)
	return r
}

type credentialsPasswordChange struct {
	Email           string `json:"email"`
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

// changePasswordWithCredentials: "Forgot password?" on the login page for
// someone who knows their current password. Public, rate-limited with login.
func (h *Handler) changePasswordWithCredentials(w http.ResponseWriter, r *http.Request) {
	var req credentialsPasswordChange
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	if err := h.service.ChangePasswordWithCredentials(r.Context(), req.Email, domain.PasswordChangeInput{
		Current: req.CurrentPassword, New: req.NewPassword,
	}); err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.NoContent(w)
}

type passwordResetRequest struct {
	Email string `json:"email"`
}

// passwordResetMessage is the single answer to every well-formed request, for
// an existing account or not, so the form cannot reveal which emails have one.
// Nothing is emailed: the request shows up for admins inside the app.
const passwordResetMessage = "If an account exists for this email, your request has been sent to your administrator. " +
	"They will set a new password and share it with you."

// requestPasswordReset is the login page's "Forgot password?". Public and
// rate-limited with the rest of /auth; it changes nothing about the account
// (no lockout), it only asks an administrator to reset it.
func (h *Handler) requestPasswordReset(w http.ResponseWriter, r *http.Request) {
	var req passwordResetRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	if err := h.service.RequestPasswordReset(r.Context(), req.Email); err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusAccepted, map[string]string{"message": passwordResetMessage})
}

// ProtectedRoutes are mounted at /me by the top-level router, so the handler
// registers at the mount root. Password changes get their own per-IP budget
// (passwordChangesPerMinute, the login limit): the general API budget is far
// too generous to stop a hijacked session guessing the current password.
func (h *Handler) ProtectedRoutes(passwordChangesPerMinute int) chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.me)
	r.With(httpx.RateLimit(passwordChangesPerMinute)).Post("/password", h.changePassword)
	// Two-factor: codes can be guessed, so these share a login-sized budget.
	mfaLimit := httpx.RateLimit(passwordChangesPerMinute)
	r.With(mfaLimit).Post("/mfa/setup", h.mfaSetup)
	r.With(mfaLimit).Post("/mfa/enable", h.mfaEnable)
	r.With(mfaLimit).Post("/mfa/disable", h.mfaDisable)
	return r
}

type mfaCodeRequest struct {
	Code string `json:"code"`
}

func (h *Handler) callerID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(httpx.UserID(r.Context()), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewUnauthorized("invalid or expired token"))
		return 0, false
	}
	return id, true
}

// mfaSetup starts two-factor setup: returns the secret (to type in) and the
// otpauth:// link (for the QR code the app draws itself — never a third party).
func (h *Handler) mfaSetup(w http.ResponseWriter, r *http.Request) {
	id, ok := h.callerID(w, r)
	if !ok {
		return
	}
	secret, uri, err := h.service.MFASetup(r.Context(), id)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"secret": secret, "otpauth_uri": uri})
}

func (h *Handler) mfaEnable(w http.ResponseWriter, r *http.Request) {
	id, ok := h.callerID(w, r)
	if !ok {
		return
	}
	var req mfaCodeRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	if err := h.service.MFAEnable(r.Context(), id, req.Code); err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"mfa_enabled": true})
}

func (h *Handler) mfaDisable(w http.ResponseWriter, r *http.Request) {
	id, ok := h.callerID(w, r)
	if !ok {
		return
	}
	var req mfaCodeRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	if err := h.service.MFADisable(r.Context(), id, req.Code); err != nil {
		httpx.Error(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"mfa_enabled": false})
}

type loginMFARequest struct {
	MFAToken string `json:"mfa_token"`
	Code     string `json:"code"`
}

// loginMFA is the second login step for an account with two-factor on.
func (h *Handler) loginMFA(w http.ResponseWriter, r *http.Request) {
	var req loginMFARequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	pair, err := h.service.LoginMFA(r.Context(), req.MFAToken, req.Code)
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

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

// changePassword is the signed-in user changing their OWN password.
func (h *Handler) changePassword(w http.ResponseWriter, r *http.Request) {
	userID, err := strconv.ParseInt(httpx.UserID(r.Context()), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewUnauthorized("invalid or expired token"))
		return
	}
	var req changePasswordRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, r, err)
		return
	}
	pair, err := h.service.ChangePassword(r.Context(), userID, domain.PasswordChangeInput{
		Current: req.CurrentPassword, New: req.NewPassword,
	})
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	// Changing the password ends every earlier session, including the one that
	// sent this request; the caller continues on this fresh token.
	httpx.JSON(w, http.StatusOK, tokenResponse{
		AccessToken:      pair.AccessToken,
		RefreshToken:     pair.RefreshToken,
		TokenType:        "Bearer",
		ExpiresInSeconds: h.service.AccessTTLSeconds(),
	})
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

	res, _, err := h.service.Login(r.Context(), email, req.Password)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	if res.MFAToken != "" {
		// Two-factor on: no session yet — the client asks for the code and
		// sends it with this token to /auth/login/mfa.
		httpx.JSON(w, http.StatusOK, map[string]any{
			"mfa_required": true, "mfa_token": res.MFAToken,
			"expires_in_seconds": int(mfaChallengeTTL.Seconds()),
		})
		return
	}

	httpx.JSON(w, http.StatusOK, tokenResponse{
		AccessToken:      res.Tokens.AccessToken,
		RefreshToken:     res.Tokens.RefreshToken,
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
	ID          int64             `json:"id"`
	Email       string            `json:"email"`
	FullName    string            `json:"full_name"`
	Role        string            `json:"role"`
	Permissions map[string]string `json:"permissions"`
	MFAEnabled  bool              `json:"mfa_enabled"`
	// CustomerID links a CUSTOMER portal login to its customer record.
	CustomerID *int64 `json:"customer_id,omitempty"`
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	userID, err := strconv.ParseInt(httpx.UserID(r.Context()), 10, 64)
	if err != nil {
		httpx.Error(w, r, domain.NewUnauthorized("invalid or expired token"))
		return
	}
	user, err := h.service.CurrentUser(r.Context(), userID)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}

	perms := make(map[string]string, len(user.Permissions))
	for m, a := range user.Permissions {
		perms[m] = string(a)
	}
	httpx.JSON(w, http.StatusOK, userResponse{
		ID:          user.ID,
		Email:       user.Email,
		FullName:    user.FullName,
		Role:        string(user.Role),
		Permissions: perms,
		MFAEnabled:  user.MFAEnabled,
		CustomerID:  user.CustomerID,
	})
}
