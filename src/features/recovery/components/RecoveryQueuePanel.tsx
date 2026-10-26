import { ApiError } from '@/lib/api';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useRecovery } from '../RecoveryContext';
import { useData, LOAN_LABELS } from '@/mock/DataContext';
import { inr, fmtDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { CustomerAvatar } from '@/components/CustomerAvatar';
import type { CollectionClaimSubmission } from '../types';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Eye,
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
import { Dialog } from '@/components/ui/dialog';
import { enrichCollectionClaim, upiSnapshotFromClaim } from '@/lib/recoveryClaimUpi';
import { RecoveryUpiDetails } from './RecoveryUpiDetails';
import {
  latestProofForClaim,
  listPaymentProofs,
  PAYMENT_PROOF_SUBMITTED_EVENT,
  type PaymentProofRecord,
} from '@/features/customer-portal/paymentProofStore';
import { borrowerProofsMatchingClaim, screenshotStatusLabel } from '../recoveryCollectionUi';

/** "Possible duplicate" line for a claim that matches borrower screenshots. */
function duplicateNote(matches: PaymentProofRecord[]): string {
  const p = matches[0];
  const state = p.status === 'verified' ? 'already accepted' : 'awaiting review';
  return `The borrower also uploaded a screenshot of ${inr(p.amountRupees)} for this loan on ${fmtDate(p.submittedAt.slice(0, 10))} (${state}). `
    + 'Accept here only if it is a different payment, so the same money is not recorded twice.';
}

function QueueMeta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200/70 bg-slate-50/50 px-2 py-1.5 dark:border-white/[.06] dark:bg-white/[.03]">
      <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-muted">{label}</p>
      <div className="mt-0.5 break-words text-[12px] font-semibold leading-snug text-ink">{children}</div>
    </div>
  );
}

function CollectionClaimCard({
  submission,
  customerId,
  loanTypeLabel,
  screenshotLabel,
  duplicateWarning,
  busy,
  index,
  onViewScreenshot,
  onReject,
  onApprove,
  onDelete,
}: {
  submission: CollectionClaimSubmission;
  customerId: number;
  loanTypeLabel: string;
  screenshotLabel: string;
  /** Borrower screenshot(s) that may be this same payment (pending claims only). */
  duplicateWarning: string | null;
  busy: boolean;
  index: number;
  /** Set when the claim's screenshot can be shown. */
  onViewScreenshot?: () => void;
  onReject: () => void;
  onApprove: () => void;
  onDelete: () => void;
}) {
  const claim = enrichCollectionClaim(submission);
  const upiSnap = upiSnapshotFromClaim(claim);
  const pending = submission.status === 'PENDING';
  const approved = submission.status === 'APPROVED';
  const rejected = submission.status === 'REJECTED';

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
      className={cn(
        'overflow-hidden rounded-2xl border bg-surface shadow-soft transition-shadow hover:shadow-card dark:border-white/[.08]',
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

      <div className="p-2.5 sm:p-3.5">
        <div className="min-w-0 w-full">
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-2">
                <CustomerAvatar
                  customerId={customerId}
                  name={submission.customerName}
                  className="h-9 w-9 shrink-0 rounded-lg shadow-[0_4px_12px_-8px_rgba(245,158,11,.4)]"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="break-words font-display text-[14px] font-bold leading-snug text-ink">
                    {submission.customerName}
                  </h3>
                  <p className="mt-0.5 break-all font-mono text-[10px] text-muted">{submission.loanNumber}</p>
                  {loanTypeLabel !== '—' ? (
                    <p className="mt-0.5 text-[10px] font-semibold text-ink/85">{loanTypeLabel}</p>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 self-start sm:flex-col sm:items-end">
                {approved && <Badge className="shrink-0 bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">Accepted</Badge>}
                {rejected && <Badge className="shrink-0 bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200">Rejected</Badge>}
                {pending && <Badge tone="warn" className="shrink-0">Pending</Badge>}
              </div>
            </div>

            <p className="mt-2 font-display text-[19px] font-bold leading-none tabular-nums text-ink sm:text-[20px]">
              {inr(submission.amount)}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
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

            <div className="mt-2 grid grid-cols-1 gap-1.5 xs:grid-cols-2 sm:grid-cols-3">
              <QueueMeta label="Recovery agent">
                <span className="inline-flex items-center gap-1 break-words">
                  <UserCheck size={12} className="shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                  {submission.agentName}
                </span>
              </QueueMeta>
              <QueueMeta label="Screenshot">
                {onViewScreenshot ? (
                  <button
                    type="button"
                    onClick={onViewScreenshot}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                    aria-label={`View screenshot (${screenshotLabel})`}
                  >
                    <Eye size={12} aria-hidden />
                    {screenshotLabel}
                  </button>
                ) : screenshotLabel}
              </QueueMeta>
              <QueueMeta label="Submitted">
                {fmtDate(submission.createdAt.slice(0, 10))}
              </QueueMeta>
            </div>

            {pending && (
              <p className="mt-2 rounded-lg border border-primary/15 bg-primary/[.04] px-2.5 py-1.5 text-[10px] leading-snug text-muted dark:border-primary/20">
                <strong className="font-semibold text-ink">Accept</strong> records this payment on the ledger once
                {screenshotLabel === 'Pending review' ? ' and accepts its screenshot with it' : ''}.
              </p>
            )}

            {pending && duplicateWarning && (
              <p
                className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-300/60 bg-amber-50/90 px-2.5 py-1.5 text-[10px] leading-snug text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
                role="status"
              >
                <AlertTriangle size={12} className="mt-px shrink-0" aria-hidden />
                <span><strong className="font-semibold">Possible duplicate.</strong> {duplicateWarning}</span>
              </p>
            )}

            {upiSnap ? (
              <div className="mt-2">
                <RecoveryUpiDetails snap={upiSnap} compact />
              </div>
            ) : null}

            {submission.note ? (
              <p className="mt-2 rounded-lg border border-slate-200/70 bg-slate-50/40 px-2.5 py-1.5 text-[11px] leading-snug text-muted dark:border-white/[.06] dark:bg-white/[.02]">
                {submission.note}
              </p>
            ) : null}
        </div>
      </div>

      {pending ? (
        <div className="action-bar-2 border-t border-slate-100 dark:border-white/[.06]">
          <button
            type="button"
            onClick={onReject}
            disabled={busy}
            className="flex min-h-9 items-center justify-center gap-1 py-2 text-[11px] font-semibold text-danger transition-colors hover:bg-danger/[.06] disabled:opacity-50 sm:text-[12px]"
          >
            <X size={15} aria-hidden />
            Reject
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className="flex min-h-9 items-center justify-center gap-1 bg-success/[.04] py-2 text-[11px] font-semibold text-success transition-colors hover:bg-success/[.10] disabled:opacity-50 sm:text-[12px]"
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
            className="flex min-h-9 w-full items-center justify-center gap-1 py-2 text-[11px] font-semibold text-muted transition-colors hover:bg-slate-100 hover:text-danger dark:hover:bg-white/[.04] sm:text-[12px]"
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
  const [viewer, setViewer] = useState<{ proof: PaymentProofRecord; claim: CollectionClaimSubmission } | null>(null);

  useEffect(() => {
    const bump = () => setDismissTick((t) => t + 1);
    window.addEventListener(ADMIN_DISMISSALS_CHANGED, bump);
    window.addEventListener(PAYMENT_PROOF_SUBMITTED_EVENT, bump);
    return () => {
      window.removeEventListener(ADMIN_DISMISSALS_CHANGED, bump);
      window.removeEventListener(PAYMENT_PROOF_SUBMITTED_EVENT, bump);
    };
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

  const loanTypeLabelFor = (loanId: number) => {
    const loan = d.loans.find((l) => l.id === loanId);
    return loan ? LOAN_LABELS[loan.type] : '—';
  };

  // Borrower screenshots, for the possible-duplicate check (re-read on proof events).
  const borrowerProofs = useMemo(() => listPaymentProofs().filter((p) => !p.claimId), [dismissTick]);

  const onApprove = async (submission: CollectionClaimSubmission) => {
    const matches = borrowerProofsMatchingClaim(submission, borrowerProofs);
    if (matches.length > 0) {
      const ok = window.confirm(
        `Possible duplicate payment.\n\n${duplicateNote(matches)}\n\nAccept ${inr(submission.amount)} from ${submission.agentName}?`,
      );
      if (!ok) return;
    }
    setBusy(submission.id);
    try {
      await approveClaim(submission.id);
      toast('Collection accepted — ledger updated', 'success');
    } catch (e) {
      // e.g. the agent changed the claim after it was opened: say so and show
      // the current version for a fresh review.
      toast(e instanceof ApiError ? e.message : 'Could not accept — try again', 'error');
      refresh();
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
            <p className="font-display text-[15px] font-bold text-ink">
              Recovery queue
              {pendingClaims > 0 ? (
                <span className="ml-2 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                  {pendingClaims} awaiting approval
                </span>
              ) : null}
            </p>
          </div>
        </div>
      </div>

      <div className="grid min-w-0 items-start gap-3 p-2.5 sm:p-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,18.5rem),1fr))] [&>*]:min-w-0 [&>*]:self-start">
        {queue.map((s, i) => {
          const customerId = customerIdFor(s.loanId);
          // The screenshot attached to THIS claim (not the loan's latest upload).
          const proof = latestProofForClaim(s.id);
          const screenshotLabel = proof || s.mode === 'UPI' ? screenshotStatusLabel(proof) : '—';
          const matches = s.status === 'PENDING' ? borrowerProofsMatchingClaim(s, borrowerProofs) : [];
          return (
            <CollectionClaimCard
              key={s.id}
              submission={s}
              customerId={customerId}
              loanTypeLabel={loanTypeLabelFor(s.loanId)}
              screenshotLabel={screenshotLabel}
              duplicateWarning={matches.length > 0 ? duplicateNote(matches) : null}
              busy={busy === s.id}
              index={i}
              onViewScreenshot={proof ? () => setViewer({ proof, claim: s }) : undefined}
              onReject={() => onReject(s.id)}
              onApprove={() => onApprove(s)}
              onDelete={() => onDelete(s.id)}
            />
          );
        })}
      </div>

      <Dialog
        open={!!viewer}
        onClose={() => setViewer(null)}
        xl
        centerOnMobile
        title={viewer ? `Screenshot · ${viewer.claim.loanNumber}` : 'Screenshot'}
        subtitle={viewer ? `${viewer.claim.agentName} · ${inr(viewer.claim.amount)} · ${screenshotStatusLabel(viewer.proof)}` : undefined}
      >
        {viewer && (
          <div className="-mx-4 -my-5 flex min-h-[min(55dvh,28rem)] flex-col justify-center sm:-mx-6">
            {viewer.proof.dataUrl ? (
              <img
                src={viewer.proof.dataUrl}
                alt={`Payment screenshot for loan ${viewer.claim.loanNumber}, ${inr(viewer.claim.amount)}`}
                className="mx-auto max-h-[min(72dvh,40rem)] w-full object-contain bg-slate-100/60 dark:bg-black/25"
              />
            ) : (
              <p className="px-4 py-12 text-center text-[13px] text-muted sm:px-6">
                Screenshot is still loading or unavailable. Close and try again, or refresh the page.
              </p>
            )}
          </div>
        )}
      </Dialog>
    </section>
  );
}
