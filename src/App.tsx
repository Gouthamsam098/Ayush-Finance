import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { ProtectedRoute, AdminRoute, ModuleRoute } from '@/routes/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import { config } from '@/lib/config';
import { tokenStore } from '@/lib/tokenStore';
import { authApi } from '@/services/authApi';
import { setTokens, setUser } from '@/store/authSlice';

// Login stays eager: it is the first paint of every session, so it must not
// wait on a second network round-trip.
import Login from '@/pages/Login';

// Every authenticated page is code-split. Statically importing them pulled the
// heavy, page-specific libraries into the initial bundle — recharts (Dashboard
// only) and jsPDF (Ledger/Reports only) alone dominated it — so users paid for
// them before the login form could even render. Now each page's chunk is
// fetched on first navigation to it.
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Customers = lazy(() => import('@/pages/Customers'));
const Loans = lazy(() => import('@/pages/Loans'));
const Collections = lazy(() => import('@/pages/Collections'));
const Expenses = lazy(() => import('@/pages/Expenses'));
const Documents = lazy(() => import('@/pages/Documents'));
const Reports = lazy(() => import('@/pages/Reports'));
const Settings = lazy(() => import('@/pages/Settings'));

export default function App() {
  const dispatch = useDispatch();
  // In API mode, a stored token means a live session — restore it so a page
  // refresh does not log the user out. `restoring` blocks route rendering
  // until the check completes, avoiding a flash to /login.
  const [restoring, setRestoring] = useState(config.useApi && !!tokenStore.get());

  useEffect(() => {
    if (!config.useApi || !tokenStore.get()) return;
    authApi
      .me()
      .then((me) => {
        dispatch(setTokens({ accessToken: 'api' }));
        dispatch(setUser({ id: me.id, username: me.email, fullName: me.full_name, role: me.role, permissions: me.permissions }));
      })
      .catch(() => tokenStore.clear())
      .finally(() => setRestoring(false));
  }, [dispatch]);

  if (restoring) return null;

  // Each lazy page is wrapped individually rather than the whole <Routes>, so
  // the AppShell (sidebar, header) stays on screen while a page chunk loads —
  // only the content area shows the fallback.
  const page = (el: React.ReactNode) => <Suspense fallback={<PageFallback />}>{el}</Suspense>;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={page(<Dashboard />)} />
          <Route path="/customers" element={page(<Customers />)} />
          <Route path="/loans" element={page(<Loans />)} />
          <Route path="/collections" element={page(<Collections />)} />
          <Route path="/expenses" element={page(<Expenses />)} />
          <Route path="/documents" element={page(<Documents />)} />
          <Route element={<ModuleRoute module="Reports" />}>
            <Route path="/reports" element={page(<Reports />)} />
          </Route>
          <Route element={<AdminRoute />}>
            <Route path="/settings" element={page(<Settings />)} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}

/** Neutral placeholder shown while a page's chunk downloads. Announced politely
 *  so screen-reader users are told the page is loading rather than hearing
 *  nothing during the fetch. */
function PageFallback() {
  return (
    <div role="status" aria-live="polite" className="grid min-h-[60vh] place-items-center">
      <span className="sr-only">Loading page…</span>
      <span
        aria-hidden="true"
        className="h-7 w-7 animate-spin rounded-full border-2 border-primary/25 border-t-primary"
      />
    </div>
  );
}
