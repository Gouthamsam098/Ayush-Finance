# Anush LMS — Architecture

A loan-management system for Anush Capitals: a React SPA over a Go/PostgreSQL
API, deployed as four containers behind a single TLS terminator.

Everything below is drawn from the code, not from intent. Where the
implementation has a known gap, it says so.

---

## 1. At a glance

| Layer | Technology | Version | Why it was chosen |
|---|---|---|---|
| UI | React + TypeScript | 18.2 / 5.4 | Component model + compile-time safety on money-handling code |
| Build | Vite | 5.2 | Fast HMR; `tsc -b` runs first so a type error fails the build |
| Styling | Tailwind CSS | 3.4 | Utility-first with theme tokens driving light/dark |
| Routing | React Router | 6.22 | Nested routes; every page lazy-loaded |
| State (auth) | Redux Toolkit | 2.2 | Single source for the session |
| State (domain) | React Context | — | `DataContext` holds all business entities |
| Charts | Recharts | 3.10 | Dashboard KPIs and trends |
| Animation | Framer Motion | 11.18 | Table row/dialog transitions |
| PDF | jsPDF + autotable | 4.2 / 5.0 | Client-side ledger and report PDFs |
| API | Go | 1.26 | Single static binary, ~8 MB resident, no runtime to tune |
| HTTP router | chi | 5.3 | `net/http`-compatible, middleware composition |
| DB driver | pgx | 5.10 | Native protocol, real transactions, connection pooling |
| Database | PostgreSQL | 16 | Integer money, JSONB permissions, partial indexes |
| Auth | RS256 JWT + bcrypt | jwt/v5, cost 12 | Asymmetric tokens; deliberately slow hashing |
| Reverse proxy | Caddy | 2 | Automatic Let's Encrypt, HTTP→HTTPS, HSTS |
| Static serving | nginx | 1.27 | Serves the built SPA with CSP + cache policy |
| Containers | Docker Compose | — | Right-sized for one droplet; no orchestrator |

**Deliberately absent:** Kubernetes, microservices, message queue, Redis, ORM.
At ~10–15 concurrent users these would add operational cost without buying
anything. The architecture avoids decisions that make later scaling *harder*
(see §10).

---

## 2. Runtime topology

```
                          Internet
                             │  :80 / :443 only
                             ▼
                    ┌──────────────────┐
                    │      Caddy       │  TLS termination, HTTP→HTTPS, HSTS
                    └────────┬─────────┘  the ONLY published ports
                   /api/*    │    /*        image:  caddy:2-alpine
              ┌──────────────┴────────────┐ config: backend/Caddyfile
              ▼                           ▼
   ┌────────────────────┐        ┌────────────────────────┐
   │  backend (Go API)  │        │  web (nginx + SPA)     │
   │  :4000  internal   │        │  :8080  internal       │
   └─────────┬──────────┘        └────────────────────────┘
             │                    built by: Dockerfile (repo root)
             │ pgx pool           config:   nginx/nginx.conf
             ▼   built by: backend/Dockerfile
   ┌────────────────────┐
   │  postgres 16       │  internal network only — NO host port published
   │  volume: pgdata    │  image: postgres:16-alpine
   └────────────────────┘

   all four wired together by: backend/docker-compose.prod.yml
```

Only Caddy is reachable from outside. The API, the static server and the
database sit on a private Docker network; the database publishes no host port at
all, so it cannot be reached from the internet even with valid credentials.

---

## 3. Request lifecycle

A payment being recorded, end to end:

```
Browser
  └─ Collections.tsx  ── button disabled while in flight (no double-submit)
       └─ DataContext.addCollection()      branches on config.useApi
            └─ collectionApi.record()      attaches a fresh Idempotency-Key
                 └─ lib/api.ts             adds Bearer token, unwraps envelope
                      │  POST /api/v1/loans/{id}/collections
                      ▼
Caddy ─→ backend
  ├─ RequestID          attaches request_id + a scoped logger
  ├─ AccessLog          one structured line per request (never bodies)
  ├─ Recover            panic → 500, detail logged not leaked
  ├─ audit.Middleware   captures client IP + user agent
  ├─ CORS               explicit origin allowlist (no wildcard in production)
  ├─ Authenticate       verifies the RS256 JWT
  ├─ RequirePermission  module RBAC: view for reads, edit for writes
  └─ collection.Handler ── parse + shape only
       └─ collection.Service ── ONE transaction:
            ├─ SELECT … FOR UPDATE on the loan   (serialises concurrent payments)
            ├─ replay check on the idempotency key
            ├─ domain validation (dates, amount, loan state)
            ├─ INSERT the payment
            ├─ recompute collected → auto-close if settled
            ├─ INSERT the audit row
            └─ COMMIT  (all of it, or none of it)
```

Every write follows the same shape. The transaction boundary lives in the
**service**, never in a handler or a repository.

---

## 4. Backend structure

Layered, with dependencies injected from one composition root
(`internal/server/router.go`). Nothing reaches for globals.

```
cmd/
  server/      API entry point
  genkeys/     generates the RS256 keypair
  seedadmin/   env-driven bootstrap admin

internal/
  domain/      entities, money, loan maths, validation, typed errors  ← no I/O
  feature/<x>/ handler.go → service.go → repository.go
               auth, customer, loan, collection, expense, document, user
  httpx/       response envelope, middleware, RBAC, rate limiting
  crypto/      bcrypt hashing, RS256 JWT
  database/    pgx pool + embedded migration runner
  audit/       append-only trail writer
  logger/      slog JSON logger with redaction
  config/      env loading, fail-fast validation
```

**The layer contract:**

- **handler** — parse the request, shape the response. No business rules.
- **service** — business rules, validation, transaction boundaries.
- **repository** — parameterised SQL only. No decisions.
- **domain** — pure logic, no database, no HTTP. This is what the tests cover.

`domain` importing a feature package, or a handler containing money maths, is an
architecture violation.

### Response envelope

Every endpoint returns the same shape:

```json
{ "success": true,  "data": { … }, "meta": { … } }
{ "success": false, "error": { "code": "VALIDATION_ERROR",
                               "message": "…",
                               "fields": { "pan_number": "…" } } }
```

Domain errors carry a stable code, a client-safe message and an HTTP status.
Anything unrecognised becomes a generic 500 — the detail is logged, never
returned. Handlers project entities to DTOs that omit `password_hash` and return
Aadhaar/PAN **masked** (`XXXX-XXXX-1234`).

---

## 5. The loan domain — the heart of the system

Six loan types collapse into **three economic behaviours**. Getting this wrong
means the money is wrong, so it is implemented once in `domain/loan.go` and
mirrored in the frontend's `DataContext`.

| Behaviour | Types | Interest | Outstanding |
|---|---|---|---|
| **Instalment** | `DAILY_COLLECTION` | Deducted upfront (`deduction`) | `principal − collected` |
| **EMI** | `VEHICLE`, `PROPERTY` (EMI mode) | Added to principal, repaid in EMIs | `principal + interest − collected` |
| **Interest-only** | `DAILY_INTEREST`, `MONTHLY_INTEREST`, `FLEXIBLE`, and Vehicle/Property in monthly-interest mode | Recurs per cycle on the original principal | `remaining principal + accrued unpaid interest` |

`Loan.Outstanding()` is the single dispatch point. Key derived helpers:

- `ElapsedDaysSinceLoan` — calendar days, Day 1 = loan date.
- `MonthlyCyclesElapsed` — cycles **fallen due**. Cycle *k* is due on day
  *k·cadence + 1*, so it never counts a day early. Accrual must always agree
  with the ledger rows the user sees.
- `CalcInterest(principal, rate)` = `round(principal × rate ÷ 100)`.

**Lock-step rule:** the Go and TypeScript implementations must change together.
A test asserts agreement across 24,000 principal/rate combinations.

### Collections, ledger and profit

Three rules that exist because breaking any one silently corrupts reporting:

1. **Receipt-date rule.** A payment's date is when the money *arrived* —
   defaults to today, never a schedule slot's due date. Allocation to slots is
   **FIFO from the pool**; the date never drives it.
2. **Profit recognition (profit-last).** Interest-only behaviours: every
   non-`PRINCIPAL` payment is profit. Upfront/EMI: profit is the slice of
   *cumulative* collections landing in `(disbursed, disbursed + margin]`. Early
   payments recover the cash first; the tail is profit. Foreclosure needs no
   special case.
3. **One slot ledger for every type.** Each row is a due, with **separate
   Due Date and Collection Date columns**, so a bulk payment shows as Paid on
   every due it cleared while revealing the single day the cash arrived.

---

## 6. Money representation

Money is **never** a float.

| Layer | Representation |
|---|---|
| Database | `BIGINT`, whole rupees |
| Go internals | `domain.Paise` — `int64` paise |
| JSON boundary | rupees (parsed in, `.Rupees()` out) |
| Frontend | plain numbers, formatted by `inr()` / `inrShort()` |

`Paise.DBRupees()` **rounds** to the nearest rupee. It must not truncate:
derived values (interest, EMI) legitimately carry paise, and truncating both
lost money and disagreed with the frontend — which computes the same figure in
rupee space with `Math.round`.

---

## 7. Frontend structure

```
src/
  pages/        9 route-level screens (all lazy-loaded)
  components/
    ui/         12 hand-rolled primitives (Dialog, Drawer, Input, DatePicker…)
    dashboard/  KPI cards, charts, gauges
    layout/     AppShell (sidebar, theme), PageHeader
  services/     7 typed API clients, one per backend feature
  lib/          api client, format, validation, pdfReport, permissions
  store/        Redux — auth only
  mock/         DataContext — every business entity + derived maths
  routes/       ProtectedRoute, AdminRoute
```

### Two deliberately separate state systems

- **Redux** holds *only* auth. `ProtectedRoute` gates every route on it. In API
  mode the stored value is a sentinel (`'api'`); the real JWT lives in
  `tokenStore` (localStorage).
- **`DataContext`** holds everything else and is **API-aware behind a flag**: its
  mutators call the relevant `xApi` when `config.useApi` is set, otherwise they
  mutate in-memory state (which starts empty — there is no seed dataset). Pages
  call `useData()` and never know which.

Provider nesting: `Redux → DataProvider → ToastProvider → BrowserRouter → App`.

### The `VITE_USE_API` flag

The SPA runs against either the in-memory mock or the real backend. This is why
the whole UI can be developed and demoed with no database, and why wiring a new
feature means adding a service and branching one `DataContext` method rather
than rewriting pages.

### Bundle strategy

Every authenticated page is `React.lazy`; jsPDF is imported dynamically inside
the export handler. Result: the login path is **~145 KB gzip** instead of the
~435 KB it was when everything shipped in one chunk. `react`/`redux` are pinned
to their own vendor chunks so they survive deploys in the browser cache.

---

## 8. Security model

Layered, with the **server as the sole authority**.

| Concern | Implementation |
|---|---|
| Passwords | bcrypt cost 12 (~500 ms per verify — the login latency is the defence) |
| Sessions | RS256 JWT, hard 1-hour TTL, **no refresh**. Expiry → 401 → re-login |
| Logout | Clears Redux **and** the persisted token (a stale token would restore the session on refresh) |
| RBAC | `RequirePermission` per module: `view` for reads, `edit` for writes; admins bypass. The UI's gating is cosmetic |
| Admin routes | `/users` additionally requires `IsActive` — a deactivated admin loses access immediately, not at token expiry |
| Object-level auth | Documents are scoped by `customer_id` in the SQL; a mismatch is **404**, never 403, so IDs cannot be probed |
| Brute force | Per-IP fixed-window limiter on `/auth/*`, reading the real client IP from `X-Forwarded-For` |
| Uploads | Extension + declared MIME + **magic-byte sniffing**; 5 MiB cap; filenames sanitised of paths, quotes and control characters |
| Downloads | `X-Content-Type-Options: nosniff` so a spoofed file cannot execute in-origin |
| SQL injection | Parameterised pgx queries throughout; no string-built SQL |
| Secrets | Env only, fail-fast at boot. `${VAR:?}` in prod compose aborts a deploy with a missing value |
| Logging | slog JSON with redaction of credentials **and** PII/KYC keys (Aadhaar, PAN, mobile, email, DOB, address) |
| Transport | Caddy: automatic TLS, HTTP→HTTPS, HSTS |
| Browser | CSP, nosniff, frame-deny, referrer policy from nginx; `noindex` + `robots.txt` |
| Audit | Append-only `audit_log` with actor, IP, user agent — written **inside** the payment transaction |

---

## 9. Data model

Seven tables. Soft deletes (`deleted_at`) throughout; human-readable codes
(`CUST-####`, `LN-####`, `RCPT-######`) minted from Postgres sequences.

```
users ──posted_by──┐
                   ▼
customers ──1:N──> loans ──1:N──> collections
    │                                   │
    └──1:N──> documents            audit_log (actor, IP, before/after)
expenses (standalone)
```

- **`users`** — bcrypt hash, `role`, and `permissions` as JSONB (`{"Loans":"edit"}`).
- **`loans`** — stores both inputs (principal, rate) and derived values
  (interest, deduction, disbursed, instalment) so history is reproducible even
  if a formula changes.
- **`collections`** — `kind` splits `INTEREST` (income) from `PRINCIPAL`
  (settlement); `idempotency_key` is unique per loan via a **partial** index, so
  unkeyed rows are unaffected.
- **`documents`** — file bytes as `bytea` (see §10).

Migrations are **embedded in the binary** and applied idempotently on boot, each
in its own transaction, tracked in `schema_migrations`. To change the schema,
add a numbered migration — never edit an applied one.

---

## 10. Known limitations

Honest list. Each is a deliberate trade-off or scheduled work, not an oversight.

| Item | Impact | Direction |
|---|---|---|
| **Documents in Postgres (`bytea`)** | Every backup carries every file; a download buffers up to 5 MB in the API | Move to private object storage (Spaces) with pre-signed URLs; keep the authorization gate in the API |
| **In-process rate limiter** | Counters reset on restart; per-replica | Fine for one container; needs a shared store to scale out |
| **No handler/service tests** | Coverage is domain + middleware + contracts | Add integration tests against a throwaway Postgres |
| **Frontend loads all rows** | `DataContext` fetches full tables | Paginate server-side before a few thousand collections |
| **Keyboard access gaps** | Loans ⋮ menu and DatePicker are mouse-only | Add roving focus + Enter/Space handlers |
| **Single droplet** | No redundancy; a host failure is downtime | Acceptable at this scale with tested backups |

---

## 11. Containerisation and deployment files

Fifteen files define how this application is built, shipped and operated. They
split into two build contexts — the repo root builds the frontend image, and
`backend/` builds the API image and owns the compose files.

### Build definitions

| File | Purpose |
|---|---|
| `Dockerfile` | **Frontend production image.** Two stages: `node:20-alpine` runs `npm ci` + `npm run build`, then `nginx:1.27-alpine` serves only the built `dist/`. Runs as the unprivileged `nginx` user on port **8080** (an unprivileged port is required for non-root), with a `HEALTHCHECK`. No source, no `node_modules`, no source maps reach the final image. |
| `.dockerignore` | Keeps `node_modules`, `.git`, `dist/`, `backend/`, and **`.env*`** out of the build context — without it the whole repo including local secrets is uploaded to the daemon and can be baked into a layer. |
| `backend/Dockerfile` | **API image.** `golang:1.26-alpine` compiles three static binaries (`server`, `genkeys`, `seedadmin`) with `CGO_ENABLED=0`, then copies them into bare `alpine:3.20` with only `ca-certificates`, `wget` and `tzdata`. Final image is a few MB and contains no toolchain. |
| `backend/.dockerignore` | Same idea for the API context. |
| `backend/docker-entrypoint.sh` | First-boot provisioning: generates the RS256 keypair if absent, seeds the admin from `ADMIN_*`, then starts the server. This is why `docker compose up` on a clean machine produces a working, logged-in-able system with no manual steps. |

### Orchestration

| File | Purpose |
|---|---|
| `backend/docker-compose.yml` | **Development.** Postgres + backend only. Publishes Postgres on host **5433** (avoiding a clash with a local 5432) and the API on **4000**. Carries dev credentials in plain text — they are public in this repo and must never be used in production. |
| `backend/docker-compose.prod.yml` | **Production.** Four services: `postgres`, `backend`, `web` (nginx+SPA), `caddy`. Differs from dev deliberately: `APP_ENV=production`; every secret comes from the environment via `${VAR:?}` so a missing value **aborts the deploy** instead of silently falling back to a dev default; Postgres publishes **no host port at all**; only Caddy exposes 80/443; `restart: unless-stopped` throughout; and log rotation caps (10 MB × 3–5) so container logs cannot fill the droplet's disk. |
| `backend/Caddyfile` | TLS terminator and single public entrypoint. Automatic Let's Encrypt, HTTP→HTTPS, HSTS, and routing: `/api/*` → backend, everything else → the SPA. Forwards the real client IP as `X-Real-IP` so the rate limiter and access log attribute requests to the caller, not the proxy. |
| `nginx/nginx.conf` | Serves the SPA: SPA history fallback, gzip, hard caching on content-hashed assets but **`no-store` on `index.html`** (a cached index pins users to deleted asset hashes after a deploy), and the browser security headers — CSP, `nosniff`, frame-deny, referrer and permissions policy. HSTS is deliberately *not* set here; it belongs on Caddy, which knows the request actually arrived over TLS. |

### Configuration and operations

| File | Purpose |
|---|---|
| `.env.example` | Frontend template. Documents that every `VITE_*` value is **inlined into the public bundle** and therefore not a secret. |
| `backend/.env.example` | Backend development template. |
| `backend/.env.production.example` | Production template with `openssl rand` commands for generating real secrets, and a warning not to copy anything from the dev compose file. |
| `backend/Makefile` | Local workflow: `keys`, `db-up`, `seed-admin`, `run`, `test`, `vet`, `build`. |
| `backend/scripts/backup-db.sh` | Nightly `pg_dump` (custom format), a **`pg_restore --list` integrity check** — a dump that cannot be read is not a backup — and retention pruning. Includes the reminder that a backup on the same droplet is not a backup. |
| `.github/workflows/ci.yml` | Three jobs: frontend (`tsc` + `vite build`), backend (`go vet`, `go build`, `go test -race`), and security (`npm audit`, `govulncheck`, gitleaks over full history). |

### Image sizing rationale

Both images are multi-stage on purpose. The build stage carries a Node or Go
toolchain worth hundreds of megabytes; the runtime stage carries only the
artefact. That keeps the deployed images small, shortens deploys on a modest
droplet, and — more importantly — removes compilers and package managers from
the running container, so an attacker who gets code execution finds no tooling.

---

## 12. Development and deployment

```bash
# Frontend (repo root)
npm run dev        # Vite on :5173, /api proxied to :4000
npm run build      # tsc -b && vite build  ← the correctness gate

# Backend (backend/)
make keys && make db-up && make seed-admin && make run
make test          # go test ./...
docker compose up --build          # full local stack
```

**Production:** `docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build`
— see `DEPLOYMENT.md` for droplet hardening, firewall, DNS, backups and the
restore drill.

**CI** (`.github/workflows/ci.yml`) gates every push on: `tsc` + `vite build`,
`go vet`, `go build`, `go test -race`, plus `npm audit`, `govulncheck` and a
gitleaks secret scan over full history.

### Verification gates before any change ships

1. `npm run build` — typecheck + bundle
2. `go build ./... && go vet ./... && go test -race ./...`
3. The **loan edge-case matrix**: three behaviours × {normal, partial, bulk,
   post-bulk, overdue, foreclosure}, plus profit month-bucketing and same-day
   ordering

Fixing one cell of that matrix while breaking another is the documented
historical failure mode in this codebase.
