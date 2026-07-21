import { motion } from 'framer-motion';
import { Target, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { inr } from '@/lib/format';

interface DailyTrackerProps {
  expected: number;
  collected: number;
}

export function DailyTracker({ expected, collected }: DailyTrackerProps) {
  const pct = expected > 0 ? Math.min(100, Math.round((collected / expected) * 100)) : 0;
  const remaining = Math.max(0, expected - collected);
  const healthy = pct >= 80;
  const watch = pct >= 50 && pct < 80;
  const tone = healthy ? 'emerald' : watch ? 'amber' : 'red';

  return (
    <div className="rounded-2xl border-[0.5px] border-slate-200/70 bg-white p-4 dark:border-white/[.06] dark:bg-surface">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
          <Target size={14} />
        </span>
        <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted">Today's Target</span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 mb-3">
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/[.03]">
          <div className="text-[11px] font-medium text-muted">Expected</div>
          <div className="mt-0.5 font-display text-[18px] font-bold tabular-nums text-ink">{inr(expected)}</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/[.03]">
          <div className="text-[11px] font-medium text-muted">Collected</div>
          <div className="mt-0.5 font-display text-[18px] font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{inr(collected)}</div>
        </div>
      </div>

      <div className="mb-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[.08]">
        <motion.div
          className={cn(
            'h-full rounded-full',
            tone === 'emerald' ? 'bg-gradient-to-r from-emerald-400 to-emerald-600' :
            tone === 'amber' ? 'bg-gradient-to-r from-amber-400 to-amber-600' :
            'bg-gradient-to-r from-red-400 to-red-600',
          )}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className={cn('text-[13px] font-bold', tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400')}>
          {pct}% complete
        </span>
        {remaining > 0 && (
          <span className="text-[12px] font-medium text-muted">
            <TrendingUp size={12} className="inline mr-1" />
            {inr(remaining)} to go
          </span>
        )}
      </div>
    </div>
  );
}
