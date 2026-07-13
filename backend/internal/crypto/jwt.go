package crypto

import (
	"crypto/rsa"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// TokenType distinguishes access from refresh tokens so a refresh token can
// never be replayed as an access token and vice versa.
type TokenType string

const (
	AccessToken  TokenType = "access"
	RefreshToken TokenType = "refresh"
)

// ErrInvalidToken is returned for any token that fails to parse, verify, or
// validate. It is deliberately generic — callers return 401 without detail.
var ErrInvalidToken = errors.New("crypto: invalid token")

// Claims is the JWT payload. Subject carries the user ID; TokenType guards
// against cross-use.
type Claims struct {
	jwt.RegisteredClaims
	TokenType TokenType `json:"typ"`
}

// TokenManager signs and verifies JWTs using an RS256 key pair. RS256 lets
// the public key be distributed for verification while the private key stays
// on the issuer, and supports key rotation without shared secrets.
type TokenManager struct {
	privateKey *rsa.PrivateKey
	publicKey  *rsa.PublicKey
	issuer     string
	accessTTL  time.Duration
	refreshTTL time.Duration
}

// TokenManagerConfig holds the inputs for constructing a TokenManager. Key
// material is loaded from files whose paths come from configuration; keys are
// never embedded in code.
type TokenManagerConfig struct {
	PrivateKeyPath string
	PublicKeyPath  string
	Issuer         string
	AccessTTL      time.Duration
	RefreshTTL     time.Duration
}

// NewTokenManager loads the RSA key pair from disk and returns a ready
// manager. It fails fast if either key is missing or malformed.
func NewTokenManager(cfg TokenManagerConfig) (*TokenManager, error) {
	privBytes, err := os.ReadFile(cfg.PrivateKeyPath)
	if err != nil {
		return nil, fmt.Errorf("crypto: read private key: %w", err)
	}
	privateKey, err := jwt.ParseRSAPrivateKeyFromPEM(privBytes)
	if err != nil {
		return nil, fmt.Errorf("crypto: parse private key: %w", err)
	}

	pubBytes, err := os.ReadFile(cfg.PublicKeyPath)
	if err != nil {
		return nil, fmt.Errorf("crypto: read public key: %w", err)
	}
	publicKey, err := jwt.ParseRSAPublicKeyFromPEM(pubBytes)
	if err != nil {
		return nil, fmt.Errorf("crypto: parse public key: %w", err)
	}

	return &TokenManager{
		privateKey: privateKey,
		publicKey:  publicKey,
		issuer:     cfg.Issuer,
		accessTTL:  cfg.AccessTTL,
		refreshTTL: cfg.RefreshTTL,
	}, nil
}

// Generate signs a token of the given type for the given user. `now` is
// passed in to keep the function testable and free of hidden clock reads.
func (m *TokenManager) Generate(userID string, tokenType TokenType, now time.Time) (string, error) {
	ttl := m.accessTTL
	if tokenType == RefreshToken {
		ttl = m.refreshTTL
	}

	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			Issuer:    m.issuer,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
		TokenType: tokenType,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	signed, err := token.SignedString(m.privateKey)
	if err != nil {
		return "", fmt.Errorf("crypto: sign token: %w", err)
	}
	return signed, nil
}

// Verify parses and validates a token, confirming the signing algorithm,
// issuer, expiry, and expected token type. It returns the claims on success.
func (m *TokenManager) Verify(tokenString string, expected TokenType) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
		// Reject any algorithm other than the one we sign with — this closes
		// the classic "alg: none" and HS/RS confusion attacks.
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, ErrInvalidToken
		}
		return m.publicKey, nil
	}, jwt.WithIssuer(m.issuer), jwt.WithValidMethods([]string{"RS256"}))

	if err != nil || !token.Valid {
		return nil, ErrInvalidToken
	}
	if claims.TokenType != expected {
		return nil, ErrInvalidToken
	}
	return claims, nil
}
