import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

function DigitPair({ value }: { value: string }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-slate-200/90 bg-gradient-to-b from-white to-slate-50/90 px-1.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,.95)] dark:border-white/[.1] dark:from-white/[.08] dark:to-white/[.02] sm:px-2 sm:py-[5px]">
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
      className="pb-px font-display text-[12px] font-semibold text-ink/30"
      animate={{ opacity: [1, 0.25, 1] }}
      transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
    >
      :
    </motion.span>
  );
}

/** Live date + time for dashboard chrome — updates every second. */
export function LiveClock() {
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
      className="relative shrink-0 overflow-hidden rounded-xl border border-slate-300/90 bg-white/95 shadow-[0_1px_2px_rgba(15,23,42,.04)] backdrop-blur-xl dark:border-white/15 dark:bg-[#0c1220]/95"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 0% 0%, rgba(46,1,150,.05), transparent 52%), radial-gradient(90% 80% at 100% 120%, rgba(24,139,252,.04), transparent 48%)',
        }}
      />

      <div className="relative flex items-center gap-2 px-2.5 py-1.5 sm:gap-2.5 sm:px-3 sm:py-2">
        <div className="hidden min-w-[5.25rem] flex-col sm:flex">
          <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#2e0196]/70 dark:text-[#c4b5fd]/75">
            {weekday}
          </span>
          <span className="mt-0.5 text-[11.5px] font-semibold leading-none text-ink">{date}</span>
        </div>

        <div className="hidden h-7 w-px bg-slate-200 dark:bg-white/12 sm:block" />

        <div className="flex items-center gap-1 sm:gap-1.5">
          <DigitPair value={hh} />
          <Colon />
          <DigitPair value={mm} />
          <Colon />
          <DigitPair value={ss} />
          <span className="ml-0.5 rounded-md border border-[#2e0196]/15 bg-[#2e0196]/[0.05] px-1.5 py-0.5 text-[9px] font-bold tracking-[0.1em] text-[#2e0196] dark:border-[#a78bfa]/30 dark:bg-[#a78bfa]/12 dark:text-[#c4b5fd]">
            {meridiem}
          </span>
        </div>
      </div>
    </div>
  );
}
