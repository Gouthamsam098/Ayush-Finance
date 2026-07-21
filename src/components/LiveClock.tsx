import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

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
    <div className="relative overflow-hidden rounded-xl">
      {/* Animated shimmer border */}
      <div
        className="absolute inset-0 rounded-xl"
        style={{
          background: 'conic-gradient(from 0deg, #6366f1, #22c55e, #6366f1, #f59e0b, #6366f1)',
          backgroundSize: '400% 400%',
          animation: 'shimmer-border 3s linear infinite',
        }}
      />
      <div className="relative m-[1.5px] flex items-center gap-3 rounded-[10px] bg-white/95 px-4 py-2.5 text-sm shadow-sm dark:bg-surface/95 backdrop-blur">
        <span className="relative flex h-2 w-2 shrink-0">
          <motion.span
            className="absolute inline-flex h-full w-full rounded-full bg-emerald-500"
            animate={{ scale: [1, 2.2], opacity: [0.6, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
          />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <span className="font-medium text-slate-600 dark:text-slate-300">
          {weekday} <span className="text-slate-400 dark:text-slate-500">·</span> {date}
        </span>
        <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
        <span className="font-display font-bold tabular-nums tracking-wide text-blue-600 dark:text-blue-400">{time}</span>
      </div>
    </div>
  );
}
