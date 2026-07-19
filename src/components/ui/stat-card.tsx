import type { ReactNode } from 'react';

/**
 * StatCard — the premium KPI/triage card used across list pages (Loans,
 * Collections, …). An accent-tinted icon chip beside a bold value + label.
 * When `onClick` is provided it becomes an interactive triage filter that shows
 * an active ring in its accent color; otherwise it renders as a static metric.
 *
 * Theme-token friendly: the surface uses `bg-white dark:bg-surface` and text
 * uses `text-ink`/`text-muted`; only the per-card accent is passed as a raw
 * color so each metric can carry its own hue.
 */
export function StatCard({
  label,
  value,
  active,
  onClick,
  accent,
  icon,
}: {
  label: string;
  value: string;
  active?: boolean;
  onClick?: () => void;
  /** Raw accent color (e.g. '#6366f1') for the icon chip + active ring. */
  accent: string;
  icon: ReactNode;
}) {
  const clickable = !!onClick;
  return (
    <button
      onClick={onClick}
      disabled={!clickable}
      className={`group relative flex items-center gap-3 overflow-hidden rounded-xl border bg-white px-3.5 py-3 text-left transition-all dark:bg-surface ${
        active ? '' : 'border-slate-200/90 dark:border-white/[.07]'
      } ${clickable ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-10px_rgba(30,39,64,.2)]' : 'cursor-default'}`}
      style={{
        borderColor: active ? accent : undefined,
        boxShadow: active ? `0 0 0 2px ${accent}26` : '0 1px 2px rgba(30,39,64,.04)',
      }}
    >
      {active && (
        <span
          className="pointer-events-none absolute inset-0"
          style={{ background: `linear-gradient(135deg, ${accent}14, transparent 60%)` }}
        />
      )}
      <span
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white transition-transform duration-200 group-hover:scale-105"
        style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}
      >
        {icon}
      </span>
      <div className="relative min-w-0">
        <div className="font-display text-xl font-bold leading-none text-ink">{value}</div>
        <div className="mt-1 truncate text-[12px] font-medium text-muted">{label}</div>
      </div>
    </button>
  );
}
