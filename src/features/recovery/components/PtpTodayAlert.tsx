import { CalendarClock, HandCoins } from 'lucide-react';
import { inr, fmtDate } from '@/lib/format';
import type { PromiseSubmission } from '../types';
import { Button } from '@/components/ui/button';

interface Props {
  ptp: PromiseSubmission;
  onCollect: () => void;
}

export function PtpTodayAlert({ ptp, onCollect }: Props) {
  return (
    <div
      className="border-b border-amber-200/80 bg-gradient-to-r from-amber-500/[.12] via-amber-400/[.08] to-surface px-4 py-3 dark:border-amber-500/25 dark:from-amber-500/15"
      role="status"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-500/20 text-amber-800 dark:text-amber-200">
            <CalendarClock size={18} />
          </span>
          <div className="min-w-0">
            <p className="font-display text-[13px] font-bold text-ink">Promise to pay today</p>
            <p className="mt-0.5 text-[12px] text-muted">
              {fmtDate(ptp.promiseDate)}
              {ptp.promisedAmount != null && ptp.promisedAmount > 0
                ? <> · Expected <span className="font-semibold text-ink">{inr(ptp.promisedAmount)}</span></>
                : null}
            </p>
          </div>
        </div>
        <Button type="button" className="h-9 w-full shrink-0 px-4 text-[12px] sm:w-auto" onClick={onCollect}>
          <HandCoins size={14} /> Collect now
        </Button>
      </div>
    </div>
  );
}
