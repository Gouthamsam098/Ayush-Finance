# Orbit Router – Frontend Development Plan

This document is the **single source of truth** for building and maintaining the Orbit Router UI. All work must follow this plan. **Backend remains LOCKED.**

---

## 1. Constraints (Non-Negotiable)

- **Backend:** Do NOT modify any backend code (orbitbackend/). Consume APIs as-is.
- **Scope:** Only create/modify code under `orbit-ui/` and frontend-related docs under `docs/`.
- **Stack:** TypeScript strict mode, no `any`. No new backend dependencies or config changes.

---

## 2. Phased Workflow

### Phase 1 – Analysis & Design (Complete)

| Step | Deliverable | Status |
|------|-------------|--------|
| 1.1 | Backend analysis: language, framework, API map, auth, DTOs | ✅ `docs/STEP1_BACKEND_ANALYSIS.md` |
| 1.2 | Tech stack selection with reasoning | ✅ `docs/STEP2_TECH_STACK.md` |
| 1.3 | Frontend architecture: folder structure, features, API client, auth flow | ✅ `docs/STEP3_ARCHITECTURE.md` |

### Phase 2 – Implementation (Follow Order)

| Step | Task | Location | Status |
|------|------|----------|--------|
| 2.1 | Scaffold: package.json, Vite, TS, Tailwind, React Router, React Query | orbit-ui/ | ✅ |
| 2.2 | Types: User, Route, Rule, DashboardStats, LoginRequest/Response, ApiError | orbit-ui/src/types/index.ts | ✅ |
| 2.3 | API client: getBaseUrl(), request<T>(), auth headers | orbit-ui/src/api/client.ts | ✅ |
| 2.4 | API modules: auth, routes, rules, users, dashboard | orbit-ui/src/api/*.ts | ✅ |
| 2.5 | Auth feature: AuthContext, LoginPage, ProtectedRoute | orbit-ui/src/features/auth/ | ✅ |
| 2.6 | Shared: AppLayout, Breadcrumbs, DataTable, Loading, ErrorState | orbit-ui/src/features/shared/ | ✅ |
| 2.7 | Dashboard: stats cards, links to routes/rules | orbit-ui/src/features/dashboard/ | ✅ |
| 2.8 | Routes: list, CRUD modals, search | orbit-ui/src/features/routes/ | ✅ |
| 2.9 | Rules: list, CRUD modals, expression validate, route dropdown | orbit-ui/src/features/rules/ | ✅ |
| 2.10 | Users: list (admin), CRUD, password reset | orbit-ui/src/features/users/ | ✅ |
| 2.11 | Settings: profile, change password, theme (light/dark) | orbit-ui/src/features/settings/ | ✅ |
| 2.12 | Reports: charts from dashboard stats (bar + pie) | orbit-ui/src/features/reports/ | ✅ |
| 2.13 | Export: JSON/CSV download for routes, rules, users | orbit-ui/src/features/export/ | ✅ |
| 2.14 | Routing: React Router config, protected layout | orbit-ui/src/routes/index.tsx | ✅ |
| 2.15 | App entry: QueryClient, AuthProvider, ErrorBoundary | orbit-ui/src/App.tsx, main.tsx | ✅ |
| 2.16 | Env: .env.example with VITE_API_URL | orbit-ui/.env.example | ✅ |
| 2.17 | Docs: README, setup & build | orbit-ui/README.md, docs/FRONTEND_SETUP_AND_BUILD.md | ✅ |

### Phase 3 – Quality & Handoff

| Step | Task | Status |
|------|------|--------|
| 3.1 | No hardcoded API URLs; all via VITE_API_URL | ✅ |
| 3.2 | Loading and error states on all data views | ✅ |
| 3.3 | Error boundary at app root | ✅ |
| 3.4 | Local setup and production build instructions | ✅ |
| 3.5 | Optional: skeleton loaders, toast for mutations | 🔲 If needed |
| 3.6 | Optional: e2e or smoke tests | 🔲 If needed |

---

## 3. Folder Structure (Must Match)

```
orbit-ui/
├── public/
├── src/
│   ├── api/           client.ts, auth.ts, routes.ts, rules.ts, users.ts, dashboard.ts
│   ├── assets/
│   ├── components/    ErrorBoundary, ui/ (if any)
│   ├── features/
│   │   ├── auth/      AuthContext, LoginPage, ProtectedRoute
│   │   ├── dashboard/ DashboardPage
│   │   ├── routes/    RoutesPage, RouteFormModal
│   │   ├── rules/     RulesPage, RuleFormModal
│   │   ├── users/     UsersPage, UserFormModal
│   │   ├── settings/  SettingsPage
│   │   ├── reports/   ReportsPage
│   │   ├── export/    ExportPage
│   │   └── shared/    AppLayout, Breadcrumbs, DataTable, Loading, ErrorState
│   ├── hooks/         (optional)
│   ├── routes/        index.tsx (router config)
│   ├── stores/        (optional)
│   ├── styles/        index.css
│   ├── types/         index.ts (DTOs)
│   └── utils/         (optional)
├── .env.example
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── README.md
```

---

## 4. API Contract (Read-Only Reference)

- **Base path:** `/apiorbit`
- **Auth:** `POST /auth/login` (account_name, username, password) → token, client_id, user
- **Headers:** `Authorization: Bearer <token>`, `X-Client-ID: <client_id>` on protected calls
- **Error body:** `{ "message": "string" }`
- **Endpoints:** See `docs/STEP1_BACKEND_ANALYSIS.md` for full list and request/response shapes. Do not assume or add fields.

---

## 5. Checklist for Any New Work

Before adding or changing frontend code:

- [ ] Change is only under `orbit-ui/` or `docs/` (no backend edits).
- [ ] No new backend endpoints or response shapes assumed.
- [ ] API base URL comes from `VITE_API_URL`.
- [ ] Types match backend DTOs (see STEP1 and orbit-ui/src/types).
- [ ] Loading and error states considered for new data views.
- [ ] Plan document updated if a new phase/task is added.

---

## 6. How to Continue

- **Implement missing items:** Pick the next unchecked task in Phase 2 or 3 and implement it; then mark it done in this plan.
- **New feature:** Add a row to Phase 2 with location and status; implement; update this file.
- **Bug fix:** Fix only in frontend; do not change API contract or backend. Update plan if it introduces a new pattern or file.

---

*Last updated: Plan created. All Phase 2 and Phase 3 core items marked complete per current codebase.*
