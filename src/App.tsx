import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { ProtectedRoute, AdminRoute } from '@/routes/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import { config } from '@/lib/config';
import { tokenStore } from '@/lib/tokenStore';
import { authApi } from '@/services/authApi';
import { setTokens, setUser } from '@/store/authSlice';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Customers from '@/pages/Customers';
import Loans from '@/pages/Loans';
import Collections from '@/pages/Collections';
import Expenses from '@/pages/Expenses';
import Documents from '@/pages/Documents';
import Reports from '@/pages/Reports';
import Settings from '@/pages/Settings';

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

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/loans" element={<Loans />} />
          <Route path="/collections" element={<Collections />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/reports" element={<Reports />} />
          <Route element={<AdminRoute />}>
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
