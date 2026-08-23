import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtDate, todayISO } from '@/lib/format';
import { LiveClock } from '@/components/LiveClock';

export type PeriodMode = 'day' | 'month' | 'range';

/** Quick-range presets. The keys deliberately MATCH the charts' Range type
 *  ('month' | '3m' | '6m' | '1y'), so picking one can drive the Cash Flow and
 *  Loan Performance toggles to the same window — the whole dashboard then
 *  describes one period, and the KPI totals equal the sum of the chart bars. */
export type PeriodRangeKey = 'month' | '3m' | '6m' | '1y';
export const RANGE_PRESETS: { key: PeriodRangeKey; chip: string; label: string; months: number }[] = [
  { key: 'month', chip: 'This Month', label: 'This Month', months: 1 },
  { key: '3m', chip: '3 Months', label: 'Last 3 Months', months: 3 },
  { key: '6m', chip: '6 Months', label: 'Last 6 Months', months: 6 },
  { key: '1y', chip: '1 Year', label: 'Last 1 Year', months: 12 },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_HEADER = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const POPUP_WIDTH = 324; // four quick-range chips must fit on one row without wrapping
const GAP = 10;
const MARGIN = 12;

function toISO(y: number, m: number, d: number) {
  return `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseISO(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m - 1, d];
}

function monthLabel(iso: string) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

export function periodDisplayLabel(mode: PeriodMode, dateISO: string, rangeKey?: PeriodRangeKey) {
  if (mode === 'range') return RANGE_PRESETS.find((p) => p.key === rangeKey)?.label ?? 'Range';
  return mode === 'day' ? fmtDate(dateISO) : monthLabel(dateISO);
}

export function isPeriodDefault(mode: PeriodMode, dateISO: string, today = todayISO()) {
  if (mode === 'range') return false; // a range is always an explicit selection
  if (mode === 'day') return dateISO === today;
  return dateISO.slice(0, 7) === today.slice(0, 7);
}

interface PeriodFilterProps {
  mode: PeriodMode;
  dateISO: string;
  /** Active quick-range preset (meaningful when mode === 'range'). */
  rangeKey: PeriodRangeKey;
  onModeChange: (mode: PeriodMode) => void;
  onDateChange: (iso: string) => void;
  onRangeSelect: (key: PeriodRangeKey) => void;
  onReset: () => void;
}

/**
 * Premium day/month period control — calendar icon lives inside LiveClock.
 * Popup uses a light, soft palette.
 */
export function PeriodFilter({ mode, dateISO, rangeKey, onModeChange, onDateChange, onRangeSelect, onReset }: PeriodFilterProps) {
  const today = todayISO();
  const [ty, tm, td] = parseISO(today);
  const [sy, sm, sd] = parseISO(dateISO);
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(sy);
  const [viewMonth, setViewMonth] = useState(sm);
  const [popupStyle, setPopupStyle] = useState({ top: 0, left: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const isDefault = isPeriodDefault(mode, dateISO, today);

  const computePosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    let left = rect.right - POPUP_WIDTH;
    if (left < MARGIN) left = MARGIN;
    if (left + POPUP_WIDTH > window.innerWidth - MARGIN) {
      left = Math.max(MARGIN, window.innerWidth - POPUP_WIDTH - MARGIN);
    }
    setPopupStyle({ top: rect.bottom + GAP, left });
  }, []);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => {
    setOpen((o) => {
      if (!o) computePosition();
      return !o;
    });
  }, [computePosition]);

  useEffect(() => {
    setViewYear(sy);
    setViewMonth(sm);
  }, [sy, sm, dateISO]);

  useEffect(() => {
    if (!open) return;
    computePosition();
    const onScroll = () => close();
    const onResize = () => close();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!containerRef.current?.contains(t) && !popupRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close, computePosition]);

  const yearOptions = useMemo(() => {
    const out: number[] = [];
    for (let y = ty; y >= ty - 8; y--) out.push(y);
    return out;
  }, [ty]);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const startDay = new Date(viewYear, viewMonth, 1).getDay();
  const canGoNextMonth = viewYear < ty || (viewYear === ty && viewMonth < tm);

  const selectDay = (day: number) => {
    const iso = toISO(viewYear, viewMonth, day);
    if (iso > today) return;
    // Picking a concrete day always means day mode (also the path OUT of a range).
    if (mode !== 'day') onModeChange('day');
    onDateChange(iso);
    close();
  };

  const selectRange = (key: PeriodRangeKey) => {
    onRangeSelect(key);
    close();
  };

  const selectMonth = (monthIdx: number) => {
    if (viewYear > ty || (viewYear === ty && monthIdx > tm)) return;
    onDateChange(toISO(viewYear, monthIdx, 1));
    close();
  };

  const setMode = (next: PeriodMode) => {
    onModeChange(next);
    if (next === 'day') onDateChange(today);
    else onDateChange(toISO(ty, tm, 1));
  };

  const label = periodDisplayLabel(mode, dateISO, rangeKey);

  return (
    <div ref={containerRef} className="shrink-0">
      <LiveClock
        calendarOpen={open}
        onCalendarClick={toggle}
        periodHint={!isDefault ? label : undefined}
        onResetPeriod={!isDefault ? onReset : undefined}
      />

      {open && createPortal(
        <AnimatePresence>
          <motion.div
            ref={popupRef}
            role="dialog"
            aria-label="Select period"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            style={{ top: popupStyle.top, left: popupStyle.left, width: POPUP_WIDTH }}
            /* FULLY OPAQUE surface: an alpha stop here let the charts underneath
               bleed through the popup (bars/toggles visible through the panel). */
            className="fixed z-[300] overflow-hidden rounded-2xl border border-sky-200/70 bg-white bg-gradient-to-b from-white via-sky-50 to-white shadow-[0_24px_60px_-20px_rgba(56,119,210,.35),0_0_0_1px_rgba(255,255,255,.8)_inset] dark:border-white/[.1] dark:bg-[#0f172a] dark:from-[#0f172a] dark:via-[#0f172a] dark:to-[#111827] dark:shadow-[0_24px_60px_-16px_rgba(0,0,0,.55)]"
          >
            {/* Light premium header */}
            <div className="relative overflow-hidden border-b border-sky-100/80 bg-gradient-to-r from-sky-50 via-indigo-50/70 to-sky-50 px-3.5 py-3 dark:border-white/[.06] dark:from-sky-500/10 dark:via-indigo-500/10 dark:to-transparent">
              <span className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-sky-200/40 blur-2xl dark:bg-sky-400/10" />
              <div className="relative flex items-center justify-between gap-2">
                <div>
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-sky-700/70 dark:text-sky-200/70">
                    Portfolio period
                  </div>
                  <div className="mt-0.5 font-display text-[15px] font-bold tabular-nums text-ink">{label}</div>
                </div>
                <div className="inline-flex rounded-xl border border-sky-200/80 bg-white/80 p-0.5 shadow-sm dark:border-white/10 dark:bg-white/[.06]">
                  {(['day', 'month'] as PeriodMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={cn(
                        'rounded-lg px-2.5 py-1 text-[11.5px] font-bold capitalize transition-colors',
                        mode === m
                          ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/25'
                          : 'text-sky-700/70 hover:bg-sky-100/80 dark:text-sky-200/70 dark:hover:bg-white/[.08]',
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick ranges — one tap re-scopes the ENTIRE dashboard (KPIs +
                both charts) to the same calendar-month window. */}
            <div className="border-b border-sky-100/80 px-3 pb-2.5 pt-2.5 dark:border-white/[.06]">
              <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-sky-700/55 dark:text-sky-200/55">Quick ranges</div>
              <div className="grid grid-cols-4 gap-1.5">
                {RANGE_PRESETS.map((p) => {
                  const active = mode === 'range' && rangeKey === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => selectRange(p.key)}
                      className={cn(
                        'whitespace-nowrap rounded-lg px-1 py-1.5 text-[10.5px] font-bold transition-colors',
                        active
                          ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/30'
                          : 'border border-sky-200/70 bg-white text-sky-800/80 hover:bg-sky-400/45 hover:text-sky-950 dark:border-white/[.08] dark:bg-white/[.05] dark:text-sky-200/80 dark:hover:bg-sky-400/25 dark:hover:text-sky-100',
                      )}
                    >
                      {p.chip}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-3">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <button
                  type="button"
                  aria-label="Previous"
                  onClick={() => {
                    if (mode === 'month') setViewYear((y) => Math.max(ty - 8, y - 1));
                    else if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
                    else setViewMonth((m) => m - 1);
                  }}
                  className="grid h-8 w-8 place-items-center rounded-xl text-sky-700/70 hover:bg-sky-100 dark:text-sky-200/70 dark:hover:bg-white/[.08]"
                >
                  <ChevronLeft size={16} />
                </button>
                {mode !== 'month' ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-bold text-ink">{MONTHS[viewMonth]}</span>
                    <select
                      value={viewYear}
                      onChange={(e) => setViewYear(Number(e.target.value))}
                      className="rounded-lg border border-sky-200/80 bg-white/90 px-1.5 py-0.5 text-[12.5px] font-semibold text-ink outline-none dark:border-white/[.1] dark:bg-white/[.04]"
                    >
                      {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                ) : (
                  <select
                    value={viewYear}
                    onChange={(e) => setViewYear(Number(e.target.value))}
                    className="rounded-lg border border-sky-200/80 bg-white/90 px-2 py-0.5 text-[13px] font-bold text-ink outline-none dark:border-white/[.1] dark:bg-white/[.04]"
                  >
                    {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                )}
                <button
                  type="button"
                  aria-label="Next"
                  disabled={mode === 'month' ? viewYear >= ty : !canGoNextMonth}
                  onClick={() => {
                    if (mode === 'month') setViewYear((y) => Math.min(ty, y + 1));
                    else if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
                    else setViewMonth((m) => m + 1);
                  }}
                  className="grid h-8 w-8 place-items-center rounded-xl text-sky-700/70 hover:bg-sky-100 disabled:opacity-30 dark:text-sky-200/70 dark:hover:bg-white/[.08]"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              {mode !== 'month' ? (
                <>
                  <div className="mb-1 grid grid-cols-7 gap-0.5">
                    {DAYS_HEADER.map((d) => (
                      <div key={d} className="py-1 text-center text-[10px] font-bold uppercase tracking-wide text-sky-700/45 dark:text-sky-200/45">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-0.5">
                    {Array.from({ length: startDay }, (_, i) => <div key={`b${i}`} />)}
                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const day = i + 1;
                      const iso = toISO(viewYear, viewMonth, day);
                      const future = iso > today;
                      const selected = mode === 'day' && sy === viewYear && sm === viewMonth && sd === day;
                      const isTod = viewYear === ty && viewMonth === tm && day === td;
                      return (
                        <button
                          key={day}
                          type="button"
                          disabled={future}
                          onClick={() => selectDay(day)}
                          className={cn(
                            'grid h-9 place-items-center rounded-xl text-[12.5px] font-semibold tabular-nums transition-colors',
                            future && 'cursor-not-allowed text-muted/35',
                            !future && !selected && 'text-ink hover:bg-sky-400/45 hover:text-sky-950 dark:hover:bg-sky-400/25 dark:hover:text-sky-100',
                            selected && 'bg-sky-500 text-white shadow-sm shadow-sky-500/30',
                            isTod && !selected && 'ring-1 ring-sky-400/70',
                          )}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {MONTHS.map((m, idx) => {
                    const future = viewYear > ty || (viewYear === ty && idx > tm);
                    const selected = dateISO.slice(0, 7) === `${viewYear}-${String(idx + 1).padStart(2, '0')}`;
                    const isCur = viewYear === ty && idx === tm;
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={future}
                        onClick={() => selectMonth(idx)}
                        className={cn(
                          'rounded-xl px-2 py-2.5 text-[12.5px] font-semibold transition-colors',
                          future && 'cursor-not-allowed text-muted/35',
                          !future && !selected && 'text-ink hover:bg-sky-400/45 hover:text-sky-950 dark:hover:bg-sky-400/25 dark:hover:text-sky-100',
                          selected && 'bg-sky-500 text-white shadow-sm shadow-sky-500/30',
                          isCur && !selected && 'ring-1 ring-sky-400/70',
                        )}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
