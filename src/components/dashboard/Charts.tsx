import { type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ComposedChart, Area,
} from 'recharts';
import { inrShort, inr } from '@/lib/format';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────
   Dashboard charts (Recharts). Palette matches the fintech spec:
     primary  #4F46E5   success #22C55E   danger #EF4444   warning #F59E0B
   Axis/grid use the `--muted` CSS var so they adapt to light/dark;
   surfaces use theme tokens. Every chart shows an honest empty
   state and never invents history — periods with no data plot ₹0.
   ──────────────────────────────────────────────────────────── */

export const C = { primary: '#4F46E5', success: '#22C55E', danger: '#EF4444', warning: '#F59E0B' };
const AXIS = 'rgb(var(--muted))';
const GRID = 'rgb(var(--muted) / 0.14)';
const tick = { fill: AXIS, fontSize: 11 };

/** Time-range selector for the Cash Flow chart. 'month' = this month, all days. */
export type Range = 'month' | '3m' | '6m' | '1y';
const RANGE_LABEL: Record<Range, string> = { month: 'This Month', '3m': '3M', '6m': '6M', '1y': '1Y' };
export function RangeToggle({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border-[0.5px] border-slate-200 p-0.5 dark:border-white/[.1]">
      {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={cn(
            'rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors',
            value === r ? 'bg-primary text-white' : 'text-muted hover:text-ink',
          )}
        >
          {RANGE_LABEL[r]}
        </button>
      ))}
    </div>
  );
}

/** Section card — rounded-2xl, thin border, soft shadow, hover lift, 24px pad. */
export function ChartCard({ title, subtitle, right, children, className }: {
  title: string; subtitle?: string; right?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <div className={cn('rounded-2xl border-[0.5px] border-slate-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(17,24,39,.04)] transition-all duration-200 hover:shadow-[0_8px_28px_-14px_rgba(17,24,39,.18)] dark:border-white/[.08] dark:bg-surface', className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold tracking-tight text-ink">{title}{subtitle && <span className="ml-1.5 text-[13px] font-medium text-muted">{subtitle}</span>}</h3>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/** A static "This Month" style pill (dropdown look) — cosmetic period label. */
export function PeriodPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border-[0.5px] border-slate-200/80 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink/70 dark:border-white/[.08] dark:bg-surface">
      {children}
      <svg className="h-3 w-3 text-muted" viewBox="0 0 20 20" fill="none"><path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  );
}

function EmptyChart({ label, height = 300 }: { label: string; height?: number }) {
  return (
    <div className="grid place-items-center text-center" style={{ height }}>
      <div>
        <div className="mx-auto mb-2 h-10 w-10 rounded-full bg-slate-100 dark:bg-white/[.05]" />
        <p className="text-[13px] font-medium text-muted">{label}</p>
      </div>
    </div>
  );
}

// ── KPI card (Section 1) ──
export interface KpiTrend { value: string; positive: boolean }
export function KpiCard({ icon: Icon, tint, iconColor, label, value, hint, trend }: {
  icon: LucideIcon; tint: string; iconColor: string; label: string; value: string; hint?: string; trend?: KpiTrend | null;
}) {
  return (
    <div className="group rounded-2xl border-[0.5px] border-slate-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(17,24,39,.04)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-14px_rgba(17,24,39,.22)] dark:border-white/[.08] dark:bg-surface">
      <div className="flex items-start justify-between">
        <span className={cn('grid h-10 w-10 place-items-center rounded-xl transition-transform duration-200 group-hover:scale-105', tint, iconColor)}>
          <Icon size={19} />
        </span>
        {trend && (
          <span className={cn('inline-flex items-center gap-0.5 text-[12.5px] font-bold', trend.positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400')}>
            {trend.positive ? '↑' : '↓'} {trend.value}
          </span>
        )}
      </div>
      <div className="mt-3 text-[12.5px] font-medium text-muted">{label}</div>
      <div className="mt-1 font-display text-[23px] font-bold leading-none tracking-tight tabular-nums text-ink">{value}</div>
      {hint && <div className="mt-1.5 text-[11.5px] text-muted">{hint}</div>}
    </div>
  );
}

// ── Loan Performance — Disbursed vs Collected (₹) per month, grouped bars ──
export interface LoanPerfPoint { month: string; disbursed: number; collected: number; }
export function LoanPerformanceChart({ data }: { data: LoanPerfPoint[] }) {
  const hasData = data.some((d) => d.disbursed > 0 || d.collected > 0);
  if (!hasData) return <EmptyChart label="No disbursals or collections in this range" height={300} />;
  // "Radium" treatment: each bar is a luminous tube — bright neon tip fading
  // into a deep base — wrapped in a soft same-hue glow. The MID hues are what
  // the eye averages, and that pair (#EA580C orange / #0891B2 cyan) is
  // validated for CVD separation + contrast on light AND dark surfaces.
  // (Orange + lime FAILS colorblind checks — ΔE 1.7 deutan — so orange's
  // partner must sit on the cool side; tritium-glow cyan is the neon fit.)
  const NEON = {
    disbursed: { top: '#FB923C', base: '#9A3412', mid: '#EA580C' },
    collected: { top: '#22D3EE', base: '#155E75', mid: '#0891B2' },
  } as const;
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -6, bottom: 0 }} barGap={4}>
        <defs>
          <linearGradient id="lpGradDisb" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={NEON.disbursed.top} />
            <stop offset="100%" stopColor={NEON.disbursed.base} />
          </linearGradient>
          <linearGradient id="lpGradColl" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={NEON.collected.top} />
            <stop offset="100%" stopColor={NEON.collected.base} />
          </linearGradient>
          <filter id="lpGlowDisb" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="0" stdDeviation="3.5" floodColor={NEON.disbursed.mid} floodOpacity="0.55" />
          </filter>
          <filter id="lpGlowColl" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="0" stdDeviation="3.5" floodColor={NEON.collected.mid} floodOpacity="0.55" />
          </filter>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="month" tick={tick} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v) => inrShort(v)} tick={tick} axisLine={false} tickLine={false} width={52} />
        <Tooltip cursor={{ fill: 'rgb(var(--muted) / 0.06)' }} content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          return (
            <div className="rounded-lg border-[0.5px] border-slate-200/80 bg-white px-3 py-2 text-[12px] shadow-lg dark:border-white/10 dark:bg-surface2">
              <div className="mb-1 font-semibold text-ink">{label}</div>
              {payload.map((p) => (
                <div key={String(p.name)} className="flex items-center gap-2 tabular-nums">
                  {/* Solid swatch (gradient url() can't paint a CSS background) */}
                  <span className="h-2 w-2 rounded-full" style={{ background: p.dataKey === 'disbursed' ? NEON.disbursed.mid : NEON.collected.mid }} />
                  <span className="text-muted">{p.name}:</span>
                  <span className="font-semibold text-ink">{inr(Number(p.value))}</span>
                </div>
              ))}
            </div>
          );
        }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingBottom: 4 }} verticalAlign="top" height={28} />
        <Bar dataKey="disbursed" name="Disbursed" fill="url(#lpGradDisb)" filter="url(#lpGlowDisb)" radius={[5, 5, 0, 0]} maxBarSize={26} />
        <Bar dataKey="collected" name="Collected" fill="url(#lpGradColl)" filter="url(#lpGlowColl)" radius={[5, 5, 0, 0]} maxBarSize={26} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Cash Flow Trend — Collections (green) / Expenses (red) / Profit (blue) ──
// Three INDEPENDENT per-period lines; `net` carries pure profit (interest
// earned that period — same rule as the Profit KPI). Expenses are their own
// line, never subtracted from profit.
export interface CashFlowPoint { label: string; collections: number; expenses: number; net: number; }
export function CashFlowChart({ data, height = 240 }: { data: CashFlowPoint[]; height?: number | `${number}%` }) {
  const hasData = data.some((d) => d.collections || d.expenses);
  if (!hasData) return <EmptyChart label="No cash flow in this range" height={typeof height === 'number' ? height : 320} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
        <defs>
          <linearGradient id="cfColl" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.success} stopOpacity={0.55} />
            <stop offset="45%" stopColor={C.success} stopOpacity={0.28} />
            <stop offset="100%" stopColor={C.success} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="cfExp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.danger} stopOpacity={0.4} />
            <stop offset="55%" stopColor={C.danger} stopOpacity={0.16} />
            <stop offset="100%" stopColor={C.danger} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="cfNet" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.primary} stopOpacity={0.5} />
            <stop offset="50%" stopColor={C.primary} stopOpacity={0.22} />
            <stop offset="100%" stopColor={C.primary} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={28} />
        <YAxis tickFormatter={(v) => inrShort(v)} tick={tick} axisLine={false} tickLine={false} width={52} />
        <Tooltip cursor={{ stroke: 'rgb(var(--muted) / 0.3)' }} content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          return (
            <div className="rounded-lg border-[0.5px] border-slate-200/80 bg-white px-3 py-2 text-[12px] shadow-lg dark:border-white/10 dark:bg-surface2">
              <div className="mb-1 font-semibold text-ink">{label}</div>
              {payload.map((p) => (
                <div key={String(p.name)} className="flex items-center gap-2 tabular-nums">
                  <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? p.stroke }} />
                  <span className="text-muted">{p.name}:</span>
                  <span className="font-semibold text-ink">{inr(Number(p.value))}</span>
                </div>
              ))}
            </div>
          );
        }} />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, paddingBottom: 4 }} verticalAlign="top" height={28} />
        {/* Sharp (linear) lines with a soft area fill — the "spiky" look. */}
        <Area type="linear" dataKey="collections" name="Collections" stroke={C.success} strokeWidth={2.5} fill="url(#cfColl)" dot={false} activeDot={{ r: 4 }} />
        <Area type="linear" dataKey="expenses" name="Expenses" stroke={C.danger} strokeWidth={2.5} fill="url(#cfExp)" dot={false} activeDot={{ r: 4 }} />
        <Area type="linear" dataKey="net" name="Profit" stroke={C.primary} strokeWidth={2.5} fill="url(#cfNet)" dot={false} activeDot={{ r: 4 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Collection Efficiency — semicircle radial gauge (custom SVG) ──
// pct === null → no collection activity yet; render an empty "No data" gauge
// rather than a misleading 100%.
export function EfficiencyGauge({ pct }: { pct: number | null }) {
  const R = 80, CX = 100, CY = 100, STROKE = 16;
  const circ = Math.PI * R;              // half-circle arc length
  const hasData = pct != null;
  const clamped = Math.max(0, Math.min(100, pct ?? 0));
  const dash = hasData ? (clamped / 100) * circ : 0;
  const color = clamped >= 90 ? C.success : clamped >= 70 ? C.warning : C.danger;
  const rating = clamped >= 90 ? 'Excellent' : clamped >= 75 ? 'Good' : clamped >= 50 ? 'Fair' : 'Needs attention';
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 116" className="w-full max-w-[240px]">
        {/* track */}
        <path d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`} fill="none" stroke="rgb(var(--muted) / 0.15)" strokeWidth={STROKE} strokeLinecap="round" />
        {/* value arc (only when there's data) */}
        {hasData && (
          <path
            d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
            fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
            style={{ transition: 'stroke-dasharray .7s cubic-bezier(.22,1,.36,1)' }}
          />
        )}
        {hasData ? (
          <>
            <text x={CX} y={CY - 12} textAnchor="middle" className="fill-ink font-display" style={{ fontSize: 30, fontWeight: 800 }}>{clamped}%</text>
            <text x={CX} y={CY + 8} textAnchor="middle" style={{ fontSize: 12, fontWeight: 600, fill: color }}>{rating}</text>
          </>
        ) : (
          <>
            <text x={CX} y={CY - 14} textAnchor="middle" className="fill-ink font-display" style={{ fontSize: 26, fontWeight: 800 }}>—</text>
            <text x={CX} y={CY + 6} textAnchor="middle" style={{ fontSize: 11.5, fontWeight: 600, fill: 'rgb(var(--muted))' }}>No activity yet</text>
          </>
        )}
      </svg>
    </div>
  );
}
