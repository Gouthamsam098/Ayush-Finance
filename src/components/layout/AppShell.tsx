import { createContext, useContext, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LogoMark } from '@/components/Logo';
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

/** Lets page headers (rendered inside <Outlet/>) open the mobile sidebar drawer. */
const OpenSidebarCtx = createContext<() => void>(() => {});
export const useOpenSidebar = () => useContext(OpenSidebarCtx);

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  // Off-canvas drawer state for mobile/tablet (<lg). Desktop ignores this.
  const [mobileOpen, setMobileOpen] = useState(false);
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
    <OpenSidebarCtx.Provider value={() => setMobileOpen(true)}>
    <div className="flex h-dvh overflow-hidden bg-slate-50 dark:bg-[#080b14]">
      {/* Mobile/tablet overlay — tap to dismiss the off-canvas sidebar */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside
        className={cn(
          // Mobile/tablet: fixed off-canvas drawer that slides in over the content.
          'fixed inset-y-0 left-0 z-50 flex w-[240px] flex-col overflow-hidden border-r border-slate-200 bg-white transition-transform duration-200 ease-[cubic-bezier(.4,0,.2,1)] dark:border-transparent dark:bg-[#0c1220]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop (lg+): static in-flow sidebar, width driven by collapse — unchanged.
          'lg:static lg:z-auto lg:shrink-0 lg:translate-x-0 lg:transition-[width]',
          collapsed ? 'lg:w-[72px]' : 'lg:w-[200px]',
        )}
      >
        {/* Logo + collapse toggle */}
        <div className={cn(
          'flex min-h-[58px] items-center gap-2.5 border-b border-slate-200 px-2.5 py-3 dark:border-white/[.07]',
          collapsed && 'justify-center gap-1 px-1.5',
        )}>
          <LogoMark className="h-8 w-8 rounded-[9px]" svg={19} />
          {!collapsed && (
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">Anush <span className="text-blue-700 dark:text-blue-400">Finserv</span></div>
              <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">Loan Management</div>
            </div>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-400 hover:text-slate-600 lg:flex dark:border-white/10 dark:bg-white/[.04] dark:text-slate-500 dark:hover:text-slate-300"
          >
            <ChevronsLeft size={14} className={cn('transition-transform duration-200', collapsed && 'rotate-180')} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-[7px] py-2">
          {NAV.map((section) => (
            <div key={section.heading}>
              {section.items.map(({ to, label, icon: Icon, badgeKey }) => {
                const badge = badgeFor(badgeKey);
                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    onClick={() => setMobileOpen(false)}
                    title={collapsed ? label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'group relative mb-px flex items-center gap-2.5 rounded-lg px-[7px] py-[9px] transition-colors',
                        collapsed && 'justify-center',
                        isActive ? 'bg-blue-50 dark:bg-blue-500/[.18]' : 'hover:bg-slate-100 dark:hover:bg-white/[.05]',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && !collapsed && (
                          <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-sm bg-blue-500" />
                        )}
                        <Icon
                          size={19}
                          className={cn(
                            'shrink-0 transition-colors',
                            isActive ? 'text-blue-600 dark:text-blue-300' : 'text-slate-500 group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-slate-200',
                          )}
                        />
                        {!collapsed && (
                          <span
                            className={cn(
                              'truncate text-[13px] transition-colors',
                              isActive ? 'font-semibold text-blue-700 dark:text-blue-100' : 'text-slate-600 group-hover:text-slate-900 dark:text-slate-300 dark:group-hover:text-slate-100',
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
                          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-[#0c1220]" />
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
        <div className="border-t border-slate-200 px-[7px] py-2 dark:border-white/[.07]">
          <div className="flex items-center gap-2 rounded-lg px-[3px] py-[5px]">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[10px] font-semibold text-white">
              AD
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">Admin</div>
                <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">Super Admin</div>
              </div>
            )}
          </div>
          <button
            onClick={toggleTheme}
            title={collapsed ? (dark ? 'Light mode' : 'Dark mode') : undefined}
            className={cn(
              'group mt-1 flex w-full items-center gap-2.5 rounded-lg px-[7px] py-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[.05] dark:hover:text-slate-200',
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
              'group mt-px flex w-full items-center gap-2.5 rounded-lg px-[7px] py-2 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-500/10 dark:hover:text-red-400',
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
    </OpenSidebarCtx.Provider>
  );
}
