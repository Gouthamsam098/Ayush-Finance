import { useState, useRef, useEffect, useCallback, useMemo, type InputHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Calendar, ChevronDown } from 'lucide-react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_HEADER = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DEFAULT_YEAR_MAX = new Date().getFullYear();
const DEFAULT_YEAR_MIN = DEFAULT_YEAR_MAX - 100;

const toISODate = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const parseDate = (iso: string): [number, number, number] | null => {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return null;
  return [y, m - 1, d];
};

interface DatePickerProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  label?: string;
  error?: string;
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  yearMin?: number;
  yearMax?: number;
}

const POPUP_WIDTH = 272;
const GAP = 6;
const MARGIN = 12;

export function DatePicker({ label, error, value, onChange, className, yearMin, yearMax, ...props }: DatePickerProps) {
  const yMin = yearMin ?? DEFAULT_YEAR_MIN;
  const yMax = yearMax ?? DEFAULT_YEAR_MAX;

  const yearOptions = useMemo(() => {
    const arr: number[] = [];
    for (let y = yMax; y >= yMin; y--) arr.push(y);
    return arr;
  }, [yMin, yMax]);

  const today = useMemo(() => {
    const d = new Date();
    return [d.getFullYear(), d.getMonth(), d.getDate()] as const;
  }, []);

  const parsed = parseDate(value);
  const [viewYear, setViewYear] = useState(parsed?.[0] ?? today[0]);
  const [viewMonth, setViewMonth] = useState(parsed?.[1] ?? today[1]);
  const [open, setOpen] = useState(false);
  const [popupStyle, setPopupStyle] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const computePosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    let left = rect.left;
    const top = rect.bottom + GAP;

    if (left + POPUP_WIDTH > window.innerWidth - MARGIN) {
      left = Math.max(MARGIN, window.innerWidth - POPUP_WIDTH - MARGIN);
    }

    setPopupStyle({ top, left });
  }, []);

  useEffect(() => {
    if (parsed) {
      setViewYear(parsed[0]);
      setViewMonth(parsed[1]);
    }
  }, [value]);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    computePosition();

    const onScroll = () => close();
    const onResize = () => close();

    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);

    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideContainer = containerRef.current?.contains(target);
      const insidePopup = popupRef.current?.contains(target);
      if (!insideContainer && !insidePopup) close();
    };
    document.addEventListener('mousedown', handler);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close, computePosition]);

  const daysInMonth = useCallback((y: number, m: number) => new Date(y, m + 1, 0).getDate(), []);
  const firstDayOfMonth = useCallback((y: number, m: number) => new Date(y, m, 1).getDay(), []);

  const selectDate = useCallback(
    (day: number) => {
      onChange({ target: { value: toISODate(viewYear, viewMonth, day) } });
      close();
    },
    [viewYear, viewMonth, onChange, close],
  );

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  };

  const totalDays = daysInMonth(viewYear, viewMonth);
  const startDay = firstDayOfMonth(viewYear, viewMonth);
  const blankCells = Array.from({ length: startDay }, (_, i) => ({ day: 0, key: `b${i}` }));
  const dayCells = Array.from({ length: totalDays }, (_, i) => ({ day: i + 1, key: `d${i}` }));

  const isToday = (d: number) => viewYear === today[0] && viewMonth === today[1] && d === today[2];
  const isSelected = (d: number) => parsed?.[0] === viewYear && parsed[1] === viewMonth && parsed[2] === d;
  const isFuture = (d: number) => new Date(viewYear, viewMonth, d + 1) > new Date();

  const displayValue = parsed
    ? new Date(parsed[0], parsed[1], parsed[2]).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
      })
    : '';

  const toggle = () => {
    if (!open) computePosition();
    setOpen((o) => !o);
  };

  return (
    <div ref={containerRef}>
      <label className="block">
        {label && (
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">{label}</span>
        )}
        <div className="relative">
          <input
            type="text"
            readOnly
            value={displayValue}
            placeholder="Select date…"
            onClick={toggle}
            className={cn(
              'w-full cursor-pointer rounded-xl border bg-white dark:bg-surface pl-3.5 pr-10 py-2.5 text-sm outline-none',
              'shadow-[inset_0_1px_2px_rgba(15,23,42,.03)] dark:shadow-none',
              'border-slate-200 dark:border-white/[.08] placeholder:text-slate-400 dark:placeholder:text-slate-500',
              'transition-shadow duration-150 select-none',
              'focus:border-primary focus:ring-4 focus:ring-primary/10',
              error && 'border-danger focus:border-danger focus:ring-danger/10',
              className,
            )}
            {...props}
          />
          <button
            type="button"
            onClick={toggle}
            className="absolute right-2 top-1/2 -translate-y-1/2 grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-slate-100 hover:text-ink dark:hover:bg-white/[.08]"
          >
            <Calendar size={15} />
          </button>
        </div>
        {error && <span className="mt-1 block text-xs font-medium text-danger">{error}</span>}
      </label>

      {open &&
        createPortal(
          <AnimatePresence>
            <motion.div
              ref={popupRef}
              initial={{ opacity: 0, y: -6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              style={{ top: popupStyle.top, left: popupStyle.left, width: POPUP_WIDTH }}
              className="fixed z-[300] overflow-hidden rounded-2xl border-[0.5px] border-slate-200/80 bg-white shadow-[0_20px_60px_-12px_rgba(15,23,42,.25),0_0_0_1px_rgba(15,23,42,.04)] dark:border-white/[.08] dark:bg-surface dark:shadow-[0_20px_60px_-12px_rgba(0,0,0,.45)]"
            >
              <div className="relative overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-600 px-3 pb-3 pt-3">
                <span className="pointer-events-none absolute -right-6 -top-8 h-16 w-16 rounded-full bg-white/10 blur-xl" />
                <span className="pointer-events-none absolute -bottom-3 right-10 h-10 w-10 rounded-full border border-white/10" />

                <div className="relative flex items-center justify-between gap-1.5">
                  <button
                    type="button"
                    onClick={prevMonth}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white/80 transition-colors hover:bg-white/15 hover:text-white"
                  >
                    <ChevronLeft size={15} />
                  </button>

                  <div className="flex items-center gap-1">
                    <div className="relative">
                      <select
                        value={viewMonth}
                        onChange={(e) => setViewMonth(Number(e.target.value))}
                        className="appearance-none cursor-pointer rounded-md border border-white/[.15] bg-transparent px-2.5 py-1 pr-6 text-[13px] font-semibold text-white outline-none transition-colors hover:bg-white/[.08] focus:bg-white/[.12] [&>option]:bg-slate-800 [&>option]:text-white dark:[&>option]:bg-slate-900"
                      >
                        {MONTHS.map((m, i) => (
                          <option key={m} value={i}>{m}</option>
                        ))}
                      </select>
                      <ChevronDown size={10} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-white/50" />
                    </div>

                    <div className="relative">
                      <select
                        value={viewYear}
                        onChange={(e) => setViewYear(Number(e.target.value))}
                        className="appearance-none cursor-pointer rounded-md border border-white/[.15] bg-transparent px-2.5 py-1 pr-6 text-[13px] font-semibold text-white outline-none transition-colors hover:bg-white/[.08] focus:bg-white/[.12] [&>option]:bg-slate-800 [&>option]:text-white dark:[&>option]:bg-slate-900"
                      >
                        {yearOptions.map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                      <ChevronDown size={10} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-white/50" />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={nextMonth}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white/80 transition-colors hover:bg-white/15 hover:text-white"
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>

              </div>

              <div className="px-3.5 pb-3.5 pt-2.5">
                <div className="mb-1.5 grid grid-cols-7">
                  {DAYS_HEADER.map((d) => (
                    <div key={d} className="grid h-7 place-items-center text-[10px] font-bold uppercase tracking-wider text-muted/60">
                      {d}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-y-0.5">
                  {blankCells.map(({ key }) => (
                    <div key={key} className="grid h-9 place-items-center" />
                  ))}
                  {dayCells.map(({ day, key }) => {
                    const _today = isToday(day);
                    const _selected = isSelected(day);
                    const _future = isFuture(day);
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={_future}
                        onClick={() => !_future && selectDate(day)}
                        className={cn(
                          'relative grid h-9 place-items-center rounded-lg text-[13px] font-semibold transition-all duration-150',
                          _future
                            ? 'cursor-not-allowed text-muted/30'
                            : 'cursor-pointer text-ink/85 hover:bg-slate-100 dark:hover:bg-white/[.06]',
                          _selected &&
                            'bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-[0_4px_12px_rgba(37,99,235,.4)] hover:from-blue-600 hover:to-indigo-600',
                          _today && !_selected && 'ring-2 ring-blue-400/50 text-blue-600 font-bold bg-blue-50/80 dark:bg-blue-500/[.08]',
                        )}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
