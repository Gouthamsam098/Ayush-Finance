import { Navigate, Outlet } from 'react-router-dom';
import { useSelector } from 'react-redux';
import type { RootState } from '@/store';

/** Guards app routes; redirects unauthenticated users to /login. */
export function ProtectedRoute() {
  const token = useSelector((s: RootState) => s.auth.accessToken);
  if (!token) return <Navigate to="/login" replace />;
  return <Outlet />;
}
