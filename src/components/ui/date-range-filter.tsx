import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange, Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { addDays, fmtDate, isoLocal, todayISO } from '@/lib/format';

export type DateRangePresetId =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'lastMonth'
  | 'custom';

const PRESETS: { id: DateRangePresetId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last7', label: 'Last 7 Days' },
  { id: 'last30', label: 'Last 30 Days' },
  { id: 'thisMonth', label: 'This Month' },
  { id: 'lastMonth', label: 'Last Month' },
  { id: 'custom', label: 'Custom range' },
];

function startOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

function lastDayOfMonth(year: number, month1: number): string {
  const last = new Date(year, month1, 0).getDate();
  return isoLocal(new Date(year, month1 - 1, last));
}

export function presetDateRange(id: DateRangePresetId): { from: string; to: string } {
  const today = todayISO();
  switch (id) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'thisMonth':
      return { from: startOfMonth(today), to: today };
    case 'lastMonth': {
      const [y, m] = today.split('-').map(Number);
      const prevMonth = m === 1 ? 12 : m - 1;
      const prevYear = m === 1 ? y - 1 : y;
      const from = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
      const to = lastDayOfMonth(prevYear, prevMonth);
      return { from, to };
    }
    default:
      return { from: today, to: today };
  }
}

function detectPreset(from: string, to: string): DateRangePresetId | null {
  if (!from && !to) return null;
  for (const p of PRESETS) {
    if (p.id === 'custom') continue;
    const r = presetDateRange(p.id);
    if (r.from === from && r.to === to) return p.id;
  }
  return 'custom';
}

function formatRangeLabel(from: string, to: string): string {
  if (!from && !to) return 'All dates';
  if (from && to && from === to) return fmtDate(from);
  if (from && to) return `${fmtDate(from)} – ${fmtDate(to)}`;
  if (from) return `From ${fmtDate(from)}`;
  return `Until ${fmtDate(to)}`;
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function buildMonthCells(year: number, monthIndex0: number): (string | null)[] {
  const first = new Date(year, monthIndex0, 1);
  const pad = first.getDay();
  const daysInMonth = new Date(year, monthIndex0 + 1, 0).getDate();
  const cells: (string | null)[] = Array(pad).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(isoLocal(new Date(year, monthIndex0, d)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function MonthGrid({
  year,
  monthIndex0,
  rangeFrom,
  rangeTo,
  maxDate,
  onPick,
}: {
  year: number;
  monthIndex0: number;
  rangeFrom: string;
  rangeTo: string;
  maxDate: string;
  onPick: (iso: string) => void;
}) {
  const label = new Date(year, monthIndex0, 1).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
  });
  const cells = buildMonthCells(year, monthIndex0);
  const start = rangeFrom && rangeTo && rangeFrom > rangeTo ? rangeTo : rangeFrom;
  const end = rangeFrom && rangeTo && rangeFrom > rangeTo ? rangeFrom : rangeTo || rangeFrom;

  return (
    <div className="min-w-[13.5rem] flex-1">
      <p className="mb-2 text-center text-[13px] font-bold text-ink">{label}</p>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold text-muted">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <span key={d} className="py-1">{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((iso, i) => {
          if (!iso) return <span key={`e-${i}`} className="h-8" />;
          const disabled = iso > maxDate;
          const inRange = start && end && iso >= start && iso <= end;
          const isStart = iso === start;
          const isEnd = iso === end;
          return (
            <button
              key={iso}
              type="button"
              disabled={disabled}
              onClick={() => onPick(iso)}
              className={cn(
                'h-8 rounded-lg text-[12px] font-semibold tabular-nums transition-colors',
                disabled && 'cursor-not-allowed text-muted/40',
                !disabled && !inRange && 'text-ink hover:bg-primary/10',
                inRange && 'bg-primary/15 text-primary',
                (isStart || isEnd) && 'bg-primary text-white shadow-sm hover:bg-primary',
              )}
            >
              {parseIso(iso).getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface DateRangeFilterProps {
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
  onClear: () => void;
  className?: string;
}

export function DateRangeFilter({ from, to, onApply, onClear, className }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [preset, setPreset] = useState<DateRangePresetId | null>(() => detectPreset(from, to));
  const [viewMonth, setViewMonth] = useState(() => {
    const base = from || todayISO();
    const d = parseIso(base);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const maxDate = todayISO();

  useEffect(() => {
    if (!open) return;
    setDraftFrom(from);
    setDraftTo(to);
    setPreset(detectPreset(from, to));
    const base = from || todayISO();
    const d = parseIso(base);
    setViewMonth({ year: d.getFullYear(), month: d.getMonth() });
  }, [open, from, to]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const rightMonth = useMemo(() => {
    const m = viewMonth.month + 1;
    if (m > 11) return { year: viewMonth.year + 1, month: 0 };
    return { year: viewMonth.year, month: m };
  }, [viewMonth]);

  const canGoNext = useMemo(() => {
    const leftYm = viewMonth.year * 12 + viewMonth.month;
    const maxYm = parseIso(maxDate).getFullYear() * 12 + parseIso(maxDate).getMonth();
    return leftYm + 2 <= maxYm;
  }, [viewMonth, maxDate]);

  const selectPreset = (id: DateRangePresetId) => {
    setPreset(id);
    if (id === 'custom') return;
    const r = presetDateRange(id);
    setDraftFrom(r.from);
    setDraftTo(r.to);
    const d = parseIso(r.from);
    setViewMonth({ year: d.getFullYear(), month: d.getMonth() });
  };

  const pickDay = (iso: string) => {
    setPreset('custom');
    if (!draftFrom || (draftFrom && draftTo)) {
      setDraftFrom(iso);
      setDraftTo('');
      return;
    }
    if (iso < draftFrom) {
      setDraftTo(draftFrom);
      setDraftFrom(iso);
    } else {
      setDraftTo(iso);
    }
  };

  const apply = () => {
    let f = draftFrom.trim();
    let t = draftTo.trim() || f;
    if (f && t && f > t) [f, t] = [t, f];
    onApply(f, t);
    setOpen(false);
  };

  const cancel = () => {
    setDraftFrom(from);
    setDraftTo(to);
    setPreset(detectPreset(from, to));
    setOpen(false);
  };

  const active = Boolean(from || to);

  return (
    <div ref={wrapRef} className={cn('relative shrink-0', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex h-12 w-full min-h-11 items-center justify-center gap-2 rounded-xl border px-3.5 text-[13px] font-semibold transition-colors sm:h-11 sm:w-auto sm:min-w-[10.5rem]',
          active
            ? 'border-primary/35 bg-primary/[.06] text-primary'
            : 'border-slate-200 bg-surface text-ink hover:border-primary/25 dark:border-white/[.08]',
        )}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <CalendarRange size={16} className="shrink-0" aria-hidden />
        <span className="truncate">{formatRangeLabel(from, to)}</span>
      </button>

      {open && (
        <>
        <button
          type="button"
          aria-label="Close date filter"
          className="fixed inset-0 z-40 bg-ink/25 sm:hidden"
          onClick={cancel}
        />
        <div
          role="dialog"
          aria-label="Choose date range"
          className={cn(
            'z-50 overflow-hidden rounded-2xl border border-slate-200/90 bg-surface shadow-glow dark:border-white/[.1]',
            'fixed inset-x-3 bottom-3 top-auto max-h-[min(90dvh,32rem)] sm:absolute sm:inset-auto sm:right-0 sm:top-[calc(100%+0.5rem)] sm:max-h-none sm:w-[min(100vw-2rem,42rem)]',
          )}
        >
          <div className="flex max-h-[min(90dvh,32rem)] flex-col sm:max-h-[28rem] sm:flex-row">
            <nav
              className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200/80 p-2 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-2 sm:py-3 dark:border-white/[.08]"
              aria-label="Quick ranges"
            >
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectPreset(p.id)}
                  className={cn(
                    'shrink-0 rounded-lg px-3 py-2 text-left text-[12px] font-semibold transition-colors sm:w-full sm:py-2.5 sm:pl-3 sm:pr-4',
                    preset === p.id
                      ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                      : 'text-ink hover:bg-slate-50 dark:hover:bg-white/[.04]',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </nav>

            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-white/[.06]">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() =>
                    setViewMonth((v) => {
                      const m = v.month - 1;
                      return m < 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: m };
                    })
                  }
                  className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-slate-100 hover:text-ink dark:hover:bg-white/[.06]"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  aria-label="Next month"
                  disabled={!canGoNext}
                  onClick={() =>
                    setViewMonth((v) => {
                      const m = v.month + 1;
                      return m > 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: m };
                    })
                  }
                  className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-slate-100 hover:text-ink disabled:opacity-30 dark:hover:bg-white/[.06]"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
              <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3 sm:flex-row sm:gap-3">
                <MonthGrid
                  year={viewMonth.year}
                  monthIndex0={viewMonth.month}
                  rangeFrom={draftFrom}
                  rangeTo={draftTo}
                  maxDate={maxDate}
                  onPick={pickDay}
                />
                <MonthGrid
                  year={rightMonth.year}
                  monthIndex0={rightMonth.month}
                  rangeFrom={draftFrom}
                  rangeTo={draftTo}
                  maxDate={maxDate}
                  onPick={pickDay}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 bg-slate-50/50 px-3 py-2.5 dark:border-white/[.08] dark:bg-white/[.02]">
            {active ? (
              <button
                type="button"
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
                className="text-[12px] font-semibold text-muted hover:text-ink"
              >
                Clear filter
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" className="h-9 px-3 text-[12px]" onClick={cancel}>
                <X size={14} /> Cancel
              </Button>
              <Button
                type="button"
                variant="success"
                className="h-9 px-4 text-[12px]"
                onClick={apply}
                disabled={!draftFrom}
              >
                <Check size={14} /> Apply
              </Button>
            </div>
          </div>
        </div>
        </>
      )}
    </div>
  );
}
