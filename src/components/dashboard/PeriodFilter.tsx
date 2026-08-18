import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtDate, todayISO } from '@/lib/format';
import { LiveClock } from '@/components/LiveClock';

export type PeriodMode = 'day' | 'month';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_HEADER = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const POPUP_WIDTH = 304;
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

export function periodDisplayLabel(mode: PeriodMode, dateISO: string) {
  return mode === 'day' ? fmtDate(dateISO) : monthLabel(dateISO);
}

export function isPeriodDefault(mode: PeriodMode, dateISO: string, today = todayISO()) {
  if (mode === 'day') return dateISO === today;
  return dateISO.slice(0, 7) === today.slice(0, 7);
}

interface PeriodFilterProps {
  mode: PeriodMode;
  dateISO: string;
  onModeChange: (mode: PeriodMode) => void;
  onDateChange: (iso: string) => void;
  onReset: () => void;
}

/**
 * Premium day/month period control — calendar icon lives inside LiveClock.
 * Popup uses a light, soft palette.
 */
export function PeriodFilter({ mode, dateISO, onModeChange, onDateChange, onReset }: PeriodFilterProps) {
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
    onDateChange(iso);
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

  const label = periodDisplayLabel(mode, dateISO);

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
            className="fixed z-[300] overflow-hidden rounded-2xl border border-sky-200/70 bg-gradient-to-b from-white via-sky-50/40 to-white shadow-[0_24px_60px_-20px_rgba(56,119,210,.35),0_0_0_1px_rgba(255,255,255,.8)_inset] dark:border-white/[.1] dark:from-[#0f172a] dark:via-[#0f172a] dark:to-[#111827] dark:shadow-[0_24px_60px_-16px_rgba(0,0,0,.55)]"
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
                {mode === 'day' ? (
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

              {mode === 'day' ? (
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
