import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { logout } from '@/store/authSlice';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Users, FileText, Receipt, Wallet, BarChart3,
  FolderOpen, Settings, Bell, Moon, Sun, Menu, X, LogOut } from 'lucide-react';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/loans', label: 'Loans', icon: FileText },
  { to: '/collections', label: 'Collections', icon: Receipt },
  { to: '/expenses', label: 'Expenses', icon: Wallet },
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
    <aside className="relative flex h-full w-60 flex-col overflow-hidden bg-white border-r border-slate-200">
      {/* Logo Section */}
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-lg shadow-md">
          A
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold text-slate-900">Anush <span className="text-blue-600">Capitals</span></div>
          <div className="text-xs text-slate-600">LOAN MANAGEMENT</div>
        </div>
        <button className="ml-auto lg:hidden text-slate-500 hover:text-slate-700" onClick={() => setDrawer(false)}>
          <X size={18} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="relative flex-1 space-y-1 px-3 py-4 overflow-y-auto">
        {NAV.map(({ to, label, icon: Icon }, i) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={() => setDrawer(false)}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 overflow-hidden',
                isActive
                  ? 'bg-blue-500 text-white shadow-lg shadow-blue-200/50'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={18} strokeWidth={isActive ? 2.5 : 2} className="relative transition-all group-hover:scale-110" />
                <span className="relative font-medium">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Bottom Section */}
      <div className="relative border-t border-slate-200 p-3 space-y-3">
        {/* Upgrade Card */}
        <div className="rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 p-4 text-center border border-blue-200">
          <div className="text-xs text-slate-600 mb-3">Grow your business</div>
          <div className="text-xs font-bold text-slate-900 mb-3">with smart insights</div>
          <button className="w-full text-xs font-bold text-blue-600 hover:text-blue-700 transition-colors">Upgrade Now</button>
        </div>

        {/* Logout Button */}
        <button
          onClick={() => {
            dispatch(logout());
            navigate('/login');
          }}
          className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition-all hover:text-red-600 hover:bg-red-50 group"
        >
          <LogOut size={18} className="group-hover:scale-110 transition-transform" />
          <span>Logout</span>
        </button>
      </div>
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
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 lg:px-6">
          <button className="lg:hidden text-slate-600 hover:text-slate-900 transition-colors" onClick={() => setDrawer(true)}>
            <Menu size={20} />
          </button>

          <div className="ml-auto flex items-center gap-4">
            {/* Search Bar - Hidden on Mobile */}
            <div className="hidden md:block">
              <input
                type="text"
                placeholder="Search customers, loans, collections..."
                className="w-64 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm placeholder-slate-500 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
              />
            </div>

            {/* Notification Button */}
            <button className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-all hover:bg-slate-100 hover:text-blue-600 group">
              <Bell size={18} strokeWidth={2} />
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            </button>

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-all hover:bg-slate-100 hover:text-blue-600"
            >
              {dark ? <Sun size={18} strokeWidth={2} /> : <Moon size={18} strokeWidth={2} />}
            </button>

            {/* User Profile */}
            <div className="ml-2 flex items-center gap-3 border-l border-slate-200 pl-4">
              <div className="text-right hidden sm:block">
                <div className="text-xs font-bold text-slate-900">Admin</div>
                <div className="text-xs text-slate-600">Super Admin</div>
              </div>
              <div className="h-9 w-9 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
                A
              </div>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto bg-slate-50 p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
