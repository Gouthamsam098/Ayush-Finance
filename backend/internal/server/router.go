// Package server wires configuration, dependencies, and routes into a single
// http.Handler. It is the composition root: every dependency is constructed
// here and injected downward, so nothing else reaches for globals.
package server

import (
	"log/slog"
	"net/http"

	"github.com/anush-capitals/lms-backend/internal/config"
	"github.com/anush-capitals/lms-backend/internal/crypto"
	"github.com/anush-capitals/lms-backend/internal/feature/auth"
	"github.com/anush-capitals/lms-backend/internal/feature/collection"
	"github.com/anush-capitals/lms-backend/internal/feature/customer"
	"github.com/anush-capitals/lms-backend/internal/feature/document"
	"github.com/anush-capitals/lms-backend/internal/feature/expense"
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

	collectionService := collection.NewService(collectionRepo, loanRepo)
	collectionHandler := collection.NewHandler(collectionService)

	expenseRepo := expense.NewRepository(deps.Pool)
	expenseService := expense.NewService(expenseRepo)
	expenseHandler := expense.NewHandler(expenseService)

	userRepo := user.NewRepository(deps.Pool)
	userService := user.NewService(userRepo, deps.Hasher)
	userHandler := user.NewHandler(userService)

	r := chi.NewRouter()

	// Global middleware, outermost first.
	r.Use(httpx.RequestID(deps.Logger))
	r.Use(httpx.AccessLog)
	r.Use(httpx.Recover)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   deps.Config.CORSAllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type", "X-Request-ID"},
		ExposedHeaders:   []string{"X-Request-ID"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Unauthenticated liveness probe.
	r.Get("/health", func(w http.ResponseWriter, req *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Route("/api/v1", func(api chi.Router) {
		api.Mount("/auth", authHandler.PublicRoutes())

		// Everything below requires a valid access token.
		api.Group(func(protected chi.Router) {
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
			protected.Mount("/users", userHandler.Routes()) // admin-only, guarded in handler
		})
	})

	return r
}
