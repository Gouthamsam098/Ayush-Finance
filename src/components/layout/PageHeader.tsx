import type { ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { useOpenSidebar } from './AppShell';

/** Dark hero band at the top of a page — mirrors the dashboard hero so every
 *  screen shares the same chrome. Left: icon + title + subtitle. Right: actions. */
export function PageHeader({
  icon,
  title,
  subtitle,
  actions,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  const openSidebar = useOpenSidebar();
  return (
    <div className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-r from-blue-50 via-white to-blue-50 px-5 py-5 dark:border-transparent dark:from-[#0c1220] dark:via-[#111a30] dark:to-[#0c1220]">
      {/* Indigo glow wash + decorative geometry */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="absolute -left-16 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full bg-blue-500/10 blur-3xl dark:bg-blue-600/20" />
        <span className="absolute right-24 top-1/2 h-40 w-40 -translate-y-1/2 rounded-full bg-blue-500/[.07] blur-3xl dark:bg-blue-500/10" />
        <span className="absolute -right-12 -top-12 h-48 w-48 rounded-full border border-blue-300/40 dark:border-blue-400/20" />
        <span className="absolute right-10 top-6 h-24 w-24 rounded-full border border-blue-300/30 dark:border-blue-400/15" />
        <span className="absolute -bottom-10 right-40 h-24 w-24 rounded-full border border-blue-300/30 dark:border-blue-400/10" />
      </div>

      <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            onClick={openSidebar}
            aria-label="Open menu"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 lg:hidden dark:border-white/15 dark:bg-white/[.08] dark:text-slate-300"
          >
            <Menu size={18} />
          </button>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-100 to-blue-100 text-blue-600 shadow-sm ring-1 ring-blue-200/50 dark:border-blue-400/40 dark:from-blue-500/40 dark:to-blue-500/30 dark:text-blue-100 dark:shadow-lg dark:shadow-blue-900/40 dark:ring-white/10">
            {icon}
          </span>
          <div>
            <div className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white truncate">{title}</div>
            {subtitle && <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</div>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 ml-auto">{actions}</div>}
      </div>
    </div>
  );
}

/** Ghost button styled for the dark PageHeader. */
export function HeaderGhostButton({
  icon, children, onClick,
}: { icon?: ReactNode; children: ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg border-[0.5px] border-slate-200 bg-white px-3.5 py-2 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-white/15 dark:bg-white/[.08] dark:text-slate-200 dark:hover:bg-white/[.14]"
    >
      {icon}{children}
    </button>
  );
}

/** Primary button styled for the PageHeader. With `beam`, a white light streak
 *  continuously runs 360° around the border (opt-in — off by default). */
export function HeaderPrimaryButton({
  icon, children, onClick, beam = false,
}: { icon?: ReactNode; children: ReactNode; onClick?: () => void; beam?: boolean }) {
  const btn = (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-blue-600"
    >
      {icon}{children}
    </button>
  );
  if (!beam) return btn;
  return (
    <span className="relative inline-flex overflow-hidden rounded-[10px] bg-blue-900 p-[2px] shadow-[0_2px_12px_-2px_rgba(37,99,235,.55)]">
      {/* Rotating conic gradient over a dark-blue track — only the ~2px ring
          shows, so a bright white line travels around the button's perimeter.
          The dark track keeps the white beam visible on any page background. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-[-45%] animate-[spin_3s_linear_infinite] bg-[conic-gradient(from_0deg,transparent_0%,transparent_62%,#ffffff_82%,#ffffff_90%,transparent_99%)]"
      />
      {/* Button sits above the beam and hides its centre. */}
      <span className="relative z-10 inline-flex">{btn}</span>
    </span>
  );
}
