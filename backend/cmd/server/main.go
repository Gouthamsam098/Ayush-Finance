// Command server is the Anush LMS backend entry point. It loads configuration,
// establishes dependencies, runs migrations, and serves the HTTP API with
// graceful shutdown.
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/anush-capitals/lms-backend/internal/config"
	"github.com/anush-capitals/lms-backend/internal/crypto"
	"github.com/anush-capitals/lms-backend/internal/database"
	"github.com/anush-capitals/lms-backend/internal/logger"
	"github.com/anush-capitals/lms-backend/internal/server"
)

func main() {
	if err := run(); err != nil {
		// Fall back to the default logger; config/logger may not be ready yet.
		logger.New("error").Error("fatal", "error", err.Error())
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	log := logger.New(cfg.LogLevel)
	log.Info("starting anush-lms backend", "env", cfg.AppEnv, "port", cfg.Port)

	// Root context cancelled on SIGINT/SIGTERM for graceful shutdown.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := database.Connect(ctx, cfg.Database)
	if err != nil {
		return err
	}
	defer pool.Close()
	log.Info("database connected")

	if err := database.Migrate(ctx, pool); err != nil {
		return err
	}
	log.Info("migrations applied")

	tokens, err := crypto.NewTokenManager(crypto.TokenManagerConfig{
		PrivateKeyPath: cfg.JWT.PrivateKeyPath,
		PublicKeyPath:  cfg.JWT.PublicKeyPath,
		Issuer:         cfg.JWT.Issuer,
		AccessTTL:      cfg.JWT.AccessTTL,
		RefreshTTL:     cfg.JWT.RefreshTTL,
	})
	if err != nil {
		return err
	}

	handler := server.NewRouter(server.Dependencies{
		Config: cfg,
		Logger: log,
		Pool:   pool,
		Tokens: tokens,
		Hasher: crypto.NewHasher(cfg.BcryptCost),
		Now:    time.Now,
	})

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	serverErr := make(chan error, 1)
	go func() {
		log.Info("http server listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	select {
	case err := <-serverErr:
		return err
	case <-ctx.Done():
		log.Info("shutdown signal received, draining connections")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}
