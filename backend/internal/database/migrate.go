package database

import (
	"context"
	"embed"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// migrationFiles embeds the .up.sql files so migrations ship inside the
// binary — no reliance on the filesystem layout at deploy time.
//
//go:embed migrations/*.up.sql
var migrationFiles embed.FS

// Migrate applies any up-migrations that have not yet been recorded in the
// schema_migrations table. Each file runs inside its own transaction, so a
// failing migration leaves the database in the last-known-good state. This is
// idempotent: already-applied versions are skipped.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`); err != nil {
		return fmt.Errorf("migrate: ensure schema_migrations: %w", err)
	}

	entries, err := migrationFiles.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("migrate: read embedded migrations: %w", err)
	}

	var versions []string
	fileByVersion := map[string]string{}
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".up.sql") {
			continue
		}
		version := strings.TrimSuffix(name, ".up.sql")
		versions = append(versions, version)
		fileByVersion[version] = name
	}
	sort.Strings(versions)

	for _, version := range versions {
		applied, err := isApplied(ctx, pool, version)
		if err != nil {
			return err
		}
		if applied {
			continue
		}
		if err := applyMigration(ctx, pool, version, fileByVersion[version]); err != nil {
			return err
		}
	}
	return nil
}

func isApplied(ctx context.Context, pool *pgxpool.Pool, version string) (bool, error) {
	var exists bool
	err := pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`, version).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("migrate: check version %s: %w", version, err)
	}
	return exists, nil
}

func applyMigration(ctx context.Context, pool *pgxpool.Pool, version, fileName string) error {
	sqlBytes, err := migrationFiles.ReadFile("migrations/" + fileName)
	if err != nil {
		return fmt.Errorf("migrate: read %s: %w", fileName, err)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("migrate: begin tx for %s: %w", version, err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, string(sqlBytes)); err != nil {
		return fmt.Errorf("migrate: exec %s: %w", version, err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO schema_migrations (version) VALUES ($1)`, version); err != nil {
		return fmt.Errorf("migrate: record %s: %w", version, err)
	}

	return tx.Commit(ctx)
}
