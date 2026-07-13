import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';

/** Smoothly counts an integer up to `target` (easeOutCubic). */
function useCountUp(target: number, duration = 800) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      setVal(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

function palette(pct: number) {
  if (pct >= 100) return { bar: 'from-emerald-400 to-emerald-600', text: 'text-emerald-600' };
  if (pct >= 76) return { bar: 'from-green-400 to-green-600', text: 'text-green-600' };
  if (pct >= 51) return { bar: 'from-orange-400 to-orange-500', text: 'text-orange-600' };
  if (pct >= 26) return { bar: 'from-blue-400 to-primary', text: 'text-primary' };
  return { bar: 'from-slate-300 to-slate-400', text: 'text-slate-500' };
}

export function CollectionProgress({
  paid, total, compact = false, showRemaining = false,
}: { paid: number; total: number; compact?: boolean; showRemaining?: boolean }) {
  const clamped = Math.max(0, Math.min(paid, total));
  const pct = total > 0 ? Math.round((clamped / total) * 100) : 0;
  const shownPaid = useCountUp(clamped);
  const c = palette(pct);
  const remaining = Math.max(0, total - clamped);
  const done = pct >= 100;

  return (
    <div className={compact ? 'w-40' : 'w-full'}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={`font-display text-xs font-bold ${c.text}`}>{shownPaid} / {total} Days</span>
        {done && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
            <CheckCircle2 size={11} /> Completed
          </span>
        )}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: 'easeOut' }}
          className={`h-full rounded-full bg-gradient-to-r ${c.bar}`} />
      </div>
      {showRemaining && (
        <div className={`mt-1 text-[11px] ${done ? 'font-semibold text-emerald-600' : 'text-muted'}`}>
          {done ? 'Loan fully collected 🎉' : `${remaining} Days Remaining`}
        </div>
      )}
    </div>
  );
}
