import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { inr, todayISO, addDays } from '@/lib/format';
import type { Collection } from '@/mock/DataContext';

interface WeeklyMomentumProps {
  collections: Collection[];
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function WeeklyMomentum({ collections }: WeeklyMomentumProps) {
  const { days, max, total } = useMemo(() => {
    const today = todayISO();
    // Build last 7 days: today-6 through today
    const daysData: { label: string; date: string; amount: number; isToday: boolean }[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = addDays(today, -i);
      const [y, m, d] = date.split('-').map(Number);
      const dayName = DAY_NAMES[new Date(y, m - 1, d).getDay()];
      daysData.push({ label: dayName, date, amount: 0, isToday: i === 0 });
    }

    let total = 0;
    for (const c of collections) {
      const day = daysData.find((d) => d.date === c.date);
      if (day) {
        day.amount += c.amount;
        total += c.amount;
      }
    }

    const max = Math.max(...daysData.map((d) => d.amount), 1);
    return { days: daysData, max, total };
  }, [collections]);

  return (
    <div className="rounded-2xl border-[0.5px] border-slate-200/70 bg-white p-4 dark:border-white/[.06] dark:bg-surface">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
            <BarChart3 size={14} />
          </span>
          <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted">Weekly Pulse</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 dark:bg-emerald-500/15">
          <TrendingUp size={12} className="text-emerald-600 dark:text-emerald-400" />
          <span className="text-[12px] font-bold text-emerald-600 dark:text-emerald-400">{inr(total)}</span>
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between gap-1.5" style={{ height: 96 }}>
        {days.map((d) => {
          const h = max > 0 ? Math.max(4, (d.amount / max) * 88) : 4;
          return (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-1.5">
              <span className="text-[10px] font-semibold tabular-nums text-muted">
                {d.amount > 0 ? inr(d.amount).replace('₹', '') : ''}
              </span>
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: h }}
                transition={{ duration: 0.7, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  'w-full max-w-[32px] rounded-t-lg',
                  d.isToday
                    ? 'bg-gradient-to-t from-blue-600 to-blue-400 shadow-[0_2px_8px_rgba(37,99,235,.35)]'
                    : 'bg-gradient-to-t from-slate-300 to-slate-200 dark:from-slate-600 dark:to-slate-500',
                )}
              />
              <span className={cn(
                'text-[10px] font-semibold',
                d.isToday ? 'text-blue-600 dark:text-blue-400' : 'text-muted',
              )}>
                {d.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
