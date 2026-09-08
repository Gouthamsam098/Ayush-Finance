# Anush LMS UI - AI Agent Guidelines

## Project Overview

**Anush LMS** is a React 18 + TypeScript + Vite-based web UI for a Loan Management System (LMS). The application handles loan lifecycle management including customer management, loan applications, collections, expenses, documents, reporting, and SMS notifications.

**Stack:**

- **Frontend**: React 18, TypeScript, Vite
- **State Management**: Redux Toolkit (`@reduxjs/toolkit`)
- **Routing**: React Router v6 with protected routes
- **Styling**: Tailwind CSS 3 + PostCSS
- **Icons**: Lucide React
- **HTTP Client**: Axios
- **Forms**: React Hook Form
- **PDF Generation**: jsPDF + jsPDF AutoTable
- **Animations**: Framer Motion
- **UI Pattern**: Custom shadcn-style component library

## Build & Run Commands

```bash
# Install dependencies
npm install

# Development server (runs on port 5173)
npm run dev

# Production build (outputs to dist/)
npm run build

# Preview production build
npm run preview
```

**API Configuration**: The app proxies `/api/*` requests to `http://localhost:4000` (or `VITE_API_URL` env var). Backend must be running for API calls to work.

## Project Structure

```
src/
├── components/
│   ├── layout/        # AppShell (main layout wrapper)
│   ├── ui/            # Reusable UI components (button, card, dialog, input, select, etc.)
│   └── *.tsx          # Feature components (LiveClock, LedgerDialog, etc.)
├── pages/             # Route pages (Dashboard, Customers, Loans, Collections, etc.)
├── routes/            # Route guards (ProtectedRoute)
├── store/             # Redux state (authSlice, index)
├── lib/               # Utilities (format.ts, utils.ts, pdfReport.ts)
├── mock/              # DataContext for mock data during development
├── App.tsx            # Route definitions
├── main.tsx           # App entry point
└── index.css          # Global styles
```

## Architecture & Key Patterns

### Authentication & Authorization

- **Auth State**: Managed in Redux `authSlice` with `accessToken`, `user`, `preAuthToken`, and `stage`.
- **Multi-stage Auth**: Supports `PASSWORD_CHANGE`, `TOTP_SETUP`, `TOTP_REQUIRED` stages for secure onboarding.
- **Protected Routes**: `ProtectedRoute` component guards all authenticated pages. Redirects to `/login` if no access token.
- **Login Page**: `/login` is the only public route.

### Routing

```
/login                      # Public login page
/                          # Dashboard (protected)
/customers                 # Customer management (protected)
/loans                     # Loan applications (protected)
/collections               # Collections tracking (protected)
/expenses                  # Expense management (protected)
/sms                       # SMS center (protected)
/reports                   # Reporting (protected)
/documents                 # Document management (protected)
/settings                  # Settings (protected)
```

All protected routes are wrapped in `ProtectedRoute` and rendered within `AppShell` layout.

### State Management

**Redux Structure:**
- Single store configured with Redux Toolkit
- `authSlice`: Manages `accessToken`, `user`, `preAuthToken`, and auth stage
- Selectors used in components via `useSelector` hook
- Dispatch actions via `useDispatch` hook

**Mock Data:**
- `DataContext` provider wraps the app for in-memory state (no demo data — it starts empty)
- Can be replaced with real API calls when backend is available

### UI Components

Located in `src/components/ui/`, following shadcn-style patterns:
- `badge.tsx`, `button.tsx`, `card.tsx`, `dialog.tsx`
- `input.tsx`, `select.tsx`, `skeleton.tsx`, `toast.tsx`

These components use Tailwind CSS with `clsx` and `tailwind-merge` for class composition.

### Layout

`AppShell` is the main layout component with:
- Sidebar navigation with collapsible drawer
- Top bar with theme toggle (dark/light mode)
- Logout functionality
- Responsive design with mobile hamburger menu

## Development Conventions

### File Naming
- Components: PascalCase (e.g., `Dashboard.tsx`, `AppShell.tsx`)
- Utilities: camelCase (e.g., `format.ts`, `utils.ts`)
- Pages: PascalCase (e.g., `Dashboard.tsx`, `Login.tsx`)

### Import Aliases
- Use `@/` prefix for absolute imports from `src/` (configured in `tsconfig.json` and `vite.config.ts`)
- ✅ Good: `import { Dashboard } from '@/pages/Dashboard'`
- ❌ Avoid: `import { Dashboard } from '../pages/Dashboard'`

### TypeScript
- `strict: true` - Strict type checking enabled
- `jsx: "react-jsx"` - New JSX transform
- Module target: `ESNext` with `ES2020` lib
- `noEmit: true` - Vite handles compilation

### Styling
- **Framework**: Tailwind CSS with PostCSS
- **Utilities**: `cn()` utility in `@/lib/utils.ts` for conditional class composition (clsx + tailwind-merge)
- **Dark Mode**: Implemented via `document.documentElement.classList.toggle('dark')`

### Form Handling
- Use `react-hook-form` for form state and validation
- Component library provides `Input`, `Select` components compatible with hook form

### API Integration
- Axios instance configured for `/api` proxy
- Mock data via `DataContext` during development
- Environment variable: `VITE_API_URL` to override API base URL

### Code Organization
1. **Imports** (React, third-party, local)
2. **Type definitions/interfaces**
3. **Component definition**
4. **Hooks and event handlers**
5. **JSX return**

## Common Development Tasks

### Adding a New Page
1. Create page component in `src/pages/PageName.tsx`
2. Add route in `src/App.tsx` inside protected routes
3. Add navigation item to `NAV` array in `src/components/layout/AppShell.tsx`
4. Connect to Redux state or mock data as needed

### Adding a New UI Component
1. Create component in `src/components/ui/component-name.tsx`
2. Export from component file
3. Use `cn()` utility for Tailwind class composition
4. Follow existing shadcn-style patterns

### Updating Redux State
1. Modify reducer in `src/store/authSlice.ts`
2. Use `useSelector` to read state in components
3. Use `useDispatch` and actions to update state
4. Export type definitions for TypeScript support

### Handling Authentication
1. Check `accessToken` in `ProtectedRoute` to guard routes
2. Update auth state in Redux when login/logout occurs
3. Handle multi-stage auth flows via `stage` field
4. Store tokens securely (avoid localStorage if possible)

## Potential Pitfalls

- **API Not Running**: If backend isn't running on port 4000, `/api` calls will fail. Check `VITE_API_URL` configuration.
- **Missing Types**: Ensure Redux selectors are properly typed with `RootState` to avoid runtime errors.
- **Styling Conflicts**: When using Tailwind, be careful with specificity. Use `cn()` utility to avoid class conflicts.
- **Protected Routes**: Always verify auth token exists before rendering protected content to avoid blank pages.
- **Dark Mode**: Class-based dark mode requires manual DOM manipulation in `AppShell`. Consider using a context provider for global theme state.

## Useful Commands for Agents

- `npm run dev` - Start dev server for local testing
- `npm run build` - Create production build
- `npm run preview` - Test production build locally
- `tsc -b` - Type check (run before build)

---

**Last Updated**: 2026-07-08  
**Project**: Anush LMS UI v1.0.0
