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
      className="min-w-0 rounded-lg border border-slate-200/70 bg-slate-50/50 px-2 py-1.5 dark:border-white/[.06] dark:bg-white/[.03]"
      title={title}
    >
      <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-muted">{label}</p>
      <div
        className={cn(
          'mt-0.5 text-[12px] font-semibold leading-snug text-ink',
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
  const hasAmount = submission.promisedAmount != null && submission.promisedAmount > 0;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
      className="min-w-0 max-w-full self-start overflow-hidden rounded-2xl border border-primary/25 bg-surface shadow-soft transition-shadow hover:shadow-card dark:border-primary/30 dark:border-white/[.08]"
    >
      <div className="h-1 w-full bg-gradient-to-r from-[#022999] via-[#0538cc] to-[#0AA8F8]" aria-hidden />

      <div className="p-2.5 sm:p-3.5">
        <div className="min-w-0 w-full">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-2">
              <CustomerAvatar
                customerId={customerId}
                name={submission.customerName}
                className="h-9 w-9 shrink-0 rounded-lg shadow-[0_4px_12px_-8px_rgba(79,70,229,.4)]"
              />
              <div className="min-w-0 flex-1">
                <h3 className="break-words font-display text-[14px] font-bold leading-snug text-ink">
                  {submission.customerName}
                </h3>
                <p className="mt-0.5 break-all font-mono text-[10px] text-muted">{submission.loanNumber}</p>
              </div>
            </div>
            <Badge tone="info" className="shrink-0 self-start">
              {ptpTimingLabel(classifyPtpTiming(submission.promiseDate))}
            </Badge>
          </div>

          <p className="mt-2 font-display text-[19px] font-bold leading-none tabular-nums text-ink sm:text-[20px]">
            {hasAmount ? inr(submission.promisedAmount!) : fmtDate(submission.promiseDate)}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1">
              <CalendarClock size={12} className="opacity-70" aria-hidden />
              Promise {fmtDate(submission.promiseDate)}
            </span>
            {!hasAmount && (
              <span className="text-muted/80">· Date commitment from agent</span>
            )}
          </p>

          <div className="mt-2 grid grid-cols-1 gap-1.5 xs:grid-cols-2">
            <PtpMeta label="Recovery agent" ellipsis title={submission.agentName}>
              {submission.agentName}
            </PtpMeta>
            <PtpMeta label="Logged">{fmtDate(submission.createdAt.slice(0, 10))}</PtpMeta>
          </div>

          {submission.note ? (
            <p className="mt-2 rounded-lg border border-slate-200/70 bg-slate-50/40 px-2.5 py-1.5 text-[11px] leading-snug text-muted dark:border-white/[.06] dark:bg-white/[.02]">
              {submission.note}
            </p>
          ) : null}
        </div>
      </div>

      <div className="border-t border-slate-100 dark:border-white/[.06]">
        <button
          type="button"
          onClick={onDelete}
          className="flex min-h-9 w-full items-center justify-center gap-1 py-2 text-[11px] font-semibold text-muted transition-colors hover:bg-slate-100 hover:text-danger dark:hover:bg-white/[.04] sm:text-[12px]"
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

      <div className="grid min-w-0 items-start gap-3 p-2.5 sm:p-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,18.5rem),1fr))] [&>*]:min-w-0">
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
