// Package server wires configuration, dependencies, and routes into a single
// http.Handler. It is the composition root: every dependency is constructed
// here and injected downward, so nothing else reaches for globals.
package server

import (
	"log/slog"
	"net/http"

	"github.com/anush-capitals/lms-backend/internal/audit"
	"github.com/anush-capitals/lms-backend/internal/config"
	"github.com/anush-capitals/lms-backend/internal/crypto"
	"github.com/anush-capitals/lms-backend/internal/feature/auth"
	"github.com/anush-capitals/lms-backend/internal/feature/collection"
	"github.com/anush-capitals/lms-backend/internal/feature/customer"
	"github.com/anush-capitals/lms-backend/internal/feature/document"
	"github.com/anush-capitals/lms-backend/internal/feature/expense"
	"github.com/anush-capitals/lms-backend/internal/feature/investment"
	"github.com/anush-capitals/lms-backend/internal/feature/loan"
	"github.com/anush-capitals/lms-backend/internal/feature/user"
	"github.com/anush-capitals/lms-backend/internal/httpx"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Dependencies bundles the constructed collaborators the router needs.
type Dependencies struct {
	Config *config.Config
	Logger *slog.Logger
	Pool   *pgxpool.Pool
	Tokens *crypto.TokenManager
	Hasher *crypto.Hasher
	Now    auth.Clock
}

// NewRouter builds the full HTTP handler with global middleware, a public
// health check, public auth routes, and protected business routes.
func NewRouter(deps Dependencies) http.Handler {
	authRepo := auth.NewRepository(deps.Pool)
	authService := auth.NewService(authRepo, deps.Hasher, deps.Tokens, deps.Now,
		deps.Config.JWT.RefreshEnabled(), deps.Config.JWT.AccessTTL)
	authHandler := auth.NewHandler(authService)

	customerRepo := customer.NewRepository(deps.Pool)
	customerService := customer.NewService(customerRepo)
	customerHandler := customer.NewHandler(customerService)

	documentRepo := document.NewRepository(deps.Pool)
	documentService := document.NewService(documentRepo)
	documentHandler := document.NewHandler(documentService)

	collectionRepo := collection.NewRepository(deps.Pool)

	loanRepo := loan.NewRepository(deps.Pool)
	// The loan service reads collected totals so outstanding/close reflect real
	// payments; collectionRepo.SumByLoan/SumByLoans satisfy loan.CollectedReader.
	loanService := loan.NewService(loanRepo, collectionRepo)
	loanHandler := loan.NewHandler(loanService)

	// Append-only trail for money movements (audit_log). Passed into the
	// collection service so a payment and its audit row commit atomically.
	auditor := audit.New(deps.Pool)

	collectionService := collection.NewService(collectionRepo, loanRepo, auditor)
	collectionHandler := collection.NewHandler(collectionService)

	expenseRepo := expense.NewRepository(deps.Pool)
	expenseService := expense.NewService(expenseRepo)
	expenseHandler := expense.NewHandler(expenseService)

	// Investor capital + the interest payouts it costs. Paying interest writes
	// the payout and its expense in ONE transaction (see investment.Service).
	investmentRepo := investment.NewRepository(deps.Pool)
	investmentService := investment.NewService(investmentRepo)
	investmentHandler := investment.NewHandler(investmentService)

	userRepo := user.NewRepository(deps.Pool)
	userService := user.NewService(userRepo, deps.Hasher)
	userHandler := user.NewHandler(userService)

	r := chi.NewRouter()

	// Global middleware, outermost first.
	r.Use(httpx.RequestID(deps.Logger))
	r.Use(httpx.AccessLog)
	r.Use(httpx.Recover)
	// Captures client IP + user agent for audit entries (no headers, no body).
	r.Use(audit.Middleware)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: deps.Config.CORSAllowedOrigins,
		AllowedMethods: []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
		// Idempotency-Key must be allow-listed or the browser's preflight blocks
		// the payment write that carries it.
		AllowedHeaders:   []string{"Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key"},
		ExposedHeaders:   []string{"X-Request-ID"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Unauthenticated liveness probe.
	r.Get("/health", func(w http.ResponseWriter, req *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Route("/api/v1", func(api chi.Router) {
		// Auth routes are public and unauthenticated, so they are the one place
		// an attacker can hammer freely — rate limit them per client IP using
		// the already-configured AUTH_RATE_LIMIT_PER_MINUTE (which was loaded
		// but never enforced, leaving login open to unlimited brute force).
		api.With(httpx.RateLimit(deps.Config.AuthRateLimitPerMinute)).
			Mount("/auth", authHandler.PublicRoutes())

		// Everything below requires a valid access token.
		api.Group(func(protected chi.Router) {
			// Authenticated traffic is throttled too, on its own much larger
			// budget (API_RATE_LIMIT_PER_MINUTE). Authentication alone did not
			// bound volume: a single valid token could enumerate customers or
			// pull every KYC document as fast as the network allowed. Applied
			// BEFORE Authenticate so that flood traffic is rejected without
			// spending a token verification on each request.
			protected.Use(httpx.RateLimit(deps.Config.APIRateLimitPerMinute))
			protected.Use(httpx.Authenticate(deps.Tokens))
			// Protected auth routes live under /me; the public /auth mount
			// (login, refresh) owns the /auth path already.
			// perm wraps a mount with RBAC for the given module (view for reads,
			// edit for writes; admins bypass). authRepo.FindByID loads role+perms.
			perm := func(module string) func(http.Handler) http.Handler {
				return httpx.RequirePermission(module, authRepo.FindByID)
			}

			protected.Mount("/me", authHandler.ProtectedRoutes())
			protected.With(perm("Customers")).Mount("/customers", customerHandler.Routes())
			protected.With(perm("Documents")).Mount("/customers/{customerId}/documents", documentHandler.Routes())
			protected.With(perm("Loans")).Mount("/loans", loanHandler.Routes())
			protected.With(perm("Collections")).Mount("/loans/{loanId}/collections", collectionHandler.LoanRoutes())
			protected.With(perm("Collections")).Mount("/collections", collectionHandler.FlatRoutes())
			protected.With(perm("Expenses")).Mount("/expenses", expenseHandler.Routes())
			// Gated on Expenses: every interest payout IS an expense write, so
			// anyone who may record investor interest already needs that right.
			protected.With(perm("Expenses")).Mount("/investments", investmentHandler.Routes())
			protected.Mount("/users", userHandler.Routes()) // admin-only, guarded in handler
		})
	})

	return r
}
