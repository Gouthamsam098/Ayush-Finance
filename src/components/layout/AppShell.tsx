import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { logout } from '@/store/authSlice';
import { useData } from '@/mock/DataContext';
import { todayISO } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Users, FileText, Receipt, Wallet, BarChart3,
  FolderOpen, Settings, ChevronsLeft, LogOut, Moon, Sun,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface NavItem { to: string; label: string; icon: LucideIcon; badgeKey?: 'overdue' }
interface NavSection { heading: string; items: NavItem[] }

const NAV: NavSection[] = [
  {
    heading: 'Main',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/customers', label: 'Customers', icon: Users },
      { to: '/loans', label: 'Loans', icon: FileText, badgeKey: 'overdue' },
      { to: '/collections', label: 'Collections', icon: Receipt },
    ],
  },
  {
    heading: 'Finance',
    items: [
      { to: '/expenses', label: 'Expenses', icon: Wallet },
      { to: '/reports', label: 'Reports', icon: BarChart3 },
    ],
  },
  {
    heading: 'System',
    items: [
      { to: '/documents', label: 'Documents', icon: FolderOpen },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const d = useData();

  const toggleTheme = () => {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      return next;
    });
  };

  // Overdue loans drive the red badge on the Loans nav item.
  const today = todayISO();
  const overdueCount = d.loans.filter(
    (l) => l.status === 'ACTIVE' && l.nextDueDate && l.nextDueDate < today && d.outstandingFor(l) > 0,
  ).length;
  const badgeFor = (key?: 'overdue') => (key === 'overdue' && overdueCount > 0 ? overdueCount : null);

  return (
    <div className="flex h-dvh overflow-hidden bg-slate-50 dark:bg-[#080b14]">
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside
        className={cn(
          'flex shrink-0 flex-col overflow-hidden bg-[#0c1220] transition-[width] duration-200 ease-[cubic-bezier(.4,0,.2,1)]',
          collapsed ? 'w-[54px]' : 'w-[200px]',
        )}
      >
        {/* Logo + collapse toggle */}
        <div className="flex min-h-[58px] items-center gap-2.5 border-b border-white/[.07] px-2.5 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-indigo-500 text-sm font-semibold text-white">
            A
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="truncate text-sm font-semibold text-slate-50">Anush Capitals</div>
              <div className="truncate text-[11px] text-slate-400">Loan Management</div>
            </div>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[.04] text-slate-500 hover:text-slate-300"
          >
            <ChevronsLeft size={14} className={cn('transition-transform duration-200', collapsed && 'rotate-180')} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-[7px] py-2">
          {NAV.map((section) => (
            <div key={section.heading}>
              {!collapsed && (
                <div className="px-1.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                  {section.heading}
                </div>
              )}
              {section.items.map(({ to, label, icon: Icon, badgeKey }) => {
                const badge = badgeFor(badgeKey);
                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    title={collapsed ? label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'group relative mb-px flex items-center gap-2.5 rounded-lg px-[7px] py-[9px] transition-colors',
                        collapsed && 'justify-center',
                        isActive ? 'bg-indigo-500/[.18]' : 'hover:bg-white/[.05]',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && !collapsed && (
                          <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-sm bg-indigo-500" />
                        )}
                        <Icon
                          size={19}
                          className={cn(
                            'shrink-0 transition-colors',
                            isActive ? 'text-indigo-300' : 'text-slate-400 group-hover:text-slate-200',
                          )}
                        />
                        {!collapsed && (
                          <span
                            className={cn(
                              'truncate text-[13px] transition-colors',
                              isActive ? 'font-semibold text-indigo-100' : 'text-slate-300 group-hover:text-slate-100',
                            )}
                          >
                            {label}
                          </span>
                        )}
                        {badge != null && !collapsed && (
                          <span className="ml-auto shrink-0 rounded-full bg-red-500 px-[5px] py-px text-[9px] font-semibold text-white">
                            {badge}
                          </span>
                        )}
                        {badge != null && collapsed && (
                          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-[#0c1220]" />
                        )}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer — user + logout */}
        <div className="border-t border-white/[.07] px-[7px] py-2">
          <div className="flex items-center gap-2 rounded-lg px-[3px] py-[5px]">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-[10px] font-semibold text-white">
              AD
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="truncate text-[13px] font-semibold text-slate-100">Admin</div>
                <div className="truncate text-[11px] text-slate-400">Super Admin</div>
              </div>
            )}
          </div>
          <button
            onClick={toggleTheme}
            title={collapsed ? (dark ? 'Light mode' : 'Dark mode') : undefined}
            className={cn(
              'group mt-1 flex w-full items-center gap-2.5 rounded-lg px-[7px] py-2 text-slate-400 transition-colors hover:bg-white/[.05] hover:text-slate-200',
              collapsed && 'justify-center',
            )}
          >
            {dark ? <Sun size={19} className="shrink-0" /> : <Moon size={19} className="shrink-0" />}
            {!collapsed && <span className="text-[13px]">{dark ? 'Light mode' : 'Dark mode'}</span>}
          </button>
          <button
            onClick={() => { dispatch(logout()); navigate('/login'); }}
            title={collapsed ? 'Logout' : undefined}
            className={cn(
              'group mt-px flex w-full items-center gap-2.5 rounded-lg px-[7px] py-2 text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-400',
              collapsed && 'justify-center',
            )}
          >
            <LogOut size={19} className="shrink-0" />
            {!collapsed && <span className="text-[13px]">Logout</span>}
          </button>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
