import { motion } from 'framer-motion';
import { CircleDot, AlertCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SnapshotProps {
  outstanding: string;
  activeLoans: number;
  collectionRate: number; // 0..100
  netLabel: string;
  netPeriod: string;
  overdue?: { count: number; detail: string };
}

/** Dark right-rail panel summarising the portfolio at a glance. */
export function PortfolioSnapshot({
  outstanding, activeLoans, collectionRate, netLabel, netPeriod, overdue,
}: SnapshotProps) {
  const healthy = collectionRate >= 80;
  const watch = collectionRate >= 50 && collectionRate < 80;
  const rateColor = healthy ? 'text-emerald-300' : watch ? 'text-amber-300' : 'text-red-300';
  const barColor = healthy ? 'bg-emerald-400' : watch ? 'bg-amber-400' : 'bg-red-400';
  const rateNote = healthy ? 'Healthy' : watch ? 'Watch' : 'At risk';

  return (
    <div className="flex flex-col gap-3 rounded-xl border-[0.5px] border-indigo-500/25 bg-[#0c1220] p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">Portfolio snapshot</div>

      {/* Outstanding */}
      <div className="rounded-xl border-[0.5px] border-indigo-400/30 bg-indigo-500/20 p-4">
        <div className="mb-1 text-xs text-slate-300">Outstanding</div>
        <div className="text-[28px] font-semibold leading-[1.1] text-white">{outstanding}</div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[13px] text-emerald-300">
          <CircleDot size={11} /> {activeLoans} active loans
        </div>
      </div>

      {/* Collected + Net */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className={cn('rounded-xl border-[0.5px] p-3',
          healthy ? 'border-emerald-500/30 bg-emerald-500/15' : watch ? 'border-amber-500/30 bg-amber-500/15' : 'border-red-500/30 bg-red-500/15')}>
          <div className="mb-1 text-xs text-slate-300">Collected</div>
          <div className={cn('text-[26px] font-semibold leading-[1.1]', rateColor)}>{collectionRate}%</div>
          <div className="my-2 h-1.5 overflow-hidden rounded-full bg-white/[.1]">
            <motion.div
              className={cn('h-full rounded-full', barColor)}
              initial={{ width: 0 }}
              animate={{ width: `${collectionRate}%` }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
          <div className="flex items-center gap-1 text-xs text-slate-300">
            <AlertCircle size={13} className={rateColor} /> {rateNote}
          </div>
        </div>

        <div className="rounded-xl border-[0.5px] border-white/[.12] bg-white/[.06] p-3">
          <div className="mb-1 text-xs text-slate-300">Net / month</div>
          <div className="text-xl font-semibold text-emerald-300">{netLabel}</div>
          <div className="mt-1 text-xs text-emerald-300/90">{netPeriod}</div>
        </div>
      </div>

      <div className="h-[0.5px] bg-white/[.1]" />

      {/* Overdue alert */}
      {overdue && overdue.count > 0 ? (
        <div className="rounded-xl border-[0.5px] border-red-500/40 bg-red-500/[.16] p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-red-300">
            <AlertTriangle size={15} /> {overdue.count} loan{overdue.count > 1 ? 's' : ''} overdue
          </div>
          <div className="text-xs text-red-300/90">{overdue.detail}</div>
        </div>
      ) : (
        <div className="rounded-xl border-[0.5px] border-emerald-500/30 bg-emerald-500/[.14] p-3 text-[13px] font-semibold text-emerald-300">
          No loans overdue 🎉
        </div>
      )}
    </div>
  );
}
