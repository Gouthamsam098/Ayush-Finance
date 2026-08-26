# Anush LMS Backend

Go + PostgreSQL backend for the Anush LMS loan-management system. Implements
the contract described in [`../BACKEND_ARCHITECTURE.md`](../BACKEND_ARCHITECTURE.md).

## Stack

- **Go 1.26**, standard library `net/http` + [chi](https://github.com/go-chi/chi) router
- **PostgreSQL 16** via [pgx](https://github.com/jackc/pgx)
- **JWT (RS256)** access/refresh tokens, **bcrypt** password hashing
- Structured JSON logging via stdlib `slog` (sensitive fields auto-redacted)

## Design principles

- **No hardcoded configuration or secrets.** Everything is read from the
  environment (see `.env.example`); the loader fails fast on missing/invalid
  values. JWT keys are loaded from files whose paths are configured, never
  embedded.
- **Money is never a float.** Amounts are stored and computed as integer
  `Paise` (`int64`); rupees only appear at the JSON boundary.
- **Layered:** `handler` (HTTP) → `service` (business rules) → `repository`
  (parameterised SQL) → PostgreSQL. Dependencies are injected from a single
  composition root (`internal/server`).
- **Client-safe errors.** Domain errors carry a stable code + safe message;
  everything else becomes a generic 500 with the detail logged server-side.
- **Soft deletes + audit-ready.** Financial rows are never physically removed.

## Project layout

```
backend/
├── cmd/
│   ├── server/      # API entry point (migrates on boot, graceful shutdown)
│   ├── genkeys/     # generate the RS256 JWT key pair
│   └── seedadmin/   # create/rotate the bootstrap admin (env-driven)
├── internal/
│   ├── config/      # env-based config loader + validation
│   ├── logger/      # slog JSON logger with sensitive-field redaction
│   ├── crypto/      # bcrypt + JWT (RS256)
│   ├── database/    # pgx pool + embedded migration runner
│   ├── domain/      # entities, money (paise), loan calculations, errors
│   ├── httpx/       # response envelope, JSON decode, middleware
│   ├── feature/
│   │   ├── auth/     # login, refresh, /me
│   │   └── customer/ # customer CRUD
│   └── server/      # router / composition root
└── migrations/ (embedded under internal/database/migrations)
```

## Quick start

```bash
# 1. Install deps and generate JWT keys
make deps
make keys

# 2. Copy env and start PostgreSQL
cp .env.example .env      # adjust values as needed
make db-up

# 3. Create the first admin (credentials via env, never hardcoded)
ADMIN_EMAIL=admin@anushcapitals.com \
ADMIN_PASSWORD='<choose-a-strong-password-min-12-chars>' \
ADMIN_FULL_NAME='Admin User' \
make seed-admin

# 4. Run the server (migrations apply automatically on boot)
make run
```

## Verify

```bash
# Health
curl localhost:4000/health

# Login → returns access_token + refresh_token
curl -X POST localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@anushcapitals.com","password":"<your-admin-password>"}'

# Authenticated request
curl localhost:4000/api/v1/me -H "Authorization: Bearer <access_token>"
```

## Endpoints (Phase 1)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET    | `/health` | — | Liveness probe |
| POST   | `/api/v1/auth/login` | — | Email/password login |
| POST   | `/api/v1/auth/refresh` | — | Exchange refresh token |
| GET    | `/api/v1/me` | ✔ | Current user profile |
| POST   | `/api/v1/customers` | ✔ | Create customer |
| GET    | `/api/v1/customers` | ✔ | List (paginated, searchable) |
| GET    | `/api/v1/customers/{id}` | ✔ | Get one |
| PATCH  | `/api/v1/customers/{id}` | ✔ | Update |
| DELETE | `/api/v1/customers/{id}` | ✔ | Soft delete |

Next phases (loans, collections, expenses, documents, reports) follow the same
layering — see the architecture document.

## Testing

```bash
make test   # unit tests: loan calculations, money, JWT round-trip
make vet
```
