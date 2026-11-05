import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Inbox, Search, type LucideIcon } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { inr } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The detail popup behind a Dashboard KPI card.
 *
 * Deliberately PRESENTATIONAL, like OverdueLoansDialog: every number arrives
 * already computed by Dashboard from the SAME variables its card renders, so
 * the popup can only itemise what the card shows — it never works a figure out
 * a second way. Nothing in this file touches loan math.
 *
 * A card is explained three ways, each optional:
 *  • lines    — the arithmetic ("how it adds up"), ending on the card figure;
 *  • segments — the figure split by loan type / category, with share bars;
 *  • lists    — the underlying records; the last column totals the card figure.
 *
 * In development every one of those sums is checked against the card figure
 * and a mismatch is logged. A card and its popup disagreeing is the exact
 * confusion this dialog exists to remove, so drift must be loud.
 */

export type BreakdownAccent = 'blue' | 'indigo' | 'cyan' | 'orange' | 'emerald' | 'amber' | 'rose';

// Full class strings (not interpolated) so Tailwind's scanner keeps them.
const ACCENTS: Record<BreakdownAccent, { box: string; label: string; chip: string; bar: string; value: string }> = {
  blue: {
    box: 'border-blue-200 bg-blue-50 dark:border-blue-500/25 dark:bg-blue-500/[.07]',
    label: 'text-blue-700 dark:text-blue-300', chip: 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
    bar: 'bg-blue-500 dark:bg-blue-400', value: 'text-blue-600 dark:text-blue-400',
  },
  indigo: {
    box: 'border-indigo-200 bg-indigo-50 dark:border-indigo-500/25 dark:bg-indigo-500/[.07]',
    label: 'text-indigo-700 dark:text-indigo-300', chip: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400',
    bar: 'bg-indigo-500 dark:bg-indigo-400', value: 'text-indigo-600 dark:text-indigo-400',
  },
  cyan: {
    box: 'border-cyan-200 bg-cyan-50 dark:border-cyan-500/25 dark:bg-cyan-500/[.07]',
    label: 'text-cyan-700 dark:text-cyan-300', chip: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-400',
    bar: 'bg-cyan-500 dark:bg-cyan-400', value: 'text-cyan-600 dark:text-cyan-400',
  },
  orange: {
    box: 'border-orange-200 bg-orange-50 dark:border-orange-500/25 dark:bg-orange-500/[.07]',
    label: 'text-orange-700 dark:text-orange-300', chip: 'bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400',
    bar: 'bg-orange-500 dark:bg-orange-400', value: 'text-orange-600 dark:text-orange-400',
  },
  emerald: {
    box: 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/25 dark:bg-emerald-500/[.07]',
    label: 'text-emerald-700 dark:text-emerald-300', chip: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
    bar: 'bg-emerald-500 dark:bg-emerald-400', value: 'text-emerald-600 dark:text-emerald-400',
  },
  amber: {
    box: 'border-amber-200 bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/[.07]',
    label: 'text-amber-700 dark:text-amber-300', chip: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
    bar: 'bg-amber-500 dark:bg-amber-400', value: 'text-amber-600 dark:text-amber-400',
  },
  rose: {
    box: 'border-rose-200 bg-rose-50 dark:border-rose-500/25 dark:bg-rose-500/[.07]',
    label: 'text-rose-700 dark:text-rose-300', chip: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400',
    bar: 'bg-rose-500 dark:bg-rose-400', value: 'text-rose-600 dark:text-rose-400',
  },
};

/** One step of the arithmetic. `add` / `sub` move the total; `info` rows are
 *  indented and display-only (a part of the row above, never added again). */
export interface BreakdownLine {
  op: 'add' | 'sub' | 'info';
  label: string;
  note?: string;
  value: number;
  /** Value colour; defaults to ink. */
  tone?: string;
}

export interface BreakdownSegment {
  label: string;
  /** Pre-formatted, e.g. "3 loans". */
  meta?: string;
  value: number;
}

export interface BreakdownColumn {
  label: string;
}

export interface BreakdownRow {
  id: string | number;
  title: string;
  subtitle?: string;
  badge?: { label: string; tone: 'danger' | 'warning' | 'neutral' | 'success' };
  /** One value per column. `null` renders "—" (does not apply), never ₹0. */
  cells: (number | null)[];
  /** Lower-case text the search box matches against. */
  search?: string;
}

export interface BreakdownList {
  title: string;
  /** Header over the title column (sm+ only). */
  rowHeader: string;
  /** The LAST column is the one that totals to `total`. */
  columns: BreakdownColumn[];
  rows: BreakdownRow[];
  /** The card figure the last column must add up to. */
  total: number;
  /** e.g. "Total · 6 loans". */
  totalLabel: string;
  emptyText: string;
  searchPlaceholder?: string;
  /** Colour of the total column when it differs from the popup's accent
   *  (e.g. expenses inside the Profit popup read rose, not emerald). */
  valueTone?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  accent: BreakdownAccent;
  headline: {
    label: string;
    /** EXACTLY the value the card renders (the card shows inr(value)). */
    value: number;
    caption: string;
    aside?: string;
  };
  lines?: BreakdownLine[];
  /** Closing row of `lines`; its value is the card figure. */
  linesTotal?: { label: string; value: number };
  segments?: { title: string; items: BreakdownSegment[]; total: number };
  lists?: BreakdownList[];
  note?: ReactNode;
  /** Optional secondary way out to the full page. */
  link?: { label: string; onClick: () => void };
}

const PAGE = 20;
const BADGE: Record<NonNullable<BreakdownRow['badge']>['tone'], string> = {
  danger: 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/25',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25',
  neutral: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-white/[.06] dark:text-slate-300 dark:ring-white/10',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25',
};

const sameMoney = (a: number, b: number) => Math.abs(a - b) < 0.5;
const sectionLabel = 'text-[11px] font-bold uppercase tracking-wide text-muted';

export function KpiBreakdownDialog({
  open, onClose, title, subtitle, icon: Icon, accent, headline,
  lines, linesTotal, segments, lists, note, link,
}: Props) {
  const a = ACCENTS[accent];

  // Dev-only reconciliation: every breakdown must land on the card figure.
  useEffect(() => {
    if (!import.meta.env.DEV || !open) return;
    const problems: string[] = [];
    if (lines && linesTotal) {
      const sum = lines.reduce((s, l) => s + (l.op === 'add' ? l.value : l.op === 'sub' ? -l.value : 0), 0);
      if (!sameMoney(sum, linesTotal.value)) problems.push(`lines add to ${sum}, total row says ${linesTotal.value}`);
      if (!sameMoney(linesTotal.value, headline.value)) problems.push(`total row ${linesTotal.value} ≠ card ${headline.value}`);
    }
    if (segments) {
      const sum = segments.items.reduce((s, x) => s + x.value, 0);
      if (!sameMoney(sum, segments.total)) problems.push(`"${segments.title}" adds to ${sum}, expected ${segments.total}`);
    }
    for (const l of lists ?? []) {
      const last = l.columns.length - 1;
      const sum = l.rows.reduce((s, r) => s + (r.cells[last] ?? 0), 0);
      if (!sameMoney(sum, l.total)) problems.push(`"${l.title}" adds to ${sum}, expected ${l.total}`);
    }
    if (problems.length) console.error(`[${title}] popup does not reconcile with its card:`, problems);
  }, [open, title, headline.value, lines, linesTotal, segments, lists]);

  return (
    <Dialog
      wide
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      footer={(
        <>
          {link && (
            <Button variant="ghost" onClick={link.onClick}>
              {link.label} <ArrowRight size={14} />
            </Button>
          )}
          <Button onClick={onClose}>Close</Button>
        </>
      )}
    >
      <div className="space-y-5">
        {/* Headline — the card's own figure, in the card's colour. */}
        <div className={cn('flex items-start justify-between gap-3 rounded-xl border-[0.5px] px-4 py-3.5', a.box)}>
          <div className="min-w-0">
            <div className={cn('text-[11px] font-bold uppercase tracking-wide', a.label)}>{headline.label}</div>
            <div className={cn(
              'font-display text-2xl font-bold tabular-nums',
              headline.value < 0 ? 'text-red-600 dark:text-red-400' : 'text-ink',
            )}>
              {inr(headline.value)}
            </div>
            <div className="mt-0.5 text-[12px] text-muted">{headline.caption}</div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className={cn('grid h-10 w-10 place-items-center rounded-xl', a.chip)}><Icon size={19} aria-hidden /></span>
            {headline.aside && <span className="text-right text-[12px] font-semibold text-ink">{headline.aside}</span>}
          </div>
        </div>

        {lines && linesTotal && (
          <section>
            <div className={cn(sectionLabel, 'mb-2')}>How it adds up</div>
            <div className="overflow-hidden rounded-xl border-[0.5px] border-slate-200 dark:border-white/[.07]">
              {lines.map((r, i) => {
                const info = r.op === 'info';
                // The first term carries no visible sign — "+ ₹X" at the top of
                // a sum reads oddly — but keeps the column so the rows align.
                const sign = r.op === 'sub' ? '−' : '+';
                const signTone = r.op === 'sub' ? 'text-rose-500' : r.op === 'add' && i > 0 ? 'text-emerald-500' : 'text-transparent';
                return (
                  <div
                    key={`${r.label}-${i}`}
                    className={cn(
                      'flex items-center justify-between gap-3 border-b border-slate-100 px-3.5 py-2.5 dark:border-white/[.06]',
                      info && 'bg-slate-50/70 dark:bg-white/[.02]',
                    )}
                  >
                    <div className={cn('flex min-w-0 items-start gap-2.5', info && 'pl-5')}>
                      <span className={cn('mt-px w-3 shrink-0 text-center font-display text-[15px] font-bold', info ? 'text-transparent' : signTone)} aria-hidden>{sign}</span>
                      <div className="min-w-0">
                        <div className={cn('text-[13px] text-ink', info ? 'font-normal' : 'font-medium')}>
                          <span className="sr-only">{info ? 'of which, ' : r.op === 'sub' ? 'minus, ' : i > 0 ? 'plus, ' : ''}</span>
                          {r.label}
                        </div>
                        {r.note && <div className="text-[11.5px] text-muted">{r.note}</div>}
                      </div>
                    </div>
                    <div className={cn('shrink-0 font-display tabular-nums', info ? 'text-[13.5px] font-semibold' : 'text-[15px] font-bold', r.tone ?? 'text-ink')}>
                      {inr(r.value)}
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center justify-between gap-3 bg-slate-50 px-3.5 py-2.5 dark:bg-white/[.03]">
                <div className="text-[13px] font-semibold text-ink">= {linesTotal.label}</div>
                <div className={cn(
                  'font-display text-[15px] font-bold tabular-nums',
                  linesTotal.value < 0 ? 'text-red-600 dark:text-red-400' : a.value,
                )}>
                  {inr(linesTotal.value)}
                </div>
              </div>
            </div>
          </section>
        )}

        {segments && segments.items.length > 0 && <Segments {...segments} bar={a.bar} />}

        {lists?.map((l) => <ListSection key={l.title} list={l} open={open} valueTone={l.valueTone ?? a.value} />)}

        {note && (
          <div className="rounded-xl border-[0.5px] border-slate-200 bg-slate-50 px-3.5 py-3 text-[11.5px] leading-relaxed text-muted dark:border-white/[.06] dark:bg-white/[.02]">
            {note}
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** Share of the figure per group — real values only, bars scaled to the total. */
function Segments({ title, items, total, bar }: { title: string; items: BreakdownSegment[]; total: number; bar: string }) {
  return (
    <section>
      <div className={cn(sectionLabel, 'mb-2')}>{title}</div>
      <div className="space-y-3 rounded-xl border-[0.5px] border-slate-200 px-3.5 py-3 dark:border-white/[.07]">
        {items.map((s) => {
          const pct = total > 0 ? (s.value / total) * 100 : 0;
          const pctText = pct === 0 ? '0%' : pct < 1 ? '<1%' : `${Math.round(pct)}%`;
          return (
            <div key={s.label}>
              <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="min-w-0 truncate font-medium text-ink">
                  {s.label}
                  {s.meta && <span className="ml-1.5 font-normal text-muted">· {s.meta}</span>}
                </span>
                <span className="shrink-0 font-display font-bold tabular-nums text-ink">
                  {inr(s.value)}
                  <span className="ml-1.5 inline-block w-8 text-right text-[11px] font-medium text-muted">{pctText}</span>
                </span>
              </div>
              <div
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[.06]"
                role="img"
                aria-label={`${s.label}: ${pctText} of the total`}
              >
                <motion.div
                  className={cn('h-full rounded-full', bar)}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ListSection({ list, open, valueTone }: { list: BreakdownList; open: boolean; valueTone: string }) {
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  // A fresh open starts clean — no leftover search hiding rows.
  useEffect(() => { if (open) { setQuery(''); setShown(PAGE); } }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? list.rows.filter((r) => (r.search ?? r.title.toLowerCase()).includes(q)) : list.rows),
    [list.rows, q],
  );
  const visible = filtered.slice(0, shown);
  const last = list.columns.length - 1;
  // Totals always cover EVERY row, not just the filtered page — the last one
  // is the card figure and must not change with a search.
  const colTotals = list.columns.map((_, i) => {
    const vals = list.rows.map((r) => r.cells[i]).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
  });
  const tpl = { gridTemplateColumns: `minmax(0,1fr) repeat(${list.columns.length}, minmax(5.5rem, auto))` };
  const searchable = list.rows.length > 8;

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className={sectionLabel}>
          {list.title}
          <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-px text-[10.5px] font-semibold text-muted dark:bg-white/[.06]">{list.rows.length}</span>
        </div>
        {searchable && (
          <label className="relative w-full sm:w-56">
            <span className="sr-only">Search {list.title.toLowerCase()}</span>
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }}
              placeholder={list.searchPlaceholder ?? 'Search'}
              className="h-8 w-full rounded-lg border-[0.5px] border-slate-200 bg-transparent pl-8 pr-2.5 text-[12.5px] text-ink placeholder:text-muted focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-white/10"
            />
          </label>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border-[0.5px] border-slate-200 dark:border-white/[.07]">
        {list.rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-muted dark:bg-white/[.06]"><Inbox size={18} aria-hidden /></span>
            <p className="max-w-xs text-[12.5px] text-muted">{list.emptyText}</p>
          </div>
        ) : (
          <>
            <div
              className="hidden gap-3 border-b border-slate-100 bg-slate-50 px-3.5 py-2 text-[10.5px] font-bold uppercase tracking-wide text-muted sm:grid dark:border-white/[.06] dark:bg-white/[.03]"
              style={tpl}
            >
              <span>{list.rowHeader}</span>
              {list.columns.map((c) => <span key={c.label} className="text-right">{c.label}</span>)}
            </div>

            {visible.length === 0 && (
              <p className="px-4 py-6 text-center text-[12.5px] text-muted">Nothing matches “{query.trim()}”.</p>
            )}

            {visible.map((r) => (
              <div
                key={r.id}
                className="flex flex-col gap-1.5 border-b border-slate-100 px-3.5 py-2.5 transition-colors hover:bg-slate-50/70 sm:grid sm:items-center sm:gap-3 dark:border-white/[.06] dark:hover:bg-white/[.02]"
                style={tpl}
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-ink">{r.title}</span>
                    {r.badge && (
                      <span className={cn('shrink-0 rounded-full px-1.5 py-px text-[10.5px] font-semibold ring-1 ring-inset', BADGE[r.badge.tone])}>
                        {r.badge.label}
                      </span>
                    )}
                  </div>
                  {r.subtitle && <div className="truncate text-[11.5px] text-muted">{r.subtitle}</div>}
                </div>
                {/* Phones: label/value pairs under the title. sm+: `contents`
                    drops this wrapper so each value becomes a grid column. */}
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 sm:contents">
                  {r.cells.map((v, i) => (
                    <div key={list.columns[i]?.label ?? i} className="flex items-baseline gap-1.5 sm:block sm:text-right">
                      <span className="text-[11px] text-muted sm:hidden">{list.columns[i]?.label}</span>
                      <span className={cn(
                        'tabular-nums',
                        i === last ? cn('font-display text-[13.5px] font-bold', valueTone) : 'text-[12.5px] text-ink/80',
                      )}>
                        {v == null ? '—' : inr(v)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {filtered.length > shown && (
              <div className="border-b border-slate-100 px-3.5 py-2 text-center dark:border-white/[.06]">
                <button
                  type="button"
                  onClick={() => setShown((n) => n + PAGE)}
                  className="rounded-lg px-3 py-1 text-[12.5px] font-semibold text-primary hover:bg-primary/[.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  Show {Math.min(PAGE, filtered.length - shown)} more · {filtered.length - shown} hidden
                </button>
              </div>
            )}

            <div className="flex flex-col gap-1 bg-slate-50 px-3.5 py-2.5 sm:grid sm:items-center sm:gap-3 dark:bg-white/[.03]" style={tpl}>
              <div className="text-[13px] font-semibold text-ink">
                = {list.totalLabel}
                {q && <span className="ml-1.5 text-[11.5px] font-normal text-muted">(all {list.rows.length}, not just the {filtered.length} shown)</span>}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 sm:contents">
                {colTotals.map((v, i) => (
                  <div key={list.columns[i].label} className="flex items-baseline gap-1.5 sm:block sm:text-right">
                    <span className="text-[11px] text-muted sm:hidden">{list.columns[i].label}</span>
                    <span className={cn(
                      'font-display tabular-nums',
                      i === last ? cn('text-[15px] font-bold', valueTone) : 'text-[13px] font-semibold text-ink',
                    )}>
                      {v == null ? '—' : inr(v)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
