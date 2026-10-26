package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"time"

	"github.com/anush-capitals/lms-backend/internal/domain"
)

// Two-factor authentication (TOTP), enforced by the server.
//
// Login with two-factor on is two steps: the password check returns a
// single-use challenge token (not a session), and LoginMFA exchanges it plus a
// valid authenticator code for the session. Codes are checked here, never in
// the browser; each 30-second code works once; a challenge allows 5 wrong codes
// and lasts 5 minutes. Code mistakes on /me endpoints are 400s (not 401), so a
// typo never signs the user out.

const (
	mfaIssuer          = "Anush LMS"
	mfaChallengeTTL    = 5 * time.Minute
	mfaMaxWrongCodes   = 5
	mfaChallengeBytes  = 32
	errMFASetupBroken  = "Two-factor could not be checked for this account. Ask an administrator to reset two-factor, then set it up again."
	errMFAExpiredLogin = "This sign-in has expired. Please sign in again."
)

func hashMFAToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

func (s *Service) startMFAChallenge(ctx context.Context, userID int64) (string, error) {
	raw := make([]byte, mfaChallengeBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	if err := s.repo.CreateMFAChallenge(ctx, hashMFAToken(token), userID, s.now().Add(mfaChallengeTTL)); err != nil {
		return "", err
	}
	return token, nil
}

// LoginMFA completes a two-factor login: the challenge from Login plus a valid,
// unused authenticator code issue the session.
func (s *Service) LoginMFA(ctx context.Context, token, code string) (*TokenPair, error) {
	if err := domain.ValidateTOTPCodeInput(code); err != nil {
		return nil, err
	}
	hash := hashMFAToken(token)
	ch, err := s.repo.FindMFAChallenge(ctx, hash)
	if err != nil {
		if de, ok := domain.AsError(err); ok && de.Code == domain.CodeNotFound {
			return nil, domain.NewUnauthorized(errMFAExpiredLogin)
		}
		return nil, err
	}
	now := s.now()
	if now.After(ch.ExpiresAt) {
		_, _ = s.repo.DeleteMFAChallenge(ctx, hash)
		return nil, domain.NewUnauthorized(errMFAExpiredLogin)
	}
	user, err := s.repo.FindByID(ctx, ch.UserID)
	if err != nil {
		_, _ = s.repo.DeleteMFAChallenge(ctx, hash)
		return nil, domain.NewUnauthorized(errMFAExpiredLogin)
	}

	// Two-factor turned off (e.g. an admin reset) after the password was
	// checked: the password step stands, so complete the sign-in.
	if user.MFAEnabled {
		state, err := s.repo.GetMFA(ctx, user.ID)
		if err != nil {
			return nil, err
		}
		if state.SealedSecret == nil {
			return nil, domain.NewConflict(errMFASetupBroken)
		}
		secret, err := s.mfaBox.Open(*state.SealedSecret)
		if err != nil {
			return nil, domain.NewConflict(errMFASetupBroken)
		}
		step, ok := domain.VerifyTOTP(secret, code, now)
		if ok {
			if ok, err = s.repo.ConsumeMFAStep(ctx, user.ID, step); err != nil {
				return nil, err
			}
		}
		if !ok {
			n, err := s.repo.BumpMFAChallenge(ctx, hash)
			if err != nil {
				return nil, domain.NewUnauthorized(errMFAExpiredLogin)
			}
			if n >= mfaMaxWrongCodes {
				_, _ = s.repo.DeleteMFAChallenge(ctx, hash)
				return nil, domain.NewUnauthorized("Too many wrong codes. Please sign in again.")
			}
			return nil, domain.NewUnauthorized("That code is not right, or was already used. Enter the current code from your authenticator app.")
		}
	}

	// Single use: if a concurrent request already used this challenge, stop.
	deleted, err := s.repo.DeleteMFAChallenge(ctx, hash)
	if err != nil {
		return nil, err
	}
	if !deleted {
		return nil, domain.NewUnauthorized(errMFAExpiredLogin)
	}
	pair, err := s.issueTokens(user.ID)
	if err != nil {
		return nil, err
	}
	_ = s.repo.TouchLastLogin(ctx, user.ID, s.now())
	return pair, nil
}

// MFASetup starts two-factor setup: a new secret is generated and stored
// (sealed) as pending; the user adds it to their authenticator app (QR / key)
// and confirms with MFAEnable.
func (s *Service) MFASetup(ctx context.Context, userID int64) (secret, otpauthURI string, err error) {
	user, err := s.repo.FindByID(ctx, userID)
	if err != nil {
		return "", "", err
	}
	if user.MFAEnabled {
		return "", "", domain.NewConflict("Two-factor authentication is already on for this account.")
	}
	secret, err = domain.NewTOTPSecret()
	if err != nil {
		return "", "", err
	}
	sealed, err := s.mfaBox.Seal(secret)
	if err != nil {
		return "", "", err
	}
	if err := s.repo.SetPendingMFASecret(ctx, userID, sealed); err != nil {
		return "", "", err
	}
	return secret, domain.TOTPAuthURI(mfaIssuer, user.Email, secret), nil
}

func wrongCode(msg string) error {
	return domain.NewValidation(msg, map[string]string{"code": msg})
}

// MFAEnable turns two-factor on once a code from the new authenticator entry
// checks out.
func (s *Service) MFAEnable(ctx context.Context, userID int64, code string) error {
	if err := domain.ValidateTOTPCodeInput(code); err != nil {
		return err
	}
	state, err := s.repo.GetMFA(ctx, userID)
	if err != nil {
		return err
	}
	if state.Enabled {
		return domain.NewConflict("Two-factor authentication is already on for this account.")
	}
	if state.SealedSecret == nil {
		return domain.NewValidation("Start the two-factor setup first.", nil)
	}
	secret, err := s.mfaBox.Open(*state.SealedSecret)
	if err != nil {
		return domain.NewValidation("The setup expired. Start the two-factor setup again.", nil)
	}
	step, ok := domain.VerifyTOTP(secret, code, s.now())
	if !ok {
		return wrongCode("That code is not right. Check the time on your phone and enter the current code.")
	}
	return s.repo.EnableMFA(ctx, userID, step)
}

// MFADisable turns two-factor off; it takes a current, unused code, so an
// unattended session alone cannot remove it. Already off = nothing to do.
func (s *Service) MFADisable(ctx context.Context, userID int64, code string) error {
	if err := domain.ValidateTOTPCodeInput(code); err != nil {
		return err
	}
	state, err := s.repo.GetMFA(ctx, userID)
	if err != nil {
		return err
	}
	if !state.Enabled {
		return nil
	}
	if state.SealedSecret == nil {
		return domain.NewConflict(errMFASetupBroken)
	}
	secret, err := s.mfaBox.Open(*state.SealedSecret)
	if err != nil {
		return domain.NewConflict(errMFASetupBroken)
	}
	step, ok := domain.VerifyTOTP(secret, code, s.now())
	if !ok {
		return wrongCode("That code is not right. Enter the current code from your authenticator app.")
	}
	used, err := s.repo.ConsumeMFAStep(ctx, userID, step)
	if err != nil {
		return err
	}
	if !used {
		return wrongCode("That code was already used. Wait for the next code.")
	}
	return s.repo.DisableMFA(ctx, userID)
}
