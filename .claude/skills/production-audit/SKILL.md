---
name: production-audit
description: Complete, hostile, production-grade readiness review of the entire finance application (security, financial integrity, database, API, frontend, infra). Audit-first — produces a severity-ranked report and fix plan; NEVER modifies code until the user approves the fixes. Use before any production deployment, before exposing the app to the internet, or when the user asks "is this production ready?" / "full audit" / "security review of everything".
---

# COMPLETE FINANCE APPLICATION — PRODUCTION READINESS CODE REVIEW

You are acting as a **Senior Software Architect + Senior Backend Engineer + Senior Frontend Engineer + DevSecOps Engineer + Database Engineer + QA/SDET + Security Auditor**.

This application was developed largely using AI. Perform a **complete, hostile, production-grade code review of the ENTIRE codebase**.

Do NOT assume AI-generated code is correct. Do NOT make changes immediately. First inspect, understand, map, and audit the complete application. Then produce findings grouped by severity. Only after the user approves the fixes may you modify code.

---

## 0. THIS REPOSITORY — ground truth to audit against

(Verify all of this from source — it may have drifted since this skill was written.)

- **Stack**: React 18 + TypeScript + Vite frontend (repo root, `src/`); Go 1.26 backend (`backend/`, module `github.com/anush-capitals/lms-backend`); PostgreSQL (Docker, host port 5433); Docker Compose full stack in `backend/`.
- **Architecture**: Frontend → `/api` proxy → Go API (`:4000`, routes under `/api/v1`) → chi router (`backend/internal/server/router.go` is the composition root) → feature packages `internal/feature/<name>/{handler,service,repository}.go` → pgx → Postgres. Domain rules in `internal/domain/` (money = `Paise` int64; loan math in `loan.go` mirrored by `src/mock/DataContext.tsx` — the two MUST stay in lock-step).
- **Auth**: bcrypt + RS256 JWT, hard 1-hour session, NO refresh (`/auth/refresh` 401s by design). Frontend token in `src/lib/tokenStore.ts` (localStorage) — flag the XSS/token-storage tradeoff explicitly (§10).
- **RBAC**: `httpx.RequirePermission` — view for GET/HEAD/OPTIONS, edit for writes, admins bypass; per-module permissions on users. Frontend mirrors via `src/lib/permissions.ts` (cosmetic only — backend is authority). Audit EVERY mounted route for the middleware, and `/users` for its admin-only guard.
- **Documents**: stored **in-DB as `bytea`** (no object store). §5/§14/§40's signed-URL/object-storage guidance is therefore an ARCHITECTURE RECOMMENDATION here, not a config check — audit size limits, MIME/extension validation, download authorization (IDOR by customerId/documentId), and DB bloat/backup implications instead.
- **Money**: backend integer paise everywhere, rupees only at the JSON boundary; frontend plain-number rupees via `inr()`. ANY float in balance math is a CRITICAL finding.
- **Dates**: `YYYY-MM-DD` strings parsed as LOCAL time on both sides (never `new Date(isoString)`); backend normalizes to local midnight. Audit for UTC-shift bugs and timezone assumptions (server TZ vs IST).
- **Migrations**: embedded in the binary, applied idempotently on boot (`internal/database/migrations/*.up.sql`); never edit an applied one. `audit_log` table EXISTS BUT IS NOT WRITTEN TO — a standing §21 finding until wired.
- **Binding money rules**: CLAUDE.md sections "Loan domain model", "Collections, profit & ledger" (receipt-date rule, FIFO allocation, profit-last band, slot-ledger contract, edge-case matrix). Verify code still conforms; violations are HIGH+.
- **Verification commands** (run them; do not claim results you didn't produce):
  - Frontend: `npm run build` (tsc + vite — the only frontend gate; there is no FE test runner)
  - Backend: `go build ./... && go test ./... && go vet ./...` (from `backend/`)
  - Stack: `docker compose up -d --build` (from `backend/`); health at `GET /health`
  - Live probes: login via `POST /api/v1/auth/login`; RBAC/IDOR probes with a created viewer user against every module.
- **Deploy target**: DigitalOcean, ~10–15 concurrent users initially, India-wide, public internet, real financial data + KYC documents (Aadhaar/PAN — masked in DTOs, never logged; verify).

**Execution note**: this audit is large — fan out phases to subagents where available (one per phase below), then consolidate and adversarially verify every CRITICAL/HIGH finding against actual code before reporting.

**Coverage checklist — sections that get skipped when fanning out.** A previous run of this skill dispatched agents for security/DB/documents/frontend-security/infra and silently left these unexamined. Assign them explicitly, or state why they don't apply:

| Section | Must produce |
|---|---|
| §11, §47 responsive | Verdict at 360/375/390/414/768px on the wide data tables (Collections/Loans/Customers) and `LedgerDialog` (now `max-w-6xl`) |
| §48 browser compat | Grep for modern APIs (`structuredClone`, `Array.at`, `.findLast`, `crypto.randomUUID`, `:has()`, `showPicker`) + the Vite build target |
| §49 accessibility | Keyboard operability of the custom action menus/dialogs, focus trap + restoration, input labels, error association, and **status conveyed by colour alone** (Overdue/Paid/Partial badges) |
| §13 frontend perf | Which deps dominate the bundle, whether routes are lazy-loaded, `createObjectURL` without `revokeObjectURL`, effect cleanup |
| §24 auth UX | The 401 path mid-form, multi-tab, refresh-restore, and whether any warning precedes the hard 1-hour cutoff |
| §28 edge cases (frontend) | Double-click submit guards on every money form, empty/zero/huge values, long-name layout breakage |
| §29 dates (frontend) | `new Date("string")` and `toISOString()` misuse, month-end/leap-year in `src/lib/format.ts` |
| §37 API docs | Whether an OpenAPI spec exists **for this backend** (ignore any spec under `orbit/` — that's an unrelated vendored project) |
| §17 git history | `git log --all --diff-filter=A --name-only` filtered for `.env`/`.pem`/`.key`/`id_rsa` — a secret ever committed is compromised and needs rotation |
| §50 SEO | `public/robots.txt` must `Disallow: /` — this app has no public pages and must never be indexed |
| §30, §31 quality | Largest files as complexity hotspots; confirm money math has not leaked into `src/pages/**` |

**Empirical verification beats reading.** Where a numeric claim is possible, prove it: for money findings, write a throwaway Go/JS harness that runs the real formula under the **real validation constraints** and report the actual loss rate and worst case. (Example: `DBRupees()` truncation looks unbounded until you apply the both-sides "rate ≤ 2 decimals" rule, which caps it at exactly 50 paise on 25% of loans — severity changes accordingly.) For a guard test on a vulnerability you just fixed, **mutation-test it**: reintroduce the bug, confirm the test fails, restore, confirm it passes.

---

## 1. PRIMARY OBJECTIVE

Determine whether this application is safe and ready for: real users, real financial data, sensitive personal information, user-specific documents, internet/public access, mobile/tablet/desktop usage, India-wide users, potential future worldwide access, production deployment on DigitalOcean.

Current expectation: 10–15 concurrent users, potentially large data, document upload/download, authentication, financial information, public internet access.

Do NOT optimize only for the current 10–15 users. Keep the architecture simple for the current scale, but flag decisions that make future scaling or migration unnecessarily difficult.

## 2. FIRST: UNDERSTAND THE COMPLETE PROJECT

Before reviewing individual files, inspect: repository structure, frontend, backend, database, APIs, authentication, authorization, file/document handling, configuration, environment variables, build system, dependencies, Docker configuration, deployment configuration, CI/CD, tests, logging, error handling, third-party integrations, background/scheduled jobs, scripts, migration files, seed files, infrastructure configuration.

Create a high-level architecture diagram in text (Frontend → API → Auth → Services → Database → File storage → External services) and explain how data flows through the application.

## 3. DO NOT TRUST AI-GENERATED CODE

Assume every AI-generated implementation may contain: security vulnerabilities, incorrect assumptions, race conditions, missing validation, incorrect authorization, poor error handling, duplicate logic, dead code, hardcoded values, incorrect database transactions, performance problems, dependency vulnerabilities, incorrect edge-case handling.

Verify everything from the actual source code. Never say "Looks good." without explaining what was actually inspected.

## 4. SECURITY AUDIT — CRITICAL

Follow OWASP Top 10 + OWASP API Security Top 10.

**Authentication**: password hashing/storage/policy, brute-force protection, account lockout/rate limiting, session management, JWT implementation, token expiration, refresh token security, logout invalidation, password reset, email/OTP verification, session fixation, token leakage.

**Authorization (CRITICAL)**: every protected resource must check (a) who is the logged-in user, (b) is the user allowed this action, (c) does the resource belong to/is visible to that user. Test IDOR, broken object-level authorization, horizontal and vertical privilege escalation. Never rely on frontend authorization. Example: changing `/api/users/123/documents` to `/api/users/124/documents` must NOT expose another user's documents.

## 5. DOCUMENT / FILE SECURITY

Check: file type/MIME/extension validation, file size limits, filename sanitization, path traversal, malicious/executable upload prevention, double-extension attacks, ZIP bombs, storage isolation, access control, download authorization, signed URL security + expiration, document enumeration, direct storage access, public bucket exposure, encryption at rest/in transit, backup security. Documents must NOT be accessible merely by knowing a URL. Prefer: user → backend authorization → temporary signed URL → private object storage.

## 6. DATABASE SECURITY

Review: schema, PKs, FKs, unique constraints, indexes, relationships, cascade behavior, NULL handling, data types, decimal precision for money, timestamps, timezones, soft deletion, audit fields. NEVER floating point for money — verify DECIMAL/NUMERIC or integer-minor-units, currency handling, rounding, precision. Review SQL injection, ORM/raw query safety, parameterization, transactions, race conditions, deadlocks, connection pooling, N+1, missing indexes, slow queries, pagination. Multi-step financial operations (debit + transaction record + balance update) must be atomic.

## 7. FINANCIAL DATA INTEGRITY

Review: interest, EMI, outstanding balances, payment calculations, due dates, penalties, discounts, totals, rounding, partial payments, overpayments, refunds, reversals, failed/duplicate transactions. Look for: floating point errors, integer overflow, incorrect rounding, duplicate processing, race conditions, double payment recording, incorrect date calculations, timezone problems. Require idempotency, transactions, unique constraints, and locking where appropriate.

## 8. API SECURITY REVIEW

For EVERY endpoint document: method, URL, authn requirement, authz requirement, request/response validation, database interaction, error handling, rate limiting, sensitive-data exposure. Check: SQL/NoSQL/command injection, SSRF, XSS, CSRF, mass assignment, parameter tampering, excessive data exposure, broken authorization, missing rate limiting, unsafe redirects, improper HTTP methods, CORS. Never trust client-supplied user/account/document/transaction IDs, roles, or permissions.

## 9. INPUT VALIDATION

Every external value is untrusted: bodies, query/path params, headers, cookies, uploads, JSON, CSV, URLs. Validate type, length, format, range, required/optional, allowed values. Reject unexpected fields where appropriate.

## 10. FRONTEND SECURITY

Check: XSS/DOM XSS, unsafe HTML/URL handling, localStorage/sessionStorage token storage, cookie configuration, token exposure, sensitive info in browser storage, source maps, debug info, console logging, API key/env exposure. Never put DB credentials, secret keys, private API keys, or signing secrets in frontend code. Frontend environment variables are NOT secrets.

## 11. RESPONSIVE UI

Must work on desktop/laptop/tablet/Android/iPhone. Review layouts at small/large screens, touch, navigation, tables, forms, modals, upload/download, charts, errors, loading states.

## 12. API PERFORMANCE

Check: slow endpoints, excessive DB calls, N+1, large responses, missing pagination/filtering/indexing, unnecessary joins, duplicate/sequentializable calls, repeated expensive calculations, memory leaks. Every list endpoint reviewed for pagination — never return thousands of rows unnecessarily.

## 13. FRONTEND PERFORMANCE

Check: bundle size, lazy loading, code splitting, image optimization, heavy dependencies, unnecessary rendering, memory leaks, subscription cleanup, duplicate requests, caching, pagination, virtual scrolling where appropriate. (This repo: watch the single large Vite chunk; charts and PDF libs are candidates for code-splitting.)

## 14. DOCUMENT DOWNLOAD PERFORMANCE

Large documents should not pass through the app server unnecessarily. Prefer backend-authorized temporary signed URLs to private storage over backend-streams-entire-file. (Here documents are in-DB bytea — evaluate size limits and migration path to object storage.)

## 15. SERVER ARCHITECTURE

DigitalOcean; appropriate for 10–15 users + growth. Recommended separation: app server + database + object storage + backups. Don't store large user documents permanently on the app server if object storage is available.

## 16. NETWORKING

HTTP→HTTPS redirect, TLS config, firewall, open ports, SSH hardening, database NOT publicly exposed, CORS, DNS, IPv4/IPv6, reverse proxy, rate limiting. Only required ports public.

## 17. SECRETS MANAGEMENT

Search repo AND git history for: API keys, passwords, tokens, JWT secrets, DB credentials, encryption/private keys, cloud/SMTP credentials — in .env files, config, frontend env, Dockerfiles, CI/CD, logs. A secret ever committed to git is compromised even if later deleted — recommend rotation. (This repo: `backend/docker-compose.yml` carries dev ADMIN_*/DB credentials — verify they are dev-only and rotated for production; `backend/secrets/` must never be committed.)

## 18. DEPENDENCY AUDIT

package.json / go.mod / lock files / Docker base images / OS packages: outdated deps, known CVEs, abandoned/unnecessary/duplicate packages, vulnerable transitives. Critical/high first. Don't blindly upgrade — check compatibility.

## 19. ERROR HANDLING

Exceptions, HTTP status codes, user-friendly vs internal errors, stack traces, sensitive info, logging, retry logic. Never expose stack traces, SQL, credentials, internal paths, or server config to end users. (This repo: verify the `{success,error}` envelope never leaks internals and that generic 500s log details server-side only.)

## 20. LOGGING

Logs should diagnose login failures, API failures, document access, transactions, system errors, security events. NEVER log passwords, OTPs, tokens, card details, sensitive financial data, private documents, or unmasked KYC. Structured logs preferred. (This repo: slog JSON with redaction — verify the redaction list actually covers all sensitive keys.)

## 21. AUDIT LOGGING

Finance app: audit login/logout/failed login, user create/update/role changes, document upload/download/delete, financial transaction create/update, payment status changes, config changes. Audit records must be hard for normal users to modify/delete. (This repo: `audit_log` table exists but is not written to — standing finding until wired.)

## 22. BACKUP & DISASTER RECOVERY

DB backups, document backups, frequency, retention, encryption, restore process, DR, RPO, RTO. A backup that has never been restore-tested is not reliable — recommend a practical restore test procedure.

## 23. DATA PRIVACY

Personal/financial info, documents, phone numbers, emails, identity documents, addresses. Check data minimization, encryption, retention, deletion, access control, logs, backups, export, user deletion. (This repo: Aadhaar/PAN must be masked in every DTO and absent from logs — verify each response shape.)

## 24. AUTHENTICATION UX

Login, logout, invalid password, expired session/token, refresh behavior, multiple tabs, browser refresh, back button, password reset, unauthorized API access. Auth state must not become inconsistent. (This repo: hard 1-hour expiry → verify the 401→forced-relogin path works from every page and mid-form.)

## 25. CONCURRENCY / RACE CONDITIONS

Assume simultaneous requests: two users updating one record, two payments at once, a retried payment, double deletion, two balance updates. Verify transactions, locks, unique constraints, idempotency keys.

## 26. IDEMPOTENCY

For financial mutations, can a network-timeout retry create duplicates (e.g. double `POST /collections`)? Recommend idempotency mechanisms where appropriate.

## 27. TESTING AUDIT

Unit/integration/API/UI/E2E/security/database tests. Identify critical business logic without tests. For every critical financial operation recommend: happy path, invalid input, boundaries, duplicate requests, concurrent requests, failure scenarios, rollback. (This repo: `backend/internal/domain` has tests; handlers/services/repositories and the entire frontend have none — weigh accordingly.)

## 28. EDGE CASES

Empty/NULL/zero/negative/huge values, duplicates, deleted users/documents, expired sessions/URLs, network/DB timeouts, partial failure, duplicate API request, browser refresh, double-click, multiple tabs, concurrent updates, leap years, month-end, year-end, timezone changes. (This repo: additionally the CLAUDE.md loan edge-case matrix — 3 behaviors × normal/partial/bulk/post-bulk/overdue/foreclosure.)

## 29. DATE AND TIME

UTC vs local, DB/server/browser/India timezones, serialization, comparisons, month-end, due dates, scheduled jobs. Avoid ambiguous local timestamps. (This repo: local-date-string model is deliberate — audit for places that break it, and for server-TZ≠IST deployment risk.)

## 30. CODE QUALITY

Naming, structure, SOLID, DRY, separation of concerns, maintainability, duplication, complexity, long functions, large components, circular deps, dead code, unused imports, magic numbers/strings, hardcoded config. AI-generated code often contains duplicated or unnecessary abstractions — identify them.

## 31. ARCHITECTURE QUALITY

Proper separation between controllers/handlers, services, business logic, repositories, models, validation, authn, authz, utilities. Business rules must not be scattered through controllers/components. (This repo: loan money-math must live in `internal/domain` + `DataContext`, not in pages.)

## 32. CONFIGURATION

Separate dev/staging/production. No hardcoded environment-specific values: API URLs, DB URLs, buckets, credentials, feature flags, log levels, CORS, debug mode. Production must not run dev configuration.

## 33. PRODUCTION DEPLOYMENT (DigitalOcean)

Ubuntu LTS, SSH-key auth, firewall, reverse proxy, HTTPS, process manager/containers, env vars, auto-restart, health checks, monitoring, backups, log rotation, DB backup, rollback. No dev servers exposed to the internet.

## 34. CI/CD

Git workflow, branch protection, build pipeline, tests, security/dependency scanning, deployment, rollback. No production deploy on failing critical tests.

## 35. MONITORING

CPU, RAM, disk, network, database, API latency, error rate, 4xx/5xx, auth failures, storage usage. Define sensible alerts.

## 36. HEALTH CHECKS

`GET /health` (+ `/ready` where appropriate) distinguishing app-up vs DB-down vs dependency-down. No sensitive diagnostics publicly.

## 37. API DOCUMENTATION

OpenAPI/Swagger with auth requirements, request/response schemas, error responses, examples. Documentation must match implementation.

## 38. DATABASE MIGRATIONS

Migration system, ordering, rollback strategy, production safety, data migrations, seed data. Never depend on manual production schema changes. (This repo: embedded boot-time migrations — evaluate rollback story and long-migration risk on deploy.)

## 39. DATA DELETION

What happens when a user/document/transaction is deleted or an account disabled: FKs, orphaned files, audit requirements. Never recommend hard-deleting financial records without considering audit requirements. (This repo: soft deletes + cascades — verify cascade scope is intentional.)

## 40. FILE STORAGE ARCHITECTURE

Prefer private object storage over app-server filesystem. Must support private objects, user-specific access, signed URLs, encryption, backup, lifecycle. (This repo: in-DB bytea — assess as migration recommendation with size/backup analysis.)

## 41. SECURITY HEADERS

Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, frame protection — configured without breaking the app.

## 42. CORS

No `Access-Control-Allow-Origin: *` for authenticated financial APIs. Only trusted origins; review credentials/cookies configuration. (This repo: check the chi CORS options in `router.go`.)

## 43. RATE LIMITING

Login, OTP, password reset, upload, download, search, expensive reports, financial transactions, public APIs — protect against brute force, abuse, DoS, accidental floods. (This repo: verify whether ANY rate limiting exists — likely a finding.)

## 44. SECURITY OF DOWNLOADS

`GET /documents/{id}/download` must verify authenticated user + authorization + ownership — never document ID alone. Test by changing IDs.

## 45. SEARCH FOR COMMON SECURITY BUGS

Grep the codebase for: eval/exec/shell execution, innerHTML, dangerouslySetInnerHTML, raw/string-built SQL, hardcoded secrets, localhost URLs, debug mode, wildcard CORS, disabled SSL verification, insecure http URLs, console.log of sensitive data, password/token logging, public file paths, unrestricted uploads.

## 46. PERFORMANCE TESTING

Estimate behavior at 1/10/15/50/100 users. Identify bottlenecks. Recommend realistic load tests. Do NOT recommend Kubernetes/microservices — keep architecture appropriate for scale.

## 47. MOBILE / TABLET TESTING

360/375/390/414/768/1024/1280px+: forms, tables, navigation, buttons, upload/download, charts, modals, authentication.

## 48. BROWSER COMPATIBILITY

Chrome, Edge, Firefox, Safari, Android Chrome, iOS Safari. Identify unsupported browser APIs.

## 49. ACCESSIBILITY

Keyboard navigation, focus states, labels, form errors, ARIA where needed, contrast, screen readers, button/input semantics. Target WCAG 2.2 AA where practical.

## 50. SEO / PUBLIC PAGES

If public pages exist: metadata, titles, descriptions, robots, sitemap, canonical, social meta. Do not expose private pages to search engines.

## 51. THIRD-PARTY SERVICES

For every external dependency (payment/SMS/email/storage/analytics/auth/APIs) document: purpose, credentials, failure behavior, timeout, retry, rate limits, security implications, data shared.

## 52. FAILURE SCENARIOS

DB down, storage down, network failure, API timeout, third-party failure, server restart, disk full, memory full. The application must fail safely.

## 53. NO SILENT FAILURES

Search for empty catch blocks, ignored promises/exceptions, generic success responses, missing rollback, missing error propagation. Errors must be handled intentionally. (This repo: grep `catch(() => {})` / `catch {}` / `_ = err` patterns.)

## 54. SECURITY THREAT MODEL

Assets: user data, financial data, documents, credentials, sessions, database, storage. Actors: anonymous attacker, authenticated malicious user, compromised account, insider, bot. Surfaces: login, APIs, uploads, downloads, database, admin functions, integrations. For each threat: attack, impact, existing protection, missing protection, recommended fix.

## 55. ADMIN / ROLE SECURITY

Admin authentication, role assignment, permission checks, admin API endpoints, user management, document access, financial data access. Normal users must not reach admin APIs via URL or payload manipulation. (This repo: `/users` routes + last-admin/self-guards + the viewer/edit RBAC matrix — probe all of it live.)

## 56. FINAL REVIEW FORMAT

DO NOT modify code first. Produce:

- **A. Executive Summary** — overall production-readiness /100, plus security, architecture, performance, code quality, testing scores /100.
- **B. Critical Findings** — table: | Severity | File | Line | Problem | Impact | Fix | with severity CRITICAL/HIGH/MEDIUM/LOW/INFO.
- **C. Security Findings** · **D. Database Findings** · **E. API Findings** · **F. Frontend Findings** · **G. Document Storage Findings** · **H. Performance Findings** · **I. Infrastructure Findings** · **J. Testing Gaps** · **K. Technical Debt** · **L. Architecture Recommendations** · **M. Production Blockers** (short must-fix-before-production list).

## 57. FINDING FORMAT

For EVERY finding:

### [SEVERITY] Finding title
**Location:** file/path:line
**Problem:** exactly what is wrong.
**Why it matters:** real-world impact.
**Attack/Failure scenario:** concrete example where applicable.
**Recommended fix:** the correct approach.
**Priority:** P0 / P1 / P2 / P3

No vague findings.

## 58. IMPORTANT RULES

1. Do NOT modify code during the initial audit.
2. Do NOT assume something is secure because it appears to work.
3. Do NOT assume frontend validation is sufficient.
4. Do NOT trust IDs supplied by clients.
5. Do NOT expose secrets.
6. Do NOT expose private documents.
7. Do NOT use floating-point arithmetic for exact financial values.
8. Do NOT recommend unnecessary microservices.
9. Do NOT recommend Kubernetes simply because this is production.
10. Do NOT over-engineer for 10–15 users.
11. Do NOT sacrifice security for simplicity.
12. Do NOT sacrifice financial correctness for performance.
13. Verify every important claim against actual code.
14. Include exact file paths and line numbers.
15. If something cannot be verified, say **"NOT VERIFIED"**.
16. If configuration lives outside the repo, mark **"REQUIRES EXTERNAL CONFIGURATION VERIFICATION"**.
17. Do not invent missing infrastructure.
18. Do not claim tests passed unless you actually ran them.
19. Do not claim vulnerabilities exist without evidence.
20. Distinguish: Confirmed issue / Potential issue / Recommendation.

## 59. REVIEW EXECUTION ORDER

PHASE 1 Repository discovery → PHASE 2 Architecture mapping → PHASE 3 Authentication & authorization → PHASE 4 API security → PHASE 5 Database → PHASE 6 Financial/business logic → PHASE 7 File/document security → PHASE 8 Frontend → PHASE 9 Performance → PHASE 10 Infrastructure/deployment → PHASE 11 Dependencies → PHASE 12 Testing → PHASE 13 Threat model → PHASE 14 Production readiness.

## 60. AFTER THE AUDIT

Do NOT automatically fix everything. First deliver the complete report, then a **Recommended Fix Order**:

- **P0** — must fix before deployment
- **P1** — fix before real financial data
- **P2** — fix before scaling
- **P3** — improvement / technical debt

Only after the user approves, implement fixes ONE GROUP AT A TIME. After each group: (1) show changed files, (2) explain changes, (3) run relevant tests (`npm run build`; `go build ./... && go test ./...`), (4) show results, (5) check regressions (incl. the CLAUDE.md loan edge-case matrix), (6) re-review the modified code.

## FINAL REQUIREMENT

Be extremely critical. This is a finance application. The goal is NOT to make the code feel good — it is to find everything that could cause: security breach, financial calculation error, data leakage, unauthorized document/financial access, data corruption, duplicate transactions, lost data, downtime, poor performance, production failure. Assume public internet exposure. Review as if you were personally signing off the application for production.
