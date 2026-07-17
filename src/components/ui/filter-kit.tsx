import { motion } from 'framer-motion';
import { inrShort } from '@/lib/format';
import { NUM_OPS, numActive, numLabel, type NumFilter, type NumOp } from '@/lib/customerFilters';

/* ────────────────────────────────────────────────────────────
   Shared building blocks for the premium filter drawers
   (used by Customers, Loans, …). Extracted so every page's
   filter UI looks and behaves identically.
   ──────────────────────────────────────────────────────────── */

export const drawerSelectCls =
  'rounded-lg border-[0.5px] border-slate-200/70 bg-white px-3 py-2 text-[13px] text-ink outline-none transition-colors focus:border-indigo-500 dark:border-white/[.08] dark:bg-surface2';

// ─────────────── section card ───────────────
export type GroupColor = 'blue' | 'emerald' | 'violet' | 'amber';
const groupIconCls: Record<GroupColor, string> = {
  blue: 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
  emerald: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
  violet: 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400',
  amber: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
};
const groupAccentCls: Record<GroupColor, string> = {
  blue: 'before:bg-blue-500',
  emerald: 'before:bg-emerald-500',
  violet: 'before:bg-violet-500',
  amber: 'before:bg-amber-500',
};
const groupDotCls: Record<GroupColor, string> = {
  blue: 'bg-blue-500',
  emerald: 'bg-emerald-500',
  violet: 'bg-violet-500',
  amber: 'bg-amber-500',
};

/** A premium filter section card: colored left accent, icon chip, and an
 *  active indicator dot when the section has filters set. */
export function FilterCard({
  icon, title, color, active, children,
}: { icon: React.ReactNode; title: string; color: GroupColor; active?: boolean; children: React.ReactNode }) {
  return (
    <section
      className={`relative overflow-hidden rounded-2xl border-[0.5px] border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)] transition-shadow hover:shadow-[0_8px_24px_-16px_rgba(15,23,42,.2)] dark:border-white/[.06] dark:bg-surface2
        before:absolute before:inset-y-0 before:left-0 before:w-1 ${groupAccentCls[color]} ${active ? 'before:opacity-100' : 'before:opacity-25'}`}
    >
      <div className="mb-3 flex items-center gap-2.5">
        <span className={`grid h-8 w-8 place-items-center rounded-lg ${groupIconCls[color]}`}>{icon}</span>
        <h4 className="flex-1 text-[14px] font-bold tracking-tight text-ink">{title}</h4>
        {active && <span className={`h-2 w-2 rounded-full ${groupDotCls[color]}`} />}
      </div>
      {children}
    </section>
  );
}

// ─────────────── segmented control ───────────────
export type SegTone = 'indigo' | 'emerald' | 'amber';
const segActiveCls: Record<SegTone, string> = {
  indigo: 'bg-indigo-500 text-white shadow-sm',
  emerald: 'bg-emerald-500 text-white shadow-sm',
  amber: 'bg-amber-500 text-white shadow-sm',
};

/** A compact segmented control container. */
export function SegGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-1 rounded-lg border-[0.5px] border-slate-200/70 bg-slate-100/70 p-1 dark:border-white/[.06] dark:bg-white/[.04]">
      {children}
    </div>
  );
}

/** A single compact segment. Highlights when active. */
export function Seg({
  active, onClick, tone = 'indigo', children,
}: { active: boolean; onClick: () => void; tone?: SegTone; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-md px-2 py-1.5 text-[13px] font-semibold transition-all ${
        active ? segActiveCls[tone] : 'text-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

// ─────────────── pills & toggles ───────────────
/** A rounded selector pill (cities, loan types, …). */
export function CityPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border-[0.5px] px-3.5 py-1.5 text-[13px] font-medium transition-all ${
        active
          ? 'border-violet-400 bg-violet-50 text-violet-700 ring-1 ring-violet-300 dark:border-violet-400/50 dark:bg-violet-500/15 dark:text-violet-300'
          : 'border-slate-200/70 bg-white text-ink/70 hover:border-slate-300 hover:bg-slate-50 dark:border-white/[.08] dark:bg-surface2 dark:hover:bg-white/[.05]'
      }`}
    >
      {children}
    </button>
  );
}

/** A pill toggle row (icon + label + hint) with an on/off switch look. */
export function ToggleRow({
  active, onToggle, icon, label, hint, tone = 'indigo',
}: { active: boolean; onToggle: () => void; icon: React.ReactNode; label: string; hint?: string; tone?: 'indigo' | 'danger' }) {
  const activeCls = tone === 'danger'
    ? 'border-red-300 bg-red-50 dark:border-red-400/40 dark:bg-red-500/10'
    : 'border-indigo-300 bg-indigo-50 dark:border-indigo-400/40 dark:bg-indigo-500/10';
  const iconCls = tone === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-indigo-600 dark:text-indigo-400';
  return (
    <button
      onClick={onToggle}
      className={`mt-3 flex w-full items-center gap-3 rounded-xl border-[0.5px] px-3.5 py-3 text-left transition-all ${
        active ? activeCls : 'border-slate-200/70 bg-white hover:bg-slate-50 dark:border-white/[.08] dark:bg-surface2 dark:hover:bg-white/[.05]'
      }`}
    >
      <span className={active ? iconCls : 'text-muted'}>{icon}</span>
      <span className="flex-1">
        <span className={`block text-[13px] font-semibold ${active ? 'text-ink' : 'text-ink/80'}`}>{label}</span>
        {hint && <span className="block text-[11px] text-muted">{hint}</span>}
      </span>
      {/* Switch */}
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${active ? (tone === 'danger' ? 'bg-red-500' : 'bg-indigo-500') : 'bg-slate-300 dark:bg-white/15'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${active ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

// ─────────────── numeric comparator row ───────────────
/** A numeric filter row: operator selector + one/two value inputs. */
export function NumFilterRow({
  label, unit, value, onChange,
}: {
  label: string;
  unit?: string;
  value: NumFilter;
  onChange: (v: NumFilter) => void;
}) {
  const showTwo = value.op === 'between';
  const showInputs = value.op !== 'any';
  const parseNum = (s: string) => (s.trim() === '' ? null : Number(s.replace(/[^\d.]/g, '')));
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-muted">{label}</span>
        {numActive(value) && (
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
            {numLabel(value, (n) => (unit === '₹' ? inrShort(n) : String(n)))}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <select
          value={value.op}
          onChange={(e) => onChange({ ...value, op: e.target.value as NumOp })}
          className="shrink-0 rounded-lg border-[0.5px] border-slate-200/70 bg-white px-2.5 py-2 text-[13px] text-ink outline-none focus:border-indigo-500 dark:border-white/[.08] dark:bg-surface2"
        >
          {NUM_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {showInputs && (
          <div className="flex flex-1 items-center gap-2">
            <div className="relative flex-1">
              {unit && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-muted">{unit}</span>}
              <input
                inputMode="numeric"
                value={value.a ?? ''}
                onChange={(e) => onChange({ ...value, a: parseNum(e.target.value) })}
                placeholder={showTwo ? 'Min' : 'Value'}
                className={`w-full rounded-lg border-[0.5px] border-slate-200/70 bg-white py-2 text-[13px] text-ink outline-none focus:border-indigo-500 dark:border-white/[.08] dark:bg-surface2 ${unit ? 'pl-6 pr-2.5' : 'px-2.5'}`}
              />
            </div>
            {showTwo && (
              <>
                <span className="text-muted">–</span>
                <div className="relative flex-1">
                  {unit && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-muted">{unit}</span>}
                  <input
                    inputMode="numeric"
                    value={value.b ?? ''}
                    onChange={(e) => onChange({ ...value, b: parseNum(e.target.value) })}
                    placeholder="Max"
                    className={`w-full rounded-lg border-[0.5px] border-slate-200/70 bg-white py-2 text-[13px] text-ink outline-none focus:border-indigo-500 dark:border-white/[.08] dark:bg-surface2 ${unit ? 'pl-6 pr-2.5' : 'px-2.5'}`}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────── sticky match preview ───────────────
/** Sticky drawer header: live match count, ratio bar, active count + clear. */
export function MatchPreview({
  matched, total, activeCount, itemLabel, onClear,
}: { matched: number; total: number; activeCount: number; itemLabel: string; onClear: () => void }) {
  return (
    <div className="sticky -top-5 z-10 -mx-6 -mt-5 border-b-[0.5px] border-slate-200/70 bg-white/90 px-6 py-4 backdrop-blur dark:border-white/[.06] dark:bg-surface/90">
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-2xl font-bold text-ink">{matched}</span>
            <span className="text-[13px] text-muted">of {total} {itemLabel}</span>
          </div>
          <div className="mt-0.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
            {activeCount === 0 ? 'No filters applied' : `${activeCount} filter${activeCount === 1 ? '' : 's'} set`}
          </div>
        </div>
        {activeCount > 0 && (
          <button onClick={onClear} className="text-[12px] font-semibold text-muted hover:text-danger">
            Clear
          </button>
        )}
      </div>
      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/[.08]">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
          initial={false}
          animate={{ width: `${total ? (matched / total) * 100 : 0}%` }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </div>
  );
}
