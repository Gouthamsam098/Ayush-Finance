package auth

import (
	"context"
	"strconv"
	"sync"
	"time"

	"github.com/anush-capitals/lms-backend/internal/audit"
	"github.com/anush-capitals/lms-backend/internal/crypto"
	"github.com/anush-capitals/lms-backend/internal/domain"
)

// Clock returns the current time. Injecting it keeps the service testable and
// free of hidden global clock reads.
type Clock func() time.Time

// Service holds authentication business logic. Dependencies are injected so
// the service can be unit-tested with fakes.
type Service struct {
	repo           *Repository
	hasher         *crypto.Hasher
	tokens         *crypto.TokenManager
	now            Clock
	refreshEnabled bool
	accessTTL      time.Duration
	// mfaBox seals two-factor secrets at rest.
	mfaBox *crypto.SecretBox
	// audits records sign-ins (and refused ones), password and 2FA changes.
	audits *audit.Recorder
	// accounts locks an account after repeated failed sign-ins (lockout.go).
	accounts *accountGuard

	// dummyHash is compared against when an email has no account, so that path
	// costs the same bcrypt work as a wrong password (see equalizeUnknownUser).
	dummyOnce sync.Once
	dummyHash string
}

// equalizeUnknownUser spends the bcrypt work a real password check costs, so
// "no such account" cannot be told apart from "wrong password" by response
// time. The dummy hash is made once, at the configured cost, on first use.
func (s *Service) equalizeUnknownUser(password string) {
	s.dummyOnce.Do(func() {
		s.dummyHash, _ = s.hasher.Hash("anush-lms-unknown-account")
	})
	if s.dummyHash != "" {
		_ = s.hasher.Compare(s.dummyHash, password)
	}
}

func NewService(repo *Repository, hasher *crypto.Hasher, tokens *crypto.TokenManager, now Clock, refreshEnabled bool,
	accessTTL time.Duration, mfaBox *crypto.SecretBox, audits *audit.Recorder,
) *Service {
	return &Service{repo: repo, hasher: hasher, tokens: tokens, now: now, refreshEnabled: refreshEnabled,
		accessTTL: accessTTL, mfaBox: mfaBox, audits: audits, accounts: newAccountGuard()}
}

// loginRefused records a refused credential check. userID is 0 when the email
// matched no account — the attempted address is not stored.
func (s *Service) loginRefused(ctx context.Context, userID int64, reason string) {
	s.audits.Record(ctx, audit.Entry{EntityType: audit.EntityUser, EntityID: userID,
		Action: audit.ActionLoginFailed, After: map[string]any{"reason": reason}})
}

// loggedIn records a completed sign-in.
func (s *Service) loggedIn(ctx context.Context, userID int64, withMFA bool) {
	s.audits.Record(ctx, audit.Entry{EntityType: audit.EntityUser, EntityID: userID,
		Action: audit.ActionLogin, After: map[string]any{"two_factor": withMFA}})
}

// RefreshEnabled reports whether silent renewal is available. When false, the
// access token is the whole session and re-login is required at expiry.
func (s *Service) RefreshEnabled() bool { return s.refreshEnabled }

// AccessTTLSeconds is the session length in seconds, for the client to display.
func (s *Service) AccessTTLSeconds() int { return int(s.accessTTL.Seconds()) }

// TokenPair is the result of a successful authentication.
type TokenPair struct {
	AccessToken  string
	RefreshToken string
}

// LoginResult is a successful password check: either the session (Tokens), or
// — for an account with two-factor on — the single-use token for the second
// step (MFAToken), with no session yet.
type LoginResult struct {
	Tokens   *TokenPair
	MFAToken string
}

// Login verifies credentials. To avoid leaking which accounts exist, both "no
// such user" and "wrong password" return the same generic unauthorized error.
// With two-factor on, no session is issued until LoginMFA verifies the code.
func (s *Service) Login(ctx context.Context, email, password string) (*LoginResult, *domain.User, error) {
	if s.accounts.locked(email, s.now()) {
		s.loginRefused(ctx, 0, "account_locked")
		return nil, nil, domain.NewTooManyRequests(lockedMessage)
	}
	user, err := s.repo.FindByEmail(ctx, email)
	if err != nil {
		if de, ok := domain.AsError(err); ok && de.Code == domain.CodeNotFound {
			s.equalizeUnknownUser(password)
			s.accounts.fail(email, s.now())
			s.loginRefused(ctx, 0, "unknown_account")
			return nil, nil, domain.NewUnauthorized("invalid email or password")
		}
		return nil, nil, err
	}

	if err := s.hasher.Compare(user.PasswordHash, password); err != nil {
		s.accounts.fail(email, s.now())
		s.loginRefused(ctx, user.ID, "wrong_password")
		return nil, nil, domain.NewUnauthorized("invalid email or password")
	}

	if user.MFAEnabled {
		token, err := s.startMFAChallenge(ctx, user.ID)
		if err != nil {
			return nil, nil, err
		}
		return &LoginResult{MFAToken: token}, user, nil
	}

	pair, err := s.issueTokens(user.ID)
	if err != nil {
		return nil, nil, err
	}

	// Best-effort: a failure to record the login timestamp must not fail the
	// login itself, but it is logged by the caller via the returned error path
	// only when fatal. Here we ignore a non-fatal update error deliberately.
	_ = s.repo.TouchLastLogin(ctx, user.ID, s.now())
	s.accounts.succeed(email)
	s.loggedIn(ctx, user.ID, false)

	return &LoginResult{Tokens: pair}, user, nil
}

// Refresh validates a refresh token and issues a fresh token pair, confirming
// the user is still active. When refresh is disabled (hard-session mode) it
// always rejects, forcing re-login at access-token expiry.
func (s *Service) Refresh(ctx context.Context, refreshToken string) (*TokenPair, error) {
	if !s.refreshEnabled {
		return nil, domain.NewUnauthorized("session expired, please log in again")
	}

	claims, err := s.tokens.Verify(refreshToken, crypto.RefreshToken)
	if err != nil {
		return nil, domain.NewUnauthorized("invalid or expired refresh token")
	}

	subjectID, err := strconv.ParseInt(claims.Subject, 10, 64)
	if err != nil {
		return nil, domain.NewUnauthorized("invalid or expired refresh token")
	}

	user, err := s.repo.FindByID(ctx, subjectID)
	if err != nil {
		return nil, domain.NewUnauthorized("account is no longer active")
	}
	if claims.IssuedAt == nil || !user.TokenStillValid(claims.IssuedAt.Time) {
		return nil, domain.NewUnauthorized("session expired, please log in again")
	}

	return s.issueTokens(subjectID)
}

// RequestPasswordReset files a reset request for an administrator to act on.
// The result never says whether the email belongs to an account; only a
// malformed address is reported back.
func (s *Service) RequestPasswordReset(ctx context.Context, rawEmail string) error {
	email, err := domain.NormalizeResetEmail(rawEmail)
	if err != nil {
		return err
	}
	return s.repo.RequestPasswordReset(ctx, email)
}

// ChangePassword lets a signed-in user replace their own password after proving
// the current one. A wrong current password is a VALIDATION error, never 401:
// the client treats 401 as an expired session and signs the user out.
func (s *Service) ChangePassword(ctx context.Context, userID int64, in domain.PasswordChangeInput) (*TokenPair, error) {
	if err := in.Validate(); err != nil {
		return nil, err
	}
	user, err := s.repo.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if err := s.hasher.Compare(user.PasswordHash, in.Current); err != nil {
		return nil, domain.NewValidation("Current password is incorrect",
			map[string]string{"current_password": "Current password is incorrect"})
	}
	hash, err := s.hasher.Hash(in.New)
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpdatePassword(ctx, userID, user.PasswordHash, hash, s.now()); err != nil {
		return nil, err
	}
	s.audits.Record(ctx, audit.Entry{EntityType: audit.EntityUser, EntityID: userID, Action: audit.ActionUpdate,
		After: map[string]any{"password": "changed", "via": "settings"}})
	// Every other session (other devices, anyone who knew the old password) is
	// now refused; this one continues on a fresh token issued after the change.
	return s.issueTokens(userID)
}

// ChangePasswordWithCredentials is the login page's "Forgot password?": the
// person is NOT signed in, so they prove who they are exactly as login does —
// email + current password — and set a new one. A wrong email and a wrong
// password give the same answer as login, so it reveals no accounts.
func (s *Service) ChangePasswordWithCredentials(ctx context.Context, rawEmail string, in domain.PasswordChangeInput) error {
	email, err := domain.NormalizeResetEmail(rawEmail)
	if err != nil {
		return err
	}
	if err := in.Validate(); err != nil {
		return err
	}
	bad := domain.NewUnauthorized("Email or current password is incorrect")
	// Same lockout as sign-in: this form is also a password check.
	if s.accounts.locked(email, s.now()) {
		s.loginRefused(ctx, 0, "account_locked")
		return domain.NewTooManyRequests(lockedMessage)
	}
	user, err := s.repo.FindByEmail(ctx, email)
	if err != nil {
		if de, ok := domain.AsError(err); ok && de.Code == domain.CodeNotFound {
			s.equalizeUnknownUser(in.Current)
			s.accounts.fail(email, s.now())
			s.loginRefused(ctx, 0, "change_password_unknown_account")
			return bad
		}
		return err
	}
	if err := s.hasher.Compare(user.PasswordHash, in.Current); err != nil {
		s.accounts.fail(email, s.now())
		s.loginRefused(ctx, user.ID, "change_password_wrong_password")
		return bad
	}
	// With two-factor on, the password alone is not enough to sign in — so it
	// must not be enough to replace the password (and end every session) either.
	// Checked only after the password matched, so it reveals nothing to someone
	// guessing.
	if user.MFAEnabled {
		return domain.NewConflict("This account uses two-factor sign-in. Sign in with your authenticator code, " +
			"then change your password under Settings → Change password.")
	}
	hash, err := s.hasher.Hash(in.New)
	if err != nil {
		return err
	}
	if err := s.repo.UpdatePassword(ctx, user.ID, user.PasswordHash, hash, s.now()); err != nil {
		return err
	}
	s.audits.Record(ctx, audit.Entry{EntityType: audit.EntityUser, EntityID: user.ID, Action: audit.ActionUpdate,
		After: map[string]any{"password": "changed", "via": "sign-in page"}})
	return nil
}

// CurrentUser loads the user identified by a validated access token subject.
func (s *Service) CurrentUser(ctx context.Context, userID int64) (*domain.User, error) {
	return s.repo.FindByID(ctx, userID)
}

func (s *Service) issueTokens(userID int64) (*TokenPair, error) {
	now := s.now()
	subject := strconv.FormatInt(userID, 10)
	access, err := s.tokens.Generate(subject, crypto.AccessToken, now)
	if err != nil {
		return nil, err
	}

	// Hard-session mode: no refresh token is minted, so the session ends when
	// the access token expires.
	if !s.refreshEnabled {
		return &TokenPair{AccessToken: access}, nil
	}

	refresh, err := s.tokens.Generate(subject, crypto.RefreshToken, now)
	if err != nil {
		return nil, err
	}
	return &TokenPair{AccessToken: access, RefreshToken: refresh}, nil
}
