import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Calendar, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

function DigitPair({ value }: { value: string }) {
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-white/80 bg-gradient-to-b from-white via-white to-sky-50/80 px-1.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,1),0_1px_2px_rgba(15,23,42,.04)] dark:border-white/[.12] dark:from-white/[.1] dark:via-white/[.06] dark:to-sky-500/[.06] sm:px-2 sm:py-[5px]">
      <motion.span
        key={value}
        initial={{ y: 4, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="block font-display text-[13px] font-bold leading-none tracking-tight tabular-nums text-ink sm:text-[14px]"
      >
        {value}
      </motion.span>
    </div>
  );
}

function Colon() {
  return (
    <motion.span
      className="pb-px font-display text-[12px] font-semibold text-sky-700/30 dark:text-sky-200/35"
      animate={{ opacity: [1, 0.28, 1] }}
      transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
    >
      :
    </motion.span>
  );
}

export interface LiveClockProps {
  /** When set, a calendar control is shown inside the clock chrome. */
  onCalendarClick?: () => void;
  calendarOpen?: boolean;
  /** Shown when a non-default period is selected. */
  periodHint?: string;
  onResetPeriod?: () => void;
  /** Optional trailing slot (advanced). */
  trailing?: ReactNode;
}

/** Live date + time for dashboard chrome — updates every second. */
export function LiveClock({
  onCalendarClick,
  calendarOpen = false,
  periodHint,
  onResetPeriod,
  trailing,
}: LiveClockProps = {}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const weekday = now.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase();
  const date = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const hours24 = now.getHours();
  const hh = String(hours24 % 12 || 12).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const meridiem = hours24 >= 12 ? 'PM' : 'AM';

  return (
    <div
      // The WHOLE widget is the calendar trigger — hunting for the small icon
      // was needless precision. Inner buttons (reset, icon) stopPropagation.
      {...(onCalendarClick ? {
        onClick: onCalendarClick,
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCalendarClick(); }
        },
        tabIndex: 0,
        role: 'button' as const,
        'aria-expanded': calendarOpen,
        'aria-haspopup': 'dialog' as const,
        'aria-label': 'Open period calendar',
      } : {})}
      className={cn(
        'relative shrink-0 overflow-hidden rounded-2xl border backdrop-blur-xl transition-shadow duration-300',
        'border-sky-200/70 bg-gradient-to-br from-white via-sky-50/90 to-indigo-50/70',
        'shadow-[0_8px_28px_-14px_rgba(56,119,210,.35),0_1px_0_rgba(255,255,255,.9)_inset]',
        'dark:border-white/12 dark:from-[#0c1220]/95 dark:via-[#0f172a]/90 dark:to-[#111827]/85',
        'dark:shadow-[0_12px_32px_-16px_rgba(0,0,0,.55)]',
        onCalendarClick && 'cursor-pointer select-none focus:outline-none focus-visible:ring-4 focus-visible:ring-sky-300/40',
        calendarOpen && 'ring-4 ring-sky-300/35 dark:ring-sky-400/20',
      )}
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 0% 0%, rgba(125, 211, 252, .22), transparent 55%), radial-gradient(90% 80% at 100% 0%, rgba(199, 210, 254, .28), transparent 50%), radial-gradient(80% 70% at 100% 100%, rgba(186, 230, 253, .18), transparent 45%)',
        }}
      />
      <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent dark:via-white/25" />

      <div className="relative flex items-center gap-2 px-2.5 py-1.5 sm:gap-2.5 sm:px-3 sm:py-2">
        <div className="hidden min-w-[5.25rem] flex-col sm:flex">
          <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-sky-700/65 dark:text-sky-200/70">
            {weekday}
          </span>
          <span className="mt-0.5 text-[11.5px] font-semibold leading-none text-ink">{date}</span>
          {periodHint && (
            <span className="mt-1 truncate text-[10px] font-semibold text-indigo-500/80 dark:text-indigo-300/80">
              Viewing {periodHint}
            </span>
          )}
        </div>

        <div className="hidden h-8 w-px bg-gradient-to-b from-transparent via-sky-200 to-transparent dark:via-white/15 sm:block" />

        <div className="flex items-center gap-1 sm:gap-1.5">
          <DigitPair value={hh} />
          <Colon />
          <DigitPair value={mm} />
          <Colon />
          <DigitPair value={ss} />
          <span className="ml-0.5 rounded-md border border-sky-200/80 bg-white/80 px-1.5 py-0.5 text-[9px] font-bold tracking-[0.1em] text-sky-700 dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-200">
            {meridiem}
          </span>
        </div>

        {(onCalendarClick || trailing || onResetPeriod) && (
          <>
            <div className="h-8 w-px bg-gradient-to-b from-transparent via-sky-200 to-transparent dark:via-white/15" />
            <div className="flex items-center gap-1">
              {onResetPeriod && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onResetPeriod(); }}
                  title="Reset to today"
                  aria-label="Reset period to today"
                  className="grid h-8 w-8 place-items-center rounded-xl border border-sky-200/70 bg-white/80 text-sky-600 shadow-sm transition-all hover:-translate-y-px hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 dark:border-white/10 dark:bg-white/[.06] dark:text-sky-300 dark:hover:bg-white/[.1]"
                >
                  <RotateCcw size={13} />
                </button>
              )}
              {onCalendarClick && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onCalendarClick(); }}
                  aria-expanded={calendarOpen}
                  aria-haspopup="dialog"
                  title="Filter by day or month"
                  aria-label="Open period calendar"
                  className={cn(
                    'grid h-8 w-8 place-items-center rounded-xl border shadow-sm transition-all',
                    'hover:-translate-y-px',
                    calendarOpen
                      ? 'border-sky-300 bg-sky-100 text-sky-700 ring-2 ring-sky-200/70 dark:border-sky-400/40 dark:bg-sky-500/20 dark:text-sky-200 dark:ring-sky-400/25'
                      : 'border-sky-200/80 bg-white/90 text-sky-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 dark:border-white/12 dark:bg-white/[.07] dark:text-sky-300 dark:hover:bg-white/[.12]',
                  )}
                >
                  <Calendar size={14} strokeWidth={2.1} />
                </button>
              )}
              {trailing}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
