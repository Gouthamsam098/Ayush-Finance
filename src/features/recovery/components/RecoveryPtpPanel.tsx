import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useRecovery } from '../RecoveryContext';
import { useData } from '@/mock/DataContext';
import { inr, fmtDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { CustomerAvatar } from '@/components/CustomerAvatar';
import type { PromiseSubmission } from '../types';
import { isActiveOpenPromise, classifyPtpTiming, ptpTimingLabel } from '@/lib/recoveryPtp';
import { CalendarClock, Inbox, Trash2 } from 'lucide-react';
import { ADMIN_DISMISSALS_CHANGED, isRecoverySubmissionDismissed } from '@/lib/adminDismissals';
import { removeSubmissionFromAdminQueue } from '../recoveryStore';
import { cn } from '@/lib/utils';

function PtpMeta({ label, children, ellipsis, title }: { label: string; children: ReactNode; ellipsis?: boolean; title?: string }) {
  return (
    <div
      className="min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200/70 bg-slate-50/50 px-3 py-2.5 text-center dark:border-white/[.06] dark:bg-white/[.03] sm:py-2 sm:text-left"
      title={title}
    >
      <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted">{label}</p>
      <div
        className={cn(
          'mt-0.5 text-[13px] font-semibold leading-snug text-ink',
          ellipsis ? 'truncate' : 'break-words',
        )}
      >
        {children}
      </div>
    </div>
  );
}

function PromiseToPayCard({
  submission,
  customerId,
  index,
  onDelete,
}: {
  submission: PromiseSubmission;
  customerId: number;
  index: number;
  onDelete: () => void;
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
      className="min-w-0 max-w-full overflow-hidden rounded-[18px] border border-primary/25 bg-surface shadow-card transition-shadow hover:shadow-soft dark:border-primary/30 dark:border-white/[.08]"
    >
      <div className="h-1 w-full bg-gradient-to-r from-[#022999] via-[#0538cc] to-[#0AA8F8]" aria-hidden />

      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-4">
          <span
            className="mx-auto grid h-[72px] w-[72px] shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/15 to-violet-500/10 text-primary ring-1 ring-primary/20 shadow-soft sm:mx-0 sm:h-[96px] sm:w-[96px]"
            aria-hidden
          >
            <CalendarClock size={28} strokeWidth={2} className="sm:h-8 sm:w-8" />
          </span>

          <div className="min-w-0 w-full flex-1 max-sm:text-center sm:text-left">
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex w-full flex-col items-center gap-2.5 sm:flex-row sm:items-start sm:gap-2.5">
                <CustomerAvatar
                  customerId={customerId}
                  name={submission.customerName}
                  className="h-11 w-11 shrink-0 rounded-xl shadow-[0_6px_16px_-8px_rgba(79,70,229,.45)] sm:h-10 sm:w-10"
                />
                <div className="min-w-0 flex-1 sm:text-left">
                  <h3 className="break-words font-display text-[16px] font-bold leading-snug text-ink sm:text-[16px]">
                    {submission.customerName}
                  </h3>
                  <p className="mt-0.5 break-all font-mono text-[11px] text-muted">{submission.loanNumber}</p>
                </div>
              </div>
              <Badge tone="info" className="shrink-0">
                {ptpTimingLabel(classifyPtpTiming(submission.promiseDate))}
              </Badge>
            </div>

            <div className="mt-4 sm:mt-3">
              <p className="font-display text-[26px] font-bold leading-none tracking-tight text-primary sm:text-[24px]">
                {fmtDate(submission.promiseDate)}
              </p>
              {submission.promisedAmount != null && submission.promisedAmount > 0 ? (
                <p className="mt-2 text-[13px] text-muted">
                  Promised amount
                  <span className="mt-0.5 block font-display text-[20px] font-bold tabular-nums text-ink sm:inline sm:ml-1 sm:text-[12px] sm:font-semibold">
                    {inr(submission.promisedAmount)}
                  </span>
                </p>
              ) : (
                <p className="mt-2 text-[12px] text-muted">Date commitment from recovery agent</p>
              )}
            </div>

            <div className="mt-4 grid min-w-0 grid-cols-1 gap-2.5 [&>*]:min-w-0 xs:grid-cols-2 sm:mt-3 sm:gap-2">
              <PtpMeta label="Recovery agent" ellipsis title={submission.agentName}>
                {submission.agentName}
              </PtpMeta>
              <PtpMeta label="Logged">{fmtDate(submission.createdAt.slice(0, 10))}</PtpMeta>
            </div>

            {submission.note ? (
              <p className="mt-4 rounded-xl border border-slate-200/70 bg-slate-50/40 px-3 py-2.5 text-left text-[12px] leading-relaxed text-muted dark:border-white/[.06] dark:bg-white/[.02] sm:mt-3">
                {submission.note}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="border-t border-slate-100 dark:border-white/[.06]">
        <button
          type="button"
          onClick={onDelete}
          className="flex min-h-11 w-full items-center justify-center gap-1.5 py-3 text-[12px] font-semibold text-muted transition-colors hover:bg-slate-100 hover:text-danger dark:hover:bg-white/[.04] sm:text-[13px]"
          aria-label="Remove promise to pay"
        >
          <Trash2 size={15} aria-hidden />
          Delete
        </button>
      </div>
    </motion.article>
  );
}

export function RecoveryPtpPanel() {
  const { submissions, refresh } = useRecovery();
  const d = useData();
  const toast = useToast();
  const [dismissTick, setDismissTick] = useState(0);

  useEffect(() => {
    const onDismiss = () => setDismissTick((t) => t + 1);
    window.addEventListener(ADMIN_DISMISSALS_CHANGED, onDismiss);
    return () => window.removeEventListener(ADMIN_DISMISSALS_CHANGED, onDismiss);
  }, []);

  const promises = useMemo(
    () => submissions.filter(
      (s): s is PromiseSubmission => s.type === 'PROMISE_TO_PAY'
        && isActiveOpenPromise(s)
        && !isRecoverySubmissionDismissed(s.id),
    ),
    [submissions, dismissTick],
  );

  const customerIdFor = (loanId: number) => d.loans.find((l) => l.id === loanId)?.customerId ?? loanId;

  const onDelete = (id: string) => {
    removeSubmissionFromAdminQueue(id);
    refresh();
    toast('Removed from list', 'success');
  };

  if (promises.length === 0) {
    return (
      <section
        className="anim-pop flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200/90 bg-surface/60 px-6 py-14 text-center dark:border-white/[.08]"
        aria-label="Promise to pay"
      >
        <div className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
          <CalendarClock size={26} />
        </div>
        <p className="font-display text-lg font-bold text-ink">No open promises to pay</p>
        <p className="max-w-sm text-[13px] text-muted">
          When recovery agents log a promise-to-pay date, it will appear here.
        </p>
      </section>
    );
  }

  return (
    <section
      className="anim-pop min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-surface shadow-card dark:border-white/[.08]"
      aria-label="Promise to pay"
    >
      <div className="border-b border-slate-100/80 bg-gradient-to-r from-primary/[.08] via-surface to-violet-500/[.06] px-4 py-3.5 dark:border-white/[.06] sm:px-5">
        <div className="flex flex-col items-center gap-2 text-center sm:flex-row sm:items-center sm:gap-2.5 sm:text-left">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#022999] to-violet-600 text-white shadow-[0_6px_16px_-8px_rgba(79,70,229,.45)] sm:h-9 sm:w-9">
            <CalendarClock size={18} />
          </span>
          <div className="min-w-0">
            <p className="font-display text-[15px] font-bold text-ink">Promise to pay</p>
            <p className="text-[11px] leading-relaxed text-muted">
              {promises.length} open commitment{promises.length === 1 ? '' : 's'} from recovery agents
            </p>
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-4 p-3 sm:p-5 lg:grid-cols-2 [&>*]:min-w-0">
        {promises.map((s, i) => (
          <PromiseToPayCard
            key={s.id}
            submission={s}
            customerId={customerIdFor(s.loanId)}
            index={i}
            onDelete={() => onDelete(s.id)}
          />
        ))}
      </div>
    </section>
  );
}
