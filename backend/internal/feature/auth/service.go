package auth

import (
	"context"
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

	if _, err := s.repo.FindByID(ctx, claims.Subject); err != nil {
		return nil, domain.NewUnauthorized("account is no longer active")
	}

	return s.issueTokens(claims.Subject)
}

// CurrentUser loads the user identified by a validated access token subject.
func (s *Service) CurrentUser(ctx context.Context, userID string) (*domain.User, error) {
	return s.repo.FindByID(ctx, userID)
}

func (s *Service) issueTokens(userID string) (*TokenPair, error) {
	now := s.now()
	access, err := s.tokens.Generate(userID, crypto.AccessToken, now)
	if err != nil {
		return nil, err
	}

	// Hard-session mode: no refresh token is minted, so the session ends when
	// the access token expires.
	if !s.refreshEnabled {
		return &TokenPair{AccessToken: access}, nil
	}

	refresh, err := s.tokens.Generate(userID, crypto.RefreshToken, now)
	if err != nil {
		return nil, err
	}
	return &TokenPair{AccessToken: access, RefreshToken: refresh}, nil
}
