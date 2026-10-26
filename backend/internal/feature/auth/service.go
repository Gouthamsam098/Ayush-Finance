package auth

import (
	"context"
	"strconv"
	"sync"
	"time"

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

func NewService(repo *Repository, hasher *crypto.Hasher, tokens *crypto.TokenManager, now Clock, refreshEnabled bool, accessTTL time.Duration) *Service {
	return &Service{repo: repo, hasher: hasher, tokens: tokens, now: now, refreshEnabled: refreshEnabled, accessTTL: accessTTL}
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

// Login verifies credentials and issues a token pair. To avoid leaking which
// accounts exist, both "no such user" and "wrong password" return the same
// generic unauthorized error.
func (s *Service) Login(ctx context.Context, email, password string) (*TokenPair, *domain.User, error) {
	user, err := s.repo.FindByEmail(ctx, email)
	if err != nil {
		if de, ok := domain.AsError(err); ok && de.Code == domain.CodeNotFound {
			s.equalizeUnknownUser(password)
			return nil, nil, domain.NewUnauthorized("invalid email or password")
		}
		return nil, nil, err
	}

	if err := s.hasher.Compare(user.PasswordHash, password); err != nil {
		return nil, nil, domain.NewUnauthorized("invalid email or password")
	}

	pair, err := s.issueTokens(user.ID)
	if err != nil {
		return nil, nil, err
	}

	// Best-effort: a failure to record the login timestamp must not fail the
	// login itself, but it is logged by the caller via the returned error path
	// only when fatal. Here we ignore a non-fatal update error deliberately.
	_ = s.repo.TouchLastLogin(ctx, user.ID, s.now())

	return pair, user, nil
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

	if _, err := s.repo.FindByID(ctx, subjectID); err != nil {
		return nil, domain.NewUnauthorized("account is no longer active")
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
func (s *Service) ChangePassword(ctx context.Context, userID int64, in domain.PasswordChangeInput) error {
	if err := in.Validate(); err != nil {
		return err
	}
	user, err := s.repo.FindByID(ctx, userID)
	if err != nil {
		return err
	}
	if err := s.hasher.Compare(user.PasswordHash, in.Current); err != nil {
		return domain.NewValidation("Current password is incorrect",
			map[string]string{"current_password": "Current password is incorrect"})
	}
	hash, err := s.hasher.Hash(in.New)
	if err != nil {
		return err
	}
	return s.repo.UpdatePassword(ctx, userID, user.PasswordHash, hash)
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
	user, err := s.repo.FindByEmail(ctx, email)
	if err != nil {
		if de, ok := domain.AsError(err); ok && de.Code == domain.CodeNotFound {
			s.equalizeUnknownUser(in.Current)
			return bad
		}
		return err
	}
	if err := s.hasher.Compare(user.PasswordHash, in.Current); err != nil {
		return bad
	}
	hash, err := s.hasher.Hash(in.New)
	if err != nil {
		return err
	}
	return s.repo.UpdatePassword(ctx, user.ID, user.PasswordHash, hash)
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
