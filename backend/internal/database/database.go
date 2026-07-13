// Package database owns the PostgreSQL connection pool and its lifecycle.
// It exposes a single *pgxpool.Pool that repositories depend on; nothing
// else in the codebase constructs a database connection.
package database

import (
	"context"
	"fmt"

	"github.com/anush-capitals/lms-backend/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Connect opens a pgx connection pool using the supplied config and verifies
// connectivity with a ping. It returns an error rather than a partially
// initialised pool.
func Connect(ctx context.Context, cfg config.DatabaseConfig) (*pgxpool.Pool, error) {
	poolCfg, err := pgxpool.ParseConfig(cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("database: parse connection string: %w", err)
	}

	poolCfg.MaxConns = cfg.MaxConns
	poolCfg.MinConns = cfg.MinConns
	poolCfg.MaxConnLifetime = cfg.MaxConnLifetime

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("database: create pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("database: ping failed: %w", err)
	}

	return pool, nil
}
