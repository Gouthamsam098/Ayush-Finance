import type { ReactNode } from 'react';

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
  return (
    <div className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-r from-indigo-50 via-white to-indigo-50 px-5 py-5 dark:border-transparent dark:from-[#0c1220] dark:via-[#111a30] dark:to-[#0c1220]">
      {/* Indigo glow wash + decorative geometry */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="absolute -left-16 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full bg-indigo-500/10 blur-3xl dark:bg-indigo-600/20" />
        <span className="absolute right-24 top-1/2 h-40 w-40 -translate-y-1/2 rounded-full bg-violet-500/[.07] blur-3xl dark:bg-violet-500/10" />
        <span className="absolute -right-12 -top-12 h-48 w-48 rounded-full border border-indigo-300/40 dark:border-indigo-400/20" />
        <span className="absolute right-10 top-6 h-24 w-24 rounded-full border border-indigo-300/30 dark:border-indigo-400/15" />
        <span className="absolute -bottom-10 right-40 h-24 w-24 rounded-full border border-violet-300/30 dark:border-violet-400/10" />
      </div>

      <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-100 to-violet-100 text-indigo-600 shadow-sm ring-1 ring-indigo-200/50 dark:border-indigo-400/40 dark:from-indigo-500/40 dark:to-violet-500/30 dark:text-indigo-100 dark:shadow-lg dark:shadow-indigo-900/40 dark:ring-white/10">
            {icon}
          </span>
          <div>
            <div className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</div>
            {subtitle && <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</div>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
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

/** Primary (indigo) button styled for the dark PageHeader. */
export function HeaderPrimaryButton({
  icon, children, onClick,
}: { icon?: ReactNode; children: ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-indigo-600"
    >
      {icon}{children}
    </button>
  );
}
