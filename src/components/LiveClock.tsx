import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

/** A refined, ticking date/time pill — same footprint as a static badge, but alive. */
export function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const weekday = now.toLocaleDateString('en-IN', { weekday: 'short' });
  const date = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  return (
    <div className="relative rounded-xl p-[1px] bg-gradient-to-r from-primary/40 via-blue-300/40 to-primary/40 dark:from-primary/30 dark:via-blue-500/20 dark:to-primary/30 shadow-sm">
      <div className="flex items-center gap-3 rounded-[11px] bg-white/90 dark:bg-surface/90 backdrop-blur px-4 py-2.5 text-sm">
        <span className="relative flex h-2 w-2 shrink-0">
          <motion.span
            className="absolute inline-flex h-full w-full rounded-full bg-success"
            animate={{ scale: [1, 2.2], opacity: [0.6, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
          />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
        </span>
        <span className="font-medium text-slate-600 dark:text-slate-300">
          {weekday} <span className="text-slate-400 dark:text-slate-500">·</span> {date}
        </span>
        <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
        <span className="font-display font-bold tabular-nums tracking-wide text-primary">{time}</span>
      </div>
    </div>
  );
}
