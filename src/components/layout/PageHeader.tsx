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
    <div className="relative overflow-hidden bg-gradient-to-r from-[#0c1220] via-[#111a30] to-[#0c1220] px-5 py-5">
      {/* Indigo glow wash + decorative geometry */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="absolute -left-16 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full bg-indigo-600/20 blur-3xl" />
        <span className="absolute right-24 top-1/2 h-40 w-40 -translate-y-1/2 rounded-full bg-violet-500/10 blur-3xl" />
        <span className="absolute -right-12 -top-12 h-48 w-48 rounded-full border border-indigo-400/20" />
        <span className="absolute right-10 top-6 h-24 w-24 rounded-full border border-indigo-400/15" />
        <span className="absolute -bottom-10 right-40 h-24 w-24 rounded-full border border-violet-400/10" />
      </div>

      <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-400/40 bg-gradient-to-br from-indigo-500/40 to-violet-500/30 text-indigo-100 shadow-lg shadow-indigo-900/40 ring-1 ring-white/10">
            {icon}
          </span>
          <div>
            <div className="font-display text-2xl font-bold tracking-tight text-white">{title}</div>
            {subtitle && <div className="mt-0.5 text-sm text-slate-400">{subtitle}</div>}
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
      className="flex items-center gap-1.5 rounded-lg border-[0.5px] border-white/15 bg-white/[.08] px-3.5 py-2 text-[13px] font-medium text-slate-200 transition-colors hover:bg-white/[.14]"
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
