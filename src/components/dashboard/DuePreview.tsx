import { CalendarDays, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { inr, fmtDate, todayISO, addDays } from '@/lib/format';
import type { Loan } from '@/mock/DataContext';
import { LOAN_LABELS } from '@/mock/DataContext';

interface DueItem {
  id: number;
  customer: string;
  type: string;
  amount: number;
  dueDate: string;
  days: number;
}

interface DuePreviewProps {
  items: DueItem[];
  onViewAll?: () => void;
}

export function DuePreview({ items, onViewAll }: DuePreviewProps) {
  return (
    <div className="rounded-2xl border-[0.5px] border-slate-200/70 bg-white dark:border-white/[.06] dark:bg-surface">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-white/[.05]">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400">
            <CalendarDays size={14} />
          </span>
          <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted">Due Today & Tomorrow</span>
        </div>
        {onViewAll && items.length > 0 && (
          <button onClick={onViewAll} className="flex items-center gap-1 text-[12px] font-semibold text-blue-500 hover:text-blue-600">
            View all <ChevronRight size={13} />
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-[13px] text-muted">Nothing due today or tomorrow</div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-white/[.05]">
          {items.map((item) => {
            const urgent = item.days <= 1;
            return (
              <div key={item.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[.02]">
                <div className={cn(
                  'grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[10px] font-bold text-white',
                  urgent ? 'bg-red-500' : item.days === 2 ? 'bg-amber-500' : 'bg-blue-500',
                )}>
                  {item.customer.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-ink">{item.customer}</div>
                  <div className="text-[11px] text-muted">{item.type}</div>
                </div>
                <div className="text-right">
                  <div className="text-[13px] font-bold tabular-nums text-ink">{inr(item.amount)}</div>
                  <div className={cn('text-[11px] font-semibold', urgent ? 'text-red-500' : 'text-muted')}>
                    {item.days === 0 ? 'Today' : item.days === 1 ? 'Tomorrow' : `In ${item.days}d`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
