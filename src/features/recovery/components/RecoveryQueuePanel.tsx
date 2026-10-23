import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useRecovery } from '../RecoveryContext';
import { useData } from '@/mock/DataContext';
import { inr, fmtDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { CustomerAvatar } from '@/components/CustomerAvatar';
import type { CollectionClaimSubmission } from '../types';
import {
  CalendarClock,
  Check,
  HandCoins,
  Inbox,
  Loader2,
  Trash2,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import { ADMIN_DISMISSALS_CHANGED, isRecoverySubmissionDismissed } from '@/lib/adminDismissals';
import { removeSubmissionFromAdminQueue } from '../recoveryStore';
import { cn } from '@/lib/utils';

function QueueMeta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200/70 bg-slate-50/50 px-3 py-2 dark:border-white/[.06] dark:bg-white/[.03]">
      <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted">{label}</p>
      <div className="mt-0.5 break-words text-[13px] font-semibold leading-snug text-ink">{children}</div>
    </div>
  );
}

function CollectionClaimCard({
  submission,
  customerId,
  busy,
  index,
  onReject,
  onApprove,
  onDelete,
}: {
  submission: CollectionClaimSubmission;
  customerId: number;
  busy: boolean;
  index: number;
  onReject: () => void;
  onApprove: () => void;
  onDelete: () => void;
}) {
  const pending = submission.status === 'PENDING';
  const approved = submission.status === 'APPROVED';
  const rejected = submission.status === 'REJECTED';

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
      className={cn(
        'overflow-hidden rounded-[18px] border bg-surface shadow-card transition-shadow hover:shadow-soft dark:border-white/[.08]',
        pending && 'border-amber-300/40 dark:border-amber-500/25',
        approved && 'border-emerald-300/40 dark:border-emerald-500/25',
        rejected && 'border-rose-300/40 dark:border-rose-500/25',
      )}
    >
      <div
        className={cn(
          'h-1 w-full',
          pending && 'bg-gradient-to-r from-amber-400 via-amber-500 to-orange-400',
          approved && 'bg-gradient-to-r from-emerald-400 to-emerald-600',
          rejected && 'bg-gradient-to-r from-rose-400 to-rose-600',
        )}
        aria-hidden
      />

      <div className="p-3 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
          <span
            className="mx-auto grid h-[88px] w-[88px] shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-amber-500/15 via-orange-500/10 to-amber-600/20 text-amber-700 ring-1 ring-amber-400/25 sm:mx-0 dark:text-amber-200 sm:h-[96px] sm:w-[96px]"
            aria-hidden
          >
            <HandCoins size={32} strokeWidth={2} />
          </span>

          <div className="min-w-0 w-full flex-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-2.5">
                <CustomerAvatar
                  customerId={customerId}
                  name={submission.customerName}
                  className="h-10 w-10 shrink-0 rounded-xl shadow-[0_6px_16px_-8px_rgba(245,158,11,.45)]"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="break-words font-display text-[15px] font-bold leading-snug text-ink sm:text-[16px]">
                    {submission.customerName}
                  </h3>
                  <p className="mt-0.5 break-all font-mono text-[11px] text-muted">{submission.loanNumber}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 self-start sm:flex-col sm:items-end">
                {approved && <Badge className="shrink-0 bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">Accepted</Badge>}
                {rejected && <Badge className="shrink-0 bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200">Rejected</Badge>}
                {pending && <Badge tone="warn" className="shrink-0">Pending</Badge>}
              </div>
            </div>

            <p className="mt-3 font-display text-[22px] font-bold leading-none tabular-nums text-ink sm:text-[24px]">
              {inr(submission.amount)}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted">
              <span className="inline-flex items-center gap-1">
                <Wallet size={12} className="opacity-70" aria-hidden />
                {submission.mode}
              </span>
              <span className="text-muted/50">·</span>
              <span className="inline-flex items-center gap-1">
                <CalendarClock size={12} className="opacity-70" aria-hidden />
                Receipt {fmtDate(submission.receiptDate)}
              </span>
            </p>

            <div className="mt-3 grid grid-cols-1 gap-2 xs:grid-cols-2">
              <QueueMeta label="Recovery agent">
                <span className="inline-flex items-center gap-1 break-words">
                  <UserCheck size={12} className="shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                  {submission.agentName}
                </span>
              </QueueMeta>
              <QueueMeta label="Submitted">
                {fmtDate(submission.createdAt.slice(0, 10))}
              </QueueMeta>
            </div>

            {submission.note ? (
              <p className="mt-3 rounded-xl border border-slate-200/70 bg-slate-50/40 px-3 py-2 text-[12px] leading-relaxed text-muted dark:border-white/[.06] dark:bg-white/[.02]">
                {submission.note}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {pending ? (
        <div className="action-bar-2 border-t border-slate-100 dark:border-white/[.06]">
          <button
            type="button"
            onClick={onReject}
            disabled={busy}
            className="flex min-h-11 items-center justify-center gap-1.5 py-3 text-[12px] font-semibold text-danger transition-colors hover:bg-danger/[.06] disabled:opacity-50 sm:text-[13px]"
          >
            <X size={15} aria-hidden />
            Reject
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className="flex min-h-11 items-center justify-center gap-1.5 bg-success/[.04] py-3 text-[12px] font-semibold text-success transition-colors hover:bg-success/[.10] disabled:opacity-50 sm:text-[13px]"
          >
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />}
            Accept
          </button>
        </div>
      ) : (
        <div className="border-t border-slate-100 dark:border-white/[.06]">
          <button
            type="button"
            onClick={onDelete}
            className="flex min-h-11 w-full items-center justify-center gap-1.5 py-3 text-[12px] font-semibold text-muted transition-colors hover:bg-slate-100 hover:text-danger dark:hover:bg-white/[.04] sm:text-[13px]"
            aria-label="Remove from recovery queue"
          >
            <Trash2 size={15} aria-hidden />
            Delete
          </button>
        </div>
      )}
    </motion.article>
  );
}

export function RecoveryQueuePanel() {
  const { submissions, approveClaim, rejectClaim, refresh } = useRecovery();
  const d = useData();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [dismissTick, setDismissTick] = useState(0);

  useEffect(() => {
    const onDismiss = () => setDismissTick((t) => t + 1);
    window.addEventListener(ADMIN_DISMISSALS_CHANGED, onDismiss);
    return () => window.removeEventListener(ADMIN_DISMISSALS_CHANGED, onDismiss);
  }, []);

  const queue = useMemo(
    () => submissions.filter((s): s is CollectionClaimSubmission => {
      if (isRecoverySubmissionDismissed(s.id)) return false;
      return s.type === 'COLLECTION_CLAIM'
        && (s.status === 'PENDING' || s.status === 'APPROVED' || s.status === 'REJECTED');
    }),
    [submissions, dismissTick],
  );

  const pendingClaims = useMemo(
    () => queue.filter((s) => s.type === 'COLLECTION_CLAIM' && s.status === 'PENDING').length,
    [queue],
  );

  const customerIdFor = (loanId: number) => d.loans.find((l) => l.id === loanId)?.customerId ?? loanId;

  const onApprove = async (id: string) => {
    setBusy(id);
    try {
      await approveClaim(id);
      toast('Collection accepted — ledger updated', 'success');
    } catch {
      toast('Could not accept — try again', 'error');
    } finally {
      setBusy(null);
    }
  };

  const onReject = (id: string) => {
    rejectClaim(id);
    toast('Submission rejected', 'info');
  };

  const onDelete = (id: string) => {
    removeSubmissionFromAdminQueue(id);
    refresh();
    toast('Removed from queue', 'success');
  };

  if (queue.length === 0) {
    return (
      <section
        className="anim-pop flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200/90 bg-surface/60 px-6 py-14 text-center dark:border-white/[.08]"
        aria-label="Recovery queue"
      >
        <div className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
          <Inbox size={26} />
        </div>
        <p className="font-display text-lg font-bold text-ink">Recovery queue is clear</p>
        <p className="max-w-sm text-[13px] text-muted">
          Pending collection claims from recovery agents will appear here for approval.
        </p>
      </section>
    );
  }

  return (
    <section
      className="anim-pop min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-surface shadow-card dark:border-white/[.08]"
      aria-label="Recovery queue"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100/80 bg-gradient-to-r from-[#022999]/[.08] via-surface to-[#0AA8F8]/[.06] px-4 py-3.5 dark:border-white/[.06] sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#022999] to-[#0AA8F8] text-white shadow-[0_6px_16px_-8px_rgba(5,56,204,.45)]">
            <HandCoins size={18} />
          </span>
          <div>
            <p className="font-display text-[15px] font-bold text-ink">Recovery queue</p>
            <p className="text-[11px] text-muted">
              {queue.length} item{queue.length === 1 ? '' : 's'}
              {pendingClaims > 0 && (
                <span className="font-semibold text-amber-700 dark:text-amber-300">
                  {' '}· {pendingClaims} awaiting approval
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-4 p-3 sm:p-5 lg:grid-cols-2 [&>*]:min-w-0">
        {queue.map((s, i) => {
          const customerId = customerIdFor(s.loanId);
          return (
            <CollectionClaimCard
              key={s.id}
              submission={s}
              customerId={customerId}
              busy={busy === s.id}
              index={i}
              onReject={() => onReject(s.id)}
              onApprove={() => onApprove(s.id)}
              onDelete={() => onDelete(s.id)}
            />
          );
        })}
      </div>
    </section>
  );
}
