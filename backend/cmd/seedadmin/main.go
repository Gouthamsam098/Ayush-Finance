// Command seedadmin creates (or updates the password of) an operator account
// using credentials supplied via environment variables. It exists so the
// first login is possible without hardcoding a password anywhere in code or
// migrations. Intended to be run once during provisioning.
//
// Required env: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_FULL_NAME, DATABASE_URL,
// BCRYPT_COST (optional, defaults via config).
//
// --if-missing creates the account only when it does not exist yet and never
// touches an existing one. The container entrypoint uses it on every start, so
// a password the admin changed in the app is not silently reset to
// ADMIN_PASSWORD (which would also bring the old, env-file password back).
// Run without the flag to deliberately reset the admin password (e.g. a
// lost password): `docker compose exec backend /app/seedadmin`.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/anush-capitals/lms-backend/internal/config"
	"github.com/anush-capitals/lms-backend/internal/crypto"
	"github.com/anush-capitals/lms-backend/internal/database"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "seedadmin:", err)
		os.Exit(1)
	}
}

func run() error {
	ifMissing := flag.Bool("if-missing", false, "create the admin only if the account does not exist")
	flag.Parse()

	email := strings.ToLower(strings.TrimSpace(os.Getenv("ADMIN_EMAIL")))
	password := os.Getenv("ADMIN_PASSWORD")
	fullName := strings.TrimSpace(os.Getenv("ADMIN_FULL_NAME"))

	if email == "" || password == "" || fullName == "" {
		return fmt.Errorf("ADMIN_EMAIL, ADMIN_PASSWORD, and ADMIN_FULL_NAME must all be set")
	}
	if len(password) < 12 {
		return fmt.Errorf("ADMIN_PASSWORD must be at least 12 characters")
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx := context.Background()
	pool, err := database.Connect(ctx, cfg.Database)
	if err != nil {
		return err
	}
	defer pool.Close()

	// Apply migrations first so the users table exists on a brand-new database.
	// Migrate is idempotent (tracked in schema_migrations), so this is safe even
	// when the server has already applied them.
	if err := database.Migrate(ctx, pool); err != nil {
		return err
	}

	var existing string
	err = pool.QueryRow(ctx, `SELECT password_hash FROM users WHERE email = $1`, email).Scan(&existing)
	exists := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if *ifMissing && exists {
		fmt.Printf("admin user %q already exists — left unchanged\n", email)
		return nil
	}

	hasher := crypto.NewHasher(cfg.BcryptCost)
	hash, err := hasher.Hash(password)
	if err != nil {
		return err
	}

	// When the stored password already is this one, keep it: re-stamping it
	// would end the admin's sessions for nothing (a password change ends all
	// sessions).
	if exists && hasher.Compare(existing, password) == nil {
		hash = existing
	}

	// Upsert on email: re-running rotates the password rather than erroring.
	// The bootstrap account is always an ADMIN (RBAC). A real rotation ends the
	// account's existing sessions.
	_, err = pool.Exec(ctx, `
		INSERT INTO users (email, full_name, password_hash, role, is_active)
		VALUES ($1, $2, $3, 'ADMIN', TRUE)
		ON CONFLICT (email) DO UPDATE
		SET password_hash       = EXCLUDED.password_hash,
		    password_changed_at = CASE WHEN users.password_hash = EXCLUDED.password_hash
		                               THEN users.password_changed_at ELSE now() END,
		    full_name           = EXCLUDED.full_name,
		    role                = 'ADMIN',
		    is_active           = TRUE,
		    updated_at          = now()`,
		email, fullName, hash,
	)
	if err != nil {
		return err
	}

	fmt.Printf("admin user %q ready\n", email)
	return nil
}
