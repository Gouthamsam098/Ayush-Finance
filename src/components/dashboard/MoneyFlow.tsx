import { ArrowDownRight, ArrowUpRight, Wallet } from 'lucide-react';
import { inr, inrShort } from '@/lib/format';

interface MoneyFlowProps {
  disbursed: number;
  collected: number;
}

export function MoneyFlow({ disbursed, collected }: MoneyFlowProps) {
  const net = collected - disbursed;
  const positive = net >= 0;

  return (
    <div className="rounded-2xl border-[0.5px] border-slate-200/70 bg-white p-4 dark:border-white/[.06] dark:bg-surface">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
          <Wallet size={14} />
        </span>
        <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted">Money Flow</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-red-50 p-3 dark:bg-red-500/[.08]">
          <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-red-500">
            <ArrowUpRight size={12} /> OUT
          </div>
          <div className="font-display text-[20px] font-bold tabular-nums text-red-600 dark:text-red-400">
            {inrShort(disbursed)}
          </div>
          <div className="mt-0.5 text-[10px] text-muted">Disbursed this month</div>
        </div>

        <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-500/[.08]">
          <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-emerald-500">
            <ArrowDownRight size={12} /> IN
          </div>
          <div className="font-display text-[20px] font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {inrShort(collected)}
          </div>
          <div className="mt-0.5 text-[10px] text-muted">Collected this month</div>
        </div>
      </div>

      <div className={`mt-3 flex items-center justify-between rounded-xl px-3 py-2.5 ${positive ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-red-50 dark:bg-red-500/10'}`}>
        <span className="text-[12px] font-semibold text-muted">Net flow</span>
        <span className={`text-[15px] font-bold tabular-nums ${positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          {positive ? '+' : ''}{inrShort(net)}
        </span>
      </div>
    </div>
  );
}
