import { CalendarClock, HandCoins } from 'lucide-react';
import { inr, fmtDate } from '@/lib/format';
import { classifyPtpTiming } from '@/lib/recoveryPtp';
import type { PromiseSubmission } from '../types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  ptp: PromiseSubmission;
  onCollect: () => void;
}

export function PtpTodayAlert({ ptp, onCollect }: Props) {
  const timing = classifyPtpTiming(ptp.promiseDate);
  const collectEnabled = timing === 'TODAY';
  const isUpcoming = timing === 'UPCOMING';

  return (
    <div
      className={cn(
        'border-b px-4 py-3',
        isUpcoming
          ? 'border-primary/15 bg-gradient-to-r from-primary/[.08] via-primary/[.04] to-surface dark:border-primary/20 dark:from-primary/12'
          : 'border-amber-200/80 bg-gradient-to-r from-amber-500/[.12] via-amber-400/[.08] to-surface dark:border-amber-500/25 dark:from-amber-500/15',
      )}
      role="status"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={cn(
              'grid h-9 w-9 shrink-0 place-items-center rounded-xl',
              isUpcoming
                ? 'bg-primary/15 text-primary dark:text-primary'
                : 'bg-amber-500/20 text-amber-800 dark:text-amber-200',
            )}
          >
            <CalendarClock size={18} />
          </span>
          <div className="min-w-0">
            <p className="font-display text-[13px] font-bold text-ink">
              {collectEnabled ? 'Promise to pay today' : 'Promise to pay scheduled'}
            </p>
            <p className="mt-0.5 text-[12px] text-muted">
              {fmtDate(ptp.promiseDate)}
              {ptp.promisedAmount != null && ptp.promisedAmount > 0
                ? <> · Expected <span className="font-semibold text-ink">{inr(ptp.promisedAmount)}</span></>
                : null}
            </p>
            {isUpcoming && (
              <p className="mt-1 text-[11px] font-medium text-muted">
                Collect now unlocks on the promise date.
              </p>
            )}
          </div>
        </div>
        <Button
          type="button"
          disabled={!collectEnabled}
          title={collectEnabled ? undefined : `Available on ${fmtDate(ptp.promiseDate)}`}
          className="h-9 w-full shrink-0 px-4 text-[12px] sm:w-auto"
          onClick={onCollect}
        >
          <HandCoins size={14} /> Collect now
        </Button>
      </div>
    </div>
  );
}
