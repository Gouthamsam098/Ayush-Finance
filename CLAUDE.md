# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Anush LMS is a React 18 + TypeScript + Vite front-end for a loan-management system (Anush Capitals). There is a companion `AGENTS.md` covering stack, routes, and file layout — this file focuses on the non-obvious architecture and domain rules.

## Commands

```bash
npm run dev       # Vite dev server on :5173, host exposed to LAN
npm run build     # tsc -b (typecheck) then vite build → dist/
npm run preview   # serve the production build
```

There is **no test runner, linter, or formatter** configured. `npm run build` is the only correctness gate — it runs `tsc -b` first, so a type error fails the build. Run it before considering a change done.

## Current state: front-end only, no backend

Despite `axios` being a dependency and `vite.config.ts` proxying `/api` → `http://localhost:4000` (override with `VITE_API_URL`), **no API calls exist anywhere in the code.** All application data is in-memory and seeded on load.

- **`src/mock/DataContext.tsx`** is the single source of truth for all domain data (customers, loans, collections, expenses, documents) and every mutation. It is a React Context, not Redux. Access it via `useData()`. Data resets on every page reload; there is no persistence.
- **Login (`src/pages/Login.tsx`) is a stub** — it accepts any credentials, dispatches a hardcoded `demo-token`, and navigates to `/`. The `AuthStage` machinery in `authSlice` (`PASSWORD_CHANGE`, `TOTP_SETUP`, `TOTP_REQUIRED`) and `preAuthToken` are defined but **never used**; they anticipate a future real auth flow.

When wiring a real backend, replace the `DataContext` method bodies (keep the `DataShape` interface as the contract) and the `setTimeout` in `Login.signIn`.

## Two independent state systems

State is deliberately split:

- **Redux (`src/store/`)** holds *only* auth (`authSlice`). `ProtectedRoute` reads `auth.accessToken` to gate every route except `/login`. Use `useSelector`/`useDispatch` with the exported `RootState` / `AppDispatch` types.
- **`DataContext`** holds *everything else* (all business entities + derived calculations). Do not move domain data into Redux — the split is intentional.

Provider nesting (from `main.tsx`): `Redux Provider` → `DataProvider` → `ToastProvider` → `BrowserRouter` → `App`.

## Loan domain model — the core complexity

`DataContext.tsx` encodes the business rules. Six `LoanType`s collapse into three economic behaviors — get this wrong and the money math is wrong:

- **`isDailyLoan`** = `DAILY_COLLECTION` | `DAILY_INTEREST`. Interest is deducted upfront (stored as `deduction`); daily payments repay principal.
  - `DAILY_COLLECTION` outstanding = `principal − collected` (principal shrinks as collected).
  - `DAILY_INTEREST` outstanding = `principal + totalDueForDaily` (interest-only; principal fixed, outstanding *rises* above principal when payments fall behind).
- **`isMonthlyLike`** = `MONTHLY_INTEREST` | `VEHICLE` | `PROPERTY` | `FLEXIBLE`. A recurring interest cycle (30 days for all except `FLEXIBLE`, which uses its own `numDays` via `cycleDaysFor`). Outstanding = `principal + totalDueForMonthly`.

Key derived helpers (all defined in `DataContext`, exposed through `useData()` or exported standalone):

- `elapsedDaysSinceLoan(loanDate)` — calendar days, Day 1 = loan date, uncapped.
- `monthlyCyclesElapsed(loanDate, cycleDays)` — completed cycles (day 30 → 1, day 59 → 1, day 60 → 2).
- `totalDueForDaily(loan)` — cumulative shortfall: `min(elapsed, term) × dailyAmount − collected`.
- `totalDueForMonthly(loan)` — `completedCycles × interest − collected`.
- `outstandingFor(loan)` — the type dispatch above; returns 0 for `CLOSED` loans (except `DAILY_COLLECTION`).
- `nextDueForDaily(loan)` — day after last collection, clamped to loan term; `null` once principal fully repaid.
- `interest = calcInterest(principal, rate) = round(principal × rate / 100)`. Recomputed automatically in `addLoan`/`updateLoan` whenever `principal` or `rate` changes.

When adding loan logic, extend these helpers rather than recalculating inline in pages, and preserve the three-behavior grouping.

### ID / sequence generation
`DataContext` mints human-readable codes from counters in state: customers `CUST-####` (from `codeSeq`), loans `LN-####` (`loanSeq`), receipts `RCPT-######` (`rcptSeq`). Deletes cascade — `deleteCustomer` also removes that customer's loans, collections, and documents; `deleteLoan` removes its collections.

## Dates are string-based, local-time

All dates are `YYYY-MM-DD` strings, **not** `Date` objects. Always parse via `s.split('-').map(Number)` and construct `new Date(y, m-1, d)` (local time) — never `new Date(isoString)`, which parses as UTC and shifts the day. `todayISO()` / `fmtDate()` / `isoLocal` follow this convention; match it.

## Styling & UI conventions

- Tailwind with `darkMode: 'class'`. Dark mode is toggled by adding `.dark` to `<html>` directly in `AppShell` (`document.documentElement.classList.toggle('dark')`) — there is no theme context, and the setting does not persist.
- Theme colors resolve through CSS variables in `src/index.css` (`--surface`, `--ink`, `--muted`, etc.) exposed to Tailwind as `surface`/`ink`/`muted`. Semantic palette: `primary` (indigo), `success`, `warning`, `danger`. Custom `rounded-card` (18px) and `shadow-card`/`soft`/`glow`.
- Compose classes with `cn()` from `@/lib/utils` (clsx + tailwind-merge) so later utilities win over earlier ones.
- Reusable primitives live in `src/components/ui/` (shadcn-style, hand-rolled). Toasts come from `useToast()` (`@/components/ui/toast`), not a library.
- Money formatting: `inr()` (full `₹1,23,456`, Indian grouping) and `inrShort()` (`₹1.23 Cr` / `₹1.23 L`) from `@/lib/format`.

## Imports

Use the `@/` alias for anything under `src/` (configured in both `tsconfig.json` and `vite.config.ts`). Avoid relative `../` paths.

## PDF reports

`src/lib/pdfReport.ts` builds loan-ledger PDFs with jsPDF + jspdf-autotable via `buildLedgerReportPDF(ReportParams)`. Callers pass **already-formatted** display strings (dates, amounts) — the builder does no domain formatting itself. `LedgerDialog.tsx` is the primary consumer.
