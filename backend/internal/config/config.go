// Package config loads and validates all runtime configuration from the
// environment. No configuration value is hardcoded; every setting has an
// explicit env var. Loading fails fast if a required value is missing or
// malformed, so the process never starts in a half-configured state.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// Env identifies the deployment environment. Behaviour that must differ by
// environment (e.g. CORS strictness, error verbosity) keys off this value.
type Env string

const (
	EnvDevelopment Env = "development"
	EnvStaging     Env = "staging"
	EnvProduction  Env = "production"
)

func (e Env) IsProduction() bool { return e == EnvProduction }

// Config is the fully validated application configuration.
type Config struct {
	AppEnv   Env
	Port     string
	LogLevel string

	CORSAllowedOrigins []string

	Database DatabaseConfig
	JWT      JWTConfig

	BcryptCost              int
	AuthRateLimitPerMinute  int
}

type DatabaseConfig struct {
	URL             string
	MaxConns        int32
	MinConns        int32
	MaxConnLifetime time.Duration
}

type JWTConfig struct {
	PrivateKeyPath string
	PublicKeyPath  string
	AccessTTL      time.Duration
	RefreshTTL     time.Duration
	Issuer         string
}

// RefreshEnabled reports whether silent token renewal is allowed. A zero (or
// negative) refresh TTL means the access token is the entire session: once it
// expires the user must log in again.
func (j JWTConfig) RefreshEnabled() bool { return j.RefreshTTL > 0 }

// Load reads configuration from a `.env` file (if present) plus the process
// environment, then validates it. A missing `.env` file is not an error —
// real environments inject vars directly.
func Load() (*Config, error) {
	// Best-effort: production typically injects env vars directly, so a
	// missing .env is expected and non-fatal.
	_ = godotenv.Load()

	cfg := &Config{
		AppEnv:   Env(getEnvDefault("APP_ENV", string(EnvDevelopment))),
		Port:     getEnvDefault("PORT", "4000"),
		LogLevel: getEnvDefault("LOG_LEVEL", "info"),
	}

	origins := strings.TrimSpace(os.Getenv("CORS_ALLOWED_ORIGINS"))
	if origins != "" {
		for _, o := range strings.Split(origins, ",") {
			if trimmed := strings.TrimSpace(o); trimmed != "" {
				cfg.CORSAllowedOrigins = append(cfg.CORSAllowedOrigins, trimmed)
			}
		}
	}

	var err error
	if cfg.Database, err = loadDatabaseConfig(); err != nil {
		return nil, err
	}
	if cfg.JWT, err = loadJWTConfig(); err != nil {
		return nil, err
	}

	if cfg.BcryptCost, err = getEnvInt("BCRYPT_COST", 12); err != nil {
		return nil, err
	}
	if cfg.AuthRateLimitPerMinute, err = getEnvInt("AUTH_RATE_LIMIT_PER_MINUTE", 10); err != nil {
		return nil, err
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func loadDatabaseConfig() (DatabaseConfig, error) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		return DatabaseConfig{}, missing("DATABASE_URL")
	}

	maxConns, err := getEnvInt("DATABASE_MAX_CONNS", 25)
	if err != nil {
		return DatabaseConfig{}, err
	}
	minConns, err := getEnvInt("DATABASE_MIN_CONNS", 2)
	if err != nil {
		return DatabaseConfig{}, err
	}
	lifetime, err := getEnvDuration("DATABASE_MAX_CONN_LIFETIME", time.Hour)
	if err != nil {
		return DatabaseConfig{}, err
	}

	return DatabaseConfig{
		URL:             url,
		MaxConns:        int32(maxConns),
		MinConns:        int32(minConns),
		MaxConnLifetime: lifetime,
	}, nil
}

func loadJWTConfig() (JWTConfig, error) {
	priv := os.Getenv("JWT_PRIVATE_KEY_PATH")
	if priv == "" {
		return JWTConfig{}, missing("JWT_PRIVATE_KEY_PATH")
	}
	pub := os.Getenv("JWT_PUBLIC_KEY_PATH")
	if pub == "" {
		return JWTConfig{}, missing("JWT_PUBLIC_KEY_PATH")
	}

	accessTTL, err := getEnvDuration("JWT_ACCESS_TTL", 15*time.Minute)
	if err != nil {
		return JWTConfig{}, err
	}
	refreshTTL, err := getEnvDuration("JWT_REFRESH_TTL", 168*time.Hour)
	if err != nil {
		return JWTConfig{}, err
	}

	return JWTConfig{
		PrivateKeyPath: priv,
		PublicKeyPath:  pub,
		AccessTTL:      accessTTL,
		RefreshTTL:     refreshTTL,
		Issuer:         getEnvDefault("JWT_ISSUER", "anush-lms"),
	}, nil
}

// validate enforces cross-field invariants that a single env parse cannot.
func (c *Config) validate() error {
	switch c.AppEnv {
	case EnvDevelopment, EnvStaging, EnvProduction:
	default:
		return fmt.Errorf("config: invalid APP_ENV %q (want development|staging|production)", c.AppEnv)
	}

	// bcrypt cost bounds: below 10 is insecure, above 15 is unusably slow.
	if c.BcryptCost < 10 || c.BcryptCost > 15 {
		return fmt.Errorf("config: BCRYPT_COST %d out of safe range [10,15]", c.BcryptCost)
	}

	// A wildcard CORS origin in production would defeat the auth model.
	if c.AppEnv.IsProduction() {
		for _, o := range c.CORSAllowedOrigins {
			if o == "*" {
				return fmt.Errorf("config: wildcard CORS origin is not allowed in production")
			}
		}
		if len(c.CORSAllowedOrigins) == 0 {
			return fmt.Errorf("config: CORS_ALLOWED_ORIGINS must be set in production")
		}
	}

	return nil
}

func getEnvDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) (int, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback, nil
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("config: %s must be an integer, got %q", key, raw)
	}
	return v, nil
}

func getEnvDuration(key string, fallback time.Duration) (time.Duration, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback, nil
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("config: %s must be a duration (e.g. 15m, 1h), got %q", key, raw)
	}
	return d, nil
}

func missing(key string) error {
	return fmt.Errorf("config: required environment variable %s is not set", key)
}
