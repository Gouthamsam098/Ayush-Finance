import { Navigate, Outlet } from 'react-router-dom';
import { useSelector } from 'react-redux';
import type { RootState } from '@/store';
import { usePermissions } from '@/lib/permissions';

/** Guards app routes; redirects unauthenticated users to /login. */
export function ProtectedRoute() {
  const token = useSelector((s: RootState) => s.auth.accessToken);
  if (!token) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** Admin-only guard; non-admins are redirected to the dashboard. Backed by the
 *  server (admin-only API), this is UX only — it hides admin screens. */
export function AdminRoute() {
  const role = useSelector((s: RootState) => s.auth.user?.role);
  if (role !== 'ADMIN') return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Module-access guard for VIEWER-scoped screens (e.g. Reports). Admins pass. */
export function ModuleRoute({ module }: { module: string }) {
  const { canView } = usePermissions();
  if (!canView(module)) return <Navigate to="/" replace />;
  return <Outlet />;
}
