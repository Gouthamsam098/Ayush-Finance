import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { logout } from '@/store/authSlice';
import { authApi } from '@/services/authApi';
import type { RootState } from '@/store';
import BrandLogo from '@/components/BrandLogo';
import { CustomerAvatar } from '@/components/CustomerAvatar';
import { cn } from '@/lib/utils';
import { LogOut, Moon, Sun } from 'lucide-react';

export function CustomerPortalShell() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const user = useSelector((s: RootState) => s.auth.user);
  const displayName = user?.fullName?.trim() || user?.username || 'Customer';
  const customerId = user?.customerId;

  const toggleTheme = () => {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      return next;
    });
  };

  const signOut = () => {
    authApi.logout();
    dispatch(logout());
    navigate('/login');
  };

  return (
    <div className="relative flex min-h-app flex-col bg-slate-100/80 dark:bg-[#060912]">
      <div
        className="pointer-events-none fixed inset-0 opacity-100 dark:opacity-70"
        style={{
          background: `
            radial-gradient(ellipse 80% 50% at 50% -10%, rgba(99,102,241,.18), transparent),
            radial-gradient(ellipse 60% 40% at 100% 0%, rgba(37,99,235,.12), transparent),
            radial-gradient(ellipse 50% 30% at 0% 100%, rgba(139,92,246,.08), transparent)
          `,
        }}
      />
      <header className="sticky top-0 z-30 border-b border-slate-200/60 bg-surface/80 backdrop-blur-xl pt-safe dark:border-white/[.06] dark:bg-[#0c1220]/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-safe py-3 sm:gap-4 sm:px-6 sm:py-3.5 md:max-w-4xl lg:max-w-[52rem]">
          <BrandLogo className="h-8 max-w-[140px]" />
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-2.5 sm:flex">
              <CustomerAvatar
                customerId={customerId}
                name={displayName}
                className="h-9 w-9 rounded-full"
                textClassName="text-[11px]"
                fallbackStyle={{
                  background: 'linear-gradient(to bottom right, #2563eb, #7c3aed)',
                  color: '#fff',
                }}
              />
              <div className="text-right">
                <span className="block max-w-[140px] truncate text-[13px] font-semibold text-ink">{displayName}</span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted">Customer portal</span>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              title={dark ? 'Light mode' : 'Dark mode'}
              className="touch-target grid h-10 w-10 place-items-center rounded-xl border border-slate-200/80 text-muted transition-colors hover:bg-slate-100 dark:border-white/[.08] dark:hover:bg-white/[.05]"
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              type="button"
              onClick={signOut}
              className={cn(
                'touch-target inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200/80 px-3 py-2 text-[12px] font-semibold text-muted transition-colors',
                'hover:border-red-200/80 hover:bg-red-50 hover:text-red-600 dark:border-white/[.08] dark:hover:bg-red-500/10 dark:hover:text-red-400',
              )}
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>
      <main className="relative mx-auto w-full max-w-3xl flex-1 px-safe pb-safe pt-4 sm:px-6 sm:py-8 md:max-w-4xl md:py-10 lg:max-w-[52rem]">
        <Outlet />
      </main>
    </div>
  );
}
