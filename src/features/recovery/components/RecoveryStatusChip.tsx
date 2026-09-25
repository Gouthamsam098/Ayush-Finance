import { cn } from '@/lib/utils';
import { fmtDate } from '@/lib/format';
import type { RecoverySubmission } from '../types';
import { CheckCircle2, Clock, CalendarClock, XCircle } from 'lucide-react';

export function RecoveryStatusChip({
  submission,
  variant = 'surface',
}: {
  submission?: RecoverySubmission;
  /** `surface` = on light card body; `header` = on gradient header */
  variant?: 'surface' | 'header';
}) {
  if (!submission) return null;

  const base = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold';

  if (submission.type === 'COLLECTION_CLAIM') {
    if (submission.status === 'PENDING') {
      return (
        <span className={cn(base,
          variant === 'header'
            ? 'bg-amber-400/95 text-amber-950 shadow-sm'
            : 'bg-warning-50 text-warning dark:bg-warning/15 dark:text-amber-300')}>
          <Clock size={12} /> Sent for approval
        </span>
      );
    }
    if (submission.status === 'APPROVED') {
      return (
        <span className={cn(base,
          variant === 'header'
            ? 'bg-emerald-400/95 text-emerald-950 shadow-sm'
            : 'bg-success-50 text-success dark:bg-success/15 dark:text-emerald-300')}>
          <CheckCircle2 size={12} /> Payment approved
        </span>
      );
    }
    return (
      <span className={cn(base,
        variant === 'header'
          ? 'bg-rose-400/95 text-rose-950 shadow-sm'
          : 'bg-danger-50 text-danger dark:bg-danger/15')}>
        <XCircle size={12} /> Rejected — resubmit
      </span>
    );
  }

  if (submission.status === 'OPEN') {
    return (
      <span className={cn(base,
        variant === 'header'
          ? 'bg-white/25 text-white'
          : 'bg-primary-50 text-primary dark:bg-primary/15')}>
        <CalendarClock size={12} /> PTP {fmtDate(submission.promiseDate)}
      </span>
    );
  }

  return null;
}
