import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { logout } from '@/store/authSlice';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Users, FileText, Receipt, Wallet, BarChart3,
  FolderOpen, Settings, Bell, Moon, Sun, Menu, X, LogOut, MessageSquare } from 'lucide-react';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/loans', label: 'Loans', icon: FileText },
  { to: '/collections', label: 'Collections', icon: Receipt },
  { to: '/expenses', label: 'Expenses', icon: Wallet },
  { to: '/sms', label: 'SMS Center', icon: MessageSquare },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/documents', label: 'Documents', icon: FolderOpen },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AppShell() {
  const [dark, setDark] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const toggleTheme = () => {
    setDark((d) => {
      document.documentElement.classList.toggle('dark', !d);
      return !d;
    });
  };

  const sidebar = (
    <aside className="relative flex h-full w-60 flex-col overflow-hidden border-r border-slate-200/70 dark:border-white/[.06] bg-white/90 dark:bg-surface/90 backdrop-blur-xl">
      {/* ambient glow inside the rail */}
      <span className="pointer-events-none absolute -left-16 top-24 h-56 w-56 rounded-full bg-primary/20 blur-3xl anim-glow" />
      <span className="pointer-events-none absolute -right-20 bottom-10 h-52 w-52 rounded-full bg-success/15 blur-3xl anim-glow" style={{ animationDelay: '1.5s' }} />

      <div className="relative flex items-center gap-2.5 px-5 py-5">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-primary-400 to-primary text-white font-display font-bold shadow-soft anim-float">A</div>
        <div>
          <div className="font-display text-sm font-bold leading-tight tracking-tight">Anush <span className="text-gradient">Capitals</span></div>
          <div className="text-[9px] uppercase tracking-widest text-muted">Loan Management</div>
        </div>
        <button className="ml-auto lg:hidden" onClick={() => setDrawer(false)}><X size={18} /></button>
      </div>
      <nav className="relative flex-1 space-y-1 px-3">
        {NAV.map(({ to, label, icon: Icon }, i) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={() => setDrawer(false)}
            style={{ animationDelay: `${i * 45}ms` }}
            className={({ isActive }) =>
              cn(
                'anim-pop group relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-sm font-medium tracking-tight transition-all duration-200',
                isActive
                  ? 'bg-gradient-to-r from-primary to-primary-400 text-white font-semibold shadow-[0_8px_20px_-8px_rgba(79,70,229,.7)]'
                  : 'text-slate-500 dark:text-slate-400 hover:translate-x-1 hover:bg-slate-50 dark:hover:bg-white/[.05] hover:text-slate-700 dark:hover:text-slate-200'
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="pointer-events-none absolute inset-0 -translate-x-full skew-x-[-18deg] bg-white/25 [animation:sheen_3.5s_ease-in-out_infinite]" />}
                <Icon size={17} strokeWidth={isActive ? 2.4 : 2} className={cn('relative transition-transform group-hover:scale-110', isActive && 'drop-shadow')} />
                <span className="relative">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <button
        onClick={() => { dispatch(logout()); navigate('/login'); }}
        className="relative m-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium tracking-tight text-slate-500 dark:text-slate-400 transition-all hover:translate-x-1 hover:bg-danger-50 dark:hover:bg-danger/10 hover:text-danger"
      >
        <LogOut size={17} /> Logout
      </button>
    </aside>
  );

  return (
    <div className="aurora-bg flex h-dvh overflow-hidden">
      <div className="hidden lg:block">{sidebar}</div>
      {drawer && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm animate-[fadeIn_.2s_ease]" onClick={() => setDrawer(false)} />
          <div className="fixed inset-y-0 left-0 z-50">{sidebar}</div>
        </>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200/70 dark:border-white/[.06] px-4 lg:px-6">
          <button className="lg:hidden" onClick={() => setDrawer(true)}><Menu size={20} /></button>
          <div className="ml-auto flex items-center gap-2">
            <button className="relative grid h-10 w-10 place-items-center rounded-xl border border-slate-200 dark:border-white/[.08] text-slate-500 dark:text-slate-400 transition-all hover:-translate-y-0.5 hover:bg-slate-50 dark:hover:bg-white/[.06] hover:text-primary hover:shadow-md">
              <Bell size={17} />
              <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-danger anim-glow" />
            </button>
            <button onClick={toggleTheme} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 dark:border-white/[.08] text-slate-500 dark:text-slate-400 transition-all hover:-translate-y-0.5 hover:bg-slate-50 dark:hover:bg-white/[.06] hover:text-primary hover:shadow-md">
              {dark ? <Sun size={17} className="anim-spin-slow" /> : <Moon size={17} />}
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
