import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface Metric {
  label: string;
  value: string;
  sub: string;
  /** Green-tint the card (e.g. positive net). */
  good?: boolean;
}

/** A strip of 4 secondary metric cards below the hero. */
export function MetricRow({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="grid grid-cols-2 gap-[9px] lg:grid-cols-4">
      {metrics.map((m, i) => (
        <motion.div
          key={m.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04, duration: 0.35 }}
          className={cn(
            'rounded-xl border-[0.5px] p-4',
            m.good
              ? 'border-green-200 bg-green-50 dark:border-success/25 dark:bg-success/10'
              : 'border-slate-200/70 bg-white dark:border-white/[.06] dark:bg-surface',
          )}
        >
          <div className="mb-1 text-[13px] text-muted">{m.label}</div>
          <div className={cn('text-[22px] font-semibold', m.good ? 'text-green-700 dark:text-success' : 'text-ink')}>
            {m.value}
          </div>
          <div className="mt-1 text-[13px] text-muted">{m.sub}</div>
        </motion.div>
      ))}
    </div>
  );
}
