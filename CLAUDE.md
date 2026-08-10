# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Anush LMS is a loan-management system for Anush Capitals: a **React 18 + TypeScript + Vite** front-end (repo root) and a **Go 1.26 + PostgreSQL** back-end (`backend/`). A companion `AGENTS.md` covers the front-end stack, routes, and file layout at a glance — this file focuses on the non-obvious architecture and domain rules that span multiple files.

## Repository layout

- **Front-end** — repo root (`src/`, `package.json`, `vite.config.ts`).
- **Back-end** — `backend/` (Go module `github.com/anush-capitals/lms-backend`). Self-contained: its own `go.mod`, `Makefile`, `Dockerfile`, `docker-compose.yml`.

Active development is on the `newui` branch.

## Commands

Front-end (run from repo root):
```bash
npm run dev       # Vite dev server on :5173, host exposed to LAN
npm run build     # tsc -b (typecheck) then vite build → dist/. The only real correctness gate.
npm run lint      # eslint
npm run preview   # serve the production build
```
`npm run build` runs `tsc -b` first, so a type error fails the build. Run it before considering a front-end change done. There is no front-end test runner.

Back-end (run from `backend/`):
```bash
make run          # go run ./cmd/server — applies migrations on boot, serves :4000
make build        # compile all binaries into ./bin
make test         # go test ./...   (single package: go test ./internal/domain/ -run TestName -v)
make vet          # go vet ./...
make db-up        # start the Postgres container only
make keys         # generate the RS256 JWT key pair into ./secrets (needed once before `make run`)
make seed-admin   # create/rotate the bootstrap admin (needs ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_FULL_NAME)
```
Full local bring-up from scratch: `make deps && make keys && make db-up && make seed-admin && make run`.

### Docker (one-command full stack)
From `backend/`: `docker compose up --build` starts Postgres **and** the backend. The backend container self-provisions via `docker-entrypoint.sh`: generates JWT keys on first boot, seeds the admin from `ADMIN_*` env vars in `docker-compose.yml`, and runs migrations. This is the path to hand a teammate. The compose file maps Postgres to host **5433** (to avoid clashing with a local Postgres on 5432); the backend still reaches it as `postgres:5432` on the internal network.

## Front-end / back-end integration — the feature flag

The front-end runs against **either** the in-memory mock **or** the real backend, switched by `VITE_USE_API` in `.env.local` (see `src/lib/config.ts`). This flag is the key to understanding data flow:

- **`VITE_USE_API` unset/false** → everything lives in `src/mock/DataContext.tsx` (in-memory, seeded, resets on reload). `Login.tsx` accepts any credentials and dispatches a `demo-token`.
- **`VITE_USE_API=true`** → wired features hit the Go backend through the `/api` proxy (`vite.config.ts` proxies `/api` → `http://localhost:4000`, override with `VITE_API_URL`). Currently **auth and customers (incl. documents)** are wired; loans/collections/expenses still use the mock even in API mode.

`DataContext` is deliberately **API-aware behind the flag**: its `addCustomer`/`updateCustomer`/`deleteCustomer` call `customerApi` when the flag is on, otherwise mutate local state. Pages call `useData()` unchanged either way. When wiring a new feature to the backend, follow this pattern (add a `src/services/xApi.ts`, branch inside the relevant `DataContext` method on `config.useApi`) rather than rewriting pages.

The API client (`src/lib/api.ts`) unwraps the backend's `{ success, data, error, meta }` envelope, attaches the Bearer token from `tokenStore`, and on a **401 forces re-login** (clears token, redirects to `/login`) — there is **no silent refresh** (see session model below). Backend field errors (snake_case) are mapped to form fields in the pages.

## Two independent front-end state systems

State is deliberately split — do not merge them:

- **Redux (`src/store/`)** holds *only* auth (`authSlice`). `ProtectedRoute` reads `auth.accessToken` to gate every route except `/login`. In API mode the token value is a sentinel (`'api'`); the real JWT lives in `tokenStore` (localStorage). `DataContext`'s customer fetch is keyed off `auth.accessToken` so it runs *after* login, not at mount (mounting before auth would 401).
- **`DataContext`** holds *everything else* (all business entities + derived calculations).

Provider nesting (from `main.tsx`): `Redux Provider` → `DataProvider` → `ToastProvider` → `BrowserRouter` → `App`.

## Session model — hard 1-hour, no refresh

Deliberate design (backend `JWT_ACCESS_TTL=1h`, `JWT_REFRESH_TTL=0`): the access token **is** the whole session. At expiry the frontend gets a 401 and redirects to login — there is no silent renewal. Backend `JWTConfig.RefreshEnabled()` gates this; login omits `refresh_token` and returns `expires_in_seconds`; `/auth/refresh` always 401s while disabled. `src/lib/tokenStore.ts` stores only the access token. DB-backed rotating sessions are a possible future upgrade, not built.

## Loan domain model — the core complexity (both sides mirror it)

Six `LoanType`s collapse into **three economic behaviors** — get this wrong and the money math is wrong. The rules live in `src/mock/DataContext.tsx` (frontend) and are mirrored exactly in `backend/internal/domain/loan.go` (verified by `loan_test.go`):

- **daily loans** = `DAILY_COLLECTION` | `DAILY_INTEREST`. Interest deducted upfront (stored as `deduction`); daily payments repay principal.
  - `DAILY_COLLECTION` outstanding = `principal − collected` (principal shrinks as collected).
  - `DAILY_INTEREST` outstanding = `principal + totalDueForDaily` (interest-only; principal fixed, outstanding *rises* above principal when payments fall behind).
- **monthly-like** = `MONTHLY_INTEREST` | `VEHICLE` | `PROPERTY` | `FLEXIBLE`. Recurring interest cycle (30 days for all except `FLEXIBLE`, which uses its own `numDays`). Outstanding = `principal + totalDueForMonthly`.

Key derived helpers (frontend `DataContext`, mirrored on backend `Loan`):
- `elapsedDaysSinceLoan(loanDate)` — calendar days, Day 1 = loan date, uncapped.
- `monthlyCyclesElapsed(loanDate, cycleDays)` — cycles **fallen due**: cycle k falls due at loanDate + k·cycleDays (day k·cycleDays + 1), so it counts from its due day, never a day early (day 30 → 0, day 31 → 1, day 60 → 1, day 61 → 2). Accrual must always match the ledger's cycle rows / nextDue.
- `outstandingFor(loan)` — the type dispatch above; returns 0 for `CLOSED` loans (except `DAILY_COLLECTION`).
- `interest = calcInterest(principal, rate) = round(principal × rate / 100)`.

Extend these helpers rather than recalculating inline in pages, and preserve the three-behavior grouping. **If you change loan math on one side, change it on the other** — the two implementations must stay in lock-step.

## Collections, profit & ledger — binding rules (MANDATORY)

These rules exist because violating any one of them silently corrupts money reporting. Do not weaken them for UX convenience.

1. **Receipt-date rule.** A collection's `date` is when the money was **actually received** — it defaults to today (clamped to ≥ `loanDate`), never to a schedule slot's due date. Allocation of payments to schedule slots is **FIFO from the total pool** — the date NEVER drives allocation, and no guard may force `date ≥ nextDue` (after a bulk payment the next slot sits weeks ahead; forcing receipts there future-dates them and corrupts profit-by-month). Max date stays `max(today+1, nextDue)` (explicit forward-dating allowed, never the default). Applies to both entry points: `LedgerDialog.openRow` and `Collections.tsx onLoanPick/save`.
2. **Profit recognition (profit-last).** Implemented in `Dashboard.tsx profitByCollectionId` — profit is attributed **per collection**, bucketed by its receipt month:
   - *Interest-only behavior* (`behavesInterestOnly`: Daily/Monthly Interest, Flexible, EMI types in monthly-interest mode) → every non-`PRINCIPAL` payment is profit in full; `PRINCIPAL` payments are never profit.
   - *Upfront/EMI behavior* (Daily Collection, EMI-mode Vehicle/Property) → profit = the portion of **cumulative** collections falling in the band `(disbursed, disbursed + margin]`, where `margin = deduction` (Daily) or `interest` (EMI). Early payments recover the disbursed cash (₹0 profit); the tail is profit. Foreclosure needs no special case — the payoff payment crosses the band and carries the remaining margin. Lifetime profit always equals the margin, capped even on overpay.
3. **Ledger display — ONE slot ledger for every loan type** (`rows` in `LedgerDialog.tsx`; `displayRows` is an alias). Each row is a DUE (day / EMI / interest cycle) with **two separate date columns**: `Due Date` (the schedule slot) and `Collection Date` (`paidOn` — the funding payment's actual receipt date). Amounts AND payment records follow **FIFO attribution**: a bulk payment renders as `Paid` on every due it clears, each row carrying the bulk's mode/receipt/edit and its single receipt date (this is deliberate — the retired payment-per-row view hid which dues a bulk covered). Rendered range: all funded slots + every elapsed unpaid slot (`Overdue`) + **one** upcoming `Next due` (suppressed when the last elapsed slot is due today — never two upcoming rows). Every unpaid row on an ACTIVE loan gets an Add action (FIFO makes them equivalent). CLOSED loans **collapse**: only regular-funded rows render, then one `Settled` payoff row — never `Overdue` ghosts after settlement. Editing a payment from a slot row must carry `paidOn` (the receipt date), never the slot's due date.
4. **Edge-case matrix (test before done).** Any change touching collections, ledger rendering, or profit must be re-verified against: each of the three behaviors × {normal cadence, partial payment, bulk/advance payment, payment recorded *after* a bulk (must default to today), overdue, foreclosure/settlement}, plus month-bucketing of profit and same-day ordering (sort by `date`, then `id`). Then run `npm run build`. Fixing one cell of this matrix while breaking another is the historical failure mode here.

## Money is never a float

- **Frontend**: rupees as plain numbers, formatted via `inr()` (`₹1,23,456`, Indian grouping) and `inrShort()` (`₹1.23 Cr` / `₹1.23 L`) from `@/lib/format`.
- **Backend**: `domain.Paise` (int64, integer paise). Rupees appear **only** at the JSON boundary (parsed on input, `.Rupees()` on output). All DB money columns are `BIGINT` paise. Never introduce a float into balance math.

## Dates are string-based, local-time

All dates are `YYYY-MM-DD` strings, **not** `Date` objects. Parse via `s.split('-').map(Number)` and construct `new Date(y, m-1, d)` (local time) — never `new Date(isoString)`, which parses as UTC and shifts the day. `todayISO()` / `fmtDate()` / `isoLocal` follow this; match it. Backend uses `time.Time` normalized to local midnight for the same reason.

## Backend architecture

Layered, dependencies injected from a single composition root (`internal/server/router.go`) — nothing reaches for globals:

- `internal/feature/<name>/{repository,service,handler}.go` — `handler` (HTTP: parse/validate/shape) → `service` (business rules, validation) → `repository` (parameterised pgx SQL). Features: `auth`, `customer`, `document`.
- `internal/domain/` — entities, `Paise` money, loan/customer/document rules, typed `Error` (stable code + client-safe message + HTTP status), validators.
- `internal/{config,logger,crypto,database,httpx}` — env config (fail-fast, no hardcoded secrets), slog JSON logger (redacts sensitive keys), bcrypt + RS256 JWT, pgx pool + embedded migration runner, response envelope + middleware.
- `cmd/{server,genkeys,seedadmin}` — API entry point, key generator, env-driven admin seeder.

Response envelope for every endpoint: `{ success, data?, error?: {code,message,fields?}, meta? }`. Domain errors map to their declared HTTP status; anything else becomes a generic 500 (detail logged, never leaked). Handlers project entities to DTOs that **omit sensitive fields** (`password_hash`; Aadhaar/PAN returned **masked**, e.g. `XXXX-XXXX-1234`, never in full, never logged).

### Migrations & schema
`internal/database/migrations/*.up.sql` are **embedded** in the binary and applied idempotently on boot (each in its own transaction, tracked in `schema_migrations`). To change the schema, add a new numbered migration — never edit an applied one. Tables: `users, customers, loans, collections, expenses, documents, audit_log`. Soft deletes (`deleted_at`) throughout; deletes cascade. Human-readable codes (`CUST-####`, `LN-####`, `RCPT-######`) are minted from Postgres sequences. Document file bytes are stored in-DB as `bytea` (no object store); `audit_log` exists but is not yet written to.

### Validation (industrial-standard, both sides)
`backend/internal/domain/validate.go` is the source of truth; `src/lib/customerValidation.ts` mirrors it for instant inline feedback. Rules include Indian mobile (`^[6-9]\d{9}$`), PAN with holder-type char, **Aadhaar with Verhoeff checksum**, pincode, DOB age 18–100, and state validated against the official list (`internal/domain/india.go`, mirrored in the frontend `INDIAN_STATES`). Keep the two in sync when rules change. Validation has a **create vs update mode**: on update, KYC (Aadhaar/PAN) may be omitted and the stored value is preserved — the "at least one KYC" rule only applies on create.

## Front-end styling & conventions

- Tailwind with `darkMode: 'class'`. Dark mode toggles `.dark` on `<html>` directly in `AppShell` — no theme context, does not persist.
- Theme colors resolve through CSS variables in `src/index.css` exposed to Tailwind as `surface`/`ink`/`muted`. Semantic palette: `primary` (indigo/blue), `success`, `warning`, `danger`. Brand accent is a **blue→violet gradient**. Custom `rounded-card` (18px), `shadow-card`/`soft`/`glow`.
- Compose classes with `cn()` from `@/lib/utils` (clsx + tailwind-merge) so later utilities win.
- Reusable primitives in `src/components/ui/` (shadcn-style, hand-rolled). `Dialog` = centered modal; `Drawer` = right-side slide-over (used for the customer add/edit form). Toasts via `useToast()` (`@/components/ui/toast`), not a library. Animations via Framer Motion.
- Use the `@/` alias for anything under `src/` (configured in `tsconfig.json` and `vite.config.ts`). Avoid relative `../` paths.

## PDF reports
`src/lib/pdfReport.ts` builds loan-ledger PDFs with jsPDF + jspdf-autotable via `buildLedgerReportPDF(ReportParams)`. Callers pass **already-formatted** display strings — the builder does no domain formatting. `LedgerDialog.tsx` is the primary consumer.

## Working conventions (from .cursor/rules)

Note: several files in `.cursor/rules/` were copied from another project (an "orbit" rules/routes engine) and describe tables/architecture that **do not exist here** — ignore their specifics. The genuinely-applicable principles:

- **Stable code**: this is production-stable. Make only the change requested, minimal diff, no speculative fields, no refactoring bundled with fixes, don't weaken tests to make them pass. Run the affected package's tests + build before considering a change done.
- **Never break an existing workflow when adding new logic** (MANDATORY): any new feature/fix must leave every already-working path intact. Before changing shared code (domain helpers like `Outstanding`/`ElapsedDaysSinceLoan`/`IsDailyLoan`, `DataContext` methods, validators, DTOs), check every caller and preserve their behaviour; prefer adding a narrowly-scoped helper over widening a shared one. When a rule changes for one loan type, keep the other types' math unchanged unless explicitly asked. Always run **both** `npm run build` (frontend) **and** `go build ./... && go test ./internal/domain/` (backend) after the change, and re-verify the specific flow you touched still works end-to-end. If a change could alter existing behaviour, call it out explicitly rather than shipping it silently.
- **Schema alignment**: a Go struct field / DB write must correspond to a real column. Add the migration before the code that uses the column.
- **Security**: secrets only via env (documented in `.env.example`, never committed); the backend is the auth authority; never log or expose passwords/tokens/PII; mask KYC; client validation never replaces server validation.

## UI/UX design standards — MANDATORY

**`DESIGN_RULES.md` (repo root) is binding for every user-facing change. Read it before building or editing any UI.** Act as a senior product architect + designer, not just an engineer: build **production-ready, premium** UI (Stripe / Linear / Mercury quality), never plain or template-looking. Think before coding (domain → users → hierarchy → journey → then code), and self-review against the Quality Gate (target ≥ 9.5/10 on visual design, UX, a11y, responsiveness, consistency) — iterate before returning code; never settle for the first pass.

Every screen ships with: strong visual hierarchy, generous spacing, real KPI/cards/charts, empty + loading + error states, hover/focus states, responsive layout, subtle animations, and accessible contrast. **Non-negotiable here:** (1) **honesty over decoration** — never fabricate data to fill a UI (no fake trends/sparklines); (2) **theme tokens only** (`surface`/`ink`/`muted`/`primary`/`success`/`warning`/`danger` + `dark:`) so **light and dark mode both work** — never hardcode `bg-white`/`text-slate-900`; (3) **reuse the system** — `src/components/ui/` primitives, `cn()`, `@/lib/format`, Framer Motion, Lucide; (4) still a **minimal, `npm run build`-verified diff**, and never weaken money/KYC/validation rules for looks.
