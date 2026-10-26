import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CalendarClock, Check, Eye, ImageIcon, Link2, Trash2, X } from 'lucide-react';
import { useData, LOAN_LABELS } from '@/mock/DataContext';
import { useRecovery } from '@/features/recovery/RecoveryContext';
import { agentClaimsMatchingProof } from '@/features/recovery/recoveryCollectionUi';
import type { CollectionClaimSubmission } from '@/features/recovery/types';
import { inr, fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { CustomerAvatar } from '@/components/CustomerAvatar';
import { payPurposeTitle } from '@/features/customer-portal/loanPortalSummary';
import {
  listPaymentProofs,
  reviewPaymentProof,
  removePaymentProofFromAdmin,
  PAYMENT_PROOF_SUBMITTED_EVENT,
  type PaymentProofRecord,
} from '@/features/customer-portal/paymentProofStore';
import { paymentProofSubmissionMeta } from '@/features/customer-portal/paymentProofDisplay';

interface Props {
  canReview: boolean;
  onOpenLoan?: (loanId: number) => void;
}

function ProofStatusBadge({ status }: { status: PaymentProofRecord['status'] }) {
  if (status === 'pending') {
    return (
      <Badge className="shrink-0 bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
        Pending
      </Badge>
    );
  }
  if (status === 'rejected') {
    return (
      <Badge className="shrink-0 bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200">
        Rejected
      </Badge>
    );
  }
  return (
    <Badge className="shrink-0 bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">
      Accepted
    </Badge>
  );
}

function ProofMeta({
  label,
  children,
  ellipsis,
  title,
  className,
}: {
  label: string;
  children: ReactNode;
  /** Single-line ellipsis — use for long filenames. */
  ellipsis?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'min-w-0 max-w-full overflow-hidden rounded-lg border border-slate-200/70 bg-slate-50/50 px-2 py-1.5 text-center dark:border-white/[.06] dark:bg-white/[.03] sm:text-left',
        className,
      )}
      title={title}
    >
      <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-muted">{label}</p>
      <div
        className={cn(
          'mt-0.5 text-[12px] font-semibold leading-snug text-ink',
          ellipsis ? 'min-w-0 truncate' : 'break-words',
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * How a recovery agent's screenshot attached to a collection claim may be
 * reviewed (null for a borrower's own screenshot). The claim records the money;
 * the screenshot is evidence and never books anything itself.
 *  - awaiting: claim not reviewed yet → review the claim in the Recovery queue
 *    (accepting it accepts this screenshot); only Reject here.
 *  - booked:   claim accepted → "Confirm screenshot" marks it checked, records nothing.
 *  - rejected: claim rejected → only Reject.
 */
type EvidenceState = 'awaiting' | 'booked' | 'rejected' | null;

function evidenceState(p: PaymentProofRecord): EvidenceState {
  if (!p.claimId) return null;
  if (p.claimStatus === 'APPROVED') return 'booked';
  if (p.claimStatus === 'REJECTED') return 'rejected';
  return 'awaiting';
}

/** "Possible duplicate" line for a borrower screenshot matching agent collections. */
function duplicateNote(matches: CollectionClaimSubmission[]): string {
  const c = matches[0];
  const state = c.status === 'APPROVED' ? 'already accepted' : 'awaiting approval';
  return `${c.agentName} (recovery agent) reported ${inr(c.amount)} for this loan on ${fmtDate(c.receiptDate)} (${state}). `
    + 'Accept only if this is a different payment, so the same money is not recorded twice.';
}

function PaymentProofCard({
  proof,
  customerName,
  customerId,
  loanTypeLabel,
  canReview,
  duplicateWarning,
  onOpenLoan,
  onView,
  onReject,
  onAccept,
  onDelete,
  index,
}: {
  proof: PaymentProofRecord;
  customerName: string;
  customerId: number;
  loanTypeLabel: string;
  canReview: boolean;
  /** Agent collection(s) this borrower screenshot may duplicate. */
  duplicateWarning: string | null;
  onOpenLoan?: (loanId: number) => void;
  onView: () => void;
  onReject: () => void;
  onAccept: () => void;
  onDelete: () => void;
  index: number;
}) {
  const pending = proof.status === 'pending';
  const submission = paymentProofSubmissionMeta(proof, customerName);
  const evidence = pending ? evidenceState(proof) : null;
  const canAccept = evidence === null || evidence === 'booked';

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
      className={cn(
        'min-w-0 max-w-full overflow-hidden rounded-2xl border bg-surface shadow-soft transition-shadow hover:shadow-card dark:border-white/[.08]',
        pending ? 'border-amber-300/40 dark:border-amber-500/25' : 'border-slate-200/80',
      )}
    >
      <div
        className={cn(
          'h-1 w-full',
          pending
            ? 'bg-gradient-to-r from-amber-400 via-amber-500 to-orange-400'
            : proof.status === 'verified'
              ? 'bg-gradient-to-r from-emerald-400 to-emerald-600'
              : 'bg-gradient-to-r from-rose-400 to-rose-600',
        )}
        aria-hidden
      />

      <div className="p-2.5 sm:p-3.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
          <button
            type="button"
            onClick={onView}
            className="group/thumb relative mx-auto w-full max-w-[140px] shrink-0 overflow-hidden rounded-xl ring-1 ring-slate-200/80 transition-all hover:ring-primary/40 sm:mx-0 sm:w-auto sm:max-w-none dark:ring-white/10"
            aria-label={`View payment screenshot for ${proof.loanNumber}`}
          >
            <img
              src={proof.dataUrl}
              alt=""
              className="h-auto max-h-28 w-full object-cover transition-transform duration-300 group-hover/thumb:scale-[1.03] sm:h-[72px] sm:w-[72px] sm:max-h-none"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-ink/0 transition-colors group-hover/thumb:bg-ink/25">
              <span className="grid h-8 w-8 scale-90 place-items-center rounded-full bg-surface/95 text-primary opacity-0 shadow-soft transition-all group-hover/thumb:scale-100 group-hover/thumb:opacity-100">
                <Eye size={14} aria-hidden />
              </span>
            </span>
          </button>

          <div className="min-w-0 w-full flex-1 max-sm:text-center">
            <div className="relative flex flex-col items-center gap-2 sm:flex-row sm:items-start sm:justify-between sm:text-left">
              {canReview && !pending && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="absolute right-0 top-0 grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-danger/10 hover:text-danger sm:hidden"
                  aria-label="Delete payment proof"
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              )}
              <div className="flex w-full flex-col items-center gap-2 sm:flex-row sm:items-start sm:gap-2">
                <CustomerAvatar
                  customerId={customerId}
                  name={submission.avatarName}
                  className="h-9 w-9 shrink-0 rounded-lg shadow-[0_4px_12px_-8px_rgba(79,70,229,.4)]"
                />
                <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5 sm:items-start">
                  <h3 className="break-words font-display text-[14px] font-bold leading-snug text-ink">
                    {submission.titleName}
                  </h3>
                  <p className="break-words text-[11px] font-semibold leading-snug text-ink">
                    {submission.submitterLine}
                  </p>
                  <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-primary">
                    {submission.roleLabel}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                    {evidence === 'booked' ? (
                      <Badge className="shrink-0 bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-100">
                        Payment booked · confirm screenshot
                      </Badge>
                    ) : evidence === 'awaiting' ? (
                      <Badge className="shrink-0 bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-100">
                        <Link2 size={11} className="mr-1 inline" aria-hidden />
                        Agent collection screenshot
                      </Badge>
                    ) : (
                      <ProofStatusBadge status={proof.status} />
                    )}
                  </div>
                  <p className={cn('flex items-center justify-center gap-1 text-[11px] text-muted sm:justify-start')}>
                    <CalendarClock size={12} className="shrink-0 opacity-70" aria-hidden />
                    {fmtDate(proof.submittedAt.slice(0, 10))}
                  </p>
                </div>
              </div>
              <div className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
                {canReview && !pending && (
                  <button
                    type="button"
                    onClick={onDelete}
                    className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                    aria-label="Delete payment proof"
                  >
                    <Trash2 size={16} aria-hidden />
                  </button>
                )}
              </div>
            </div>

            <p className="mt-2 font-display text-[19px] font-bold leading-none tabular-nums text-ink sm:text-left sm:text-[20px]">
              {inr(proof.amountRupees)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted sm:text-left">{payPurposeTitle(proof.purpose)}</p>

            <div
              className={cn(
                'mt-2 grid min-w-0 grid-cols-1 gap-1.5 [&>*]:min-w-0',
                submission.showBorrower ? 'xs:grid-cols-2 sm:grid-cols-3' : 'xs:grid-cols-2',
              )}
            >
              {submission.showBorrower && (
                <ProofMeta label="Borrower" ellipsis title={customerName}>
                  {customerName}
                </ProofMeta>
              )}
              <ProofMeta label="Loan" ellipsis title={proof.loanNumber}>
                {onOpenLoan ? (
                  <button
                    type="button"
                    onClick={() => onOpenLoan(proof.loanId)}
                    className="block min-w-0 max-w-full truncate text-left text-primary hover:underline max-sm:mx-auto max-sm:text-center"
                  >
                    {proof.loanNumber}
                  </button>
                ) : (
                  proof.loanNumber
                )}
                {loanTypeLabel !== '—' ? (
                  <span className="mt-0.5 block text-[11px] font-medium text-muted">{loanTypeLabel}</span>
                ) : null}
              </ProofMeta>
              <ProofMeta
                label="File"
                ellipsis
                title={proof.fileName}
                className={submission.showBorrower ? 'xs:col-span-2 sm:col-span-1' : undefined}
              >
                <span className="font-medium text-muted">{proof.fileName}</span>
              </ProofMeta>
            </div>

            {evidence && (
              <p
                className="mt-2 rounded-lg border border-sky-200/80 bg-sky-50/90 px-2.5 py-1.5 text-[10px] leading-snug text-sky-950 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-100"
                role="status"
              >
                {evidence === 'awaiting' ? (
                  <>
                    Screenshot for the agent&apos;s collection of {inr(proof.amountRupees)}. Review that collection in the
                    <strong className="font-semibold"> Recovery queue</strong> — accepting it accepts this screenshot and records the payment once.
                    Reject here only if the image is unclear.
                  </>
                ) : evidence === 'booked' ? (
                  <>
                    The agent&apos;s collection was already <strong className="font-semibold">accepted</strong> — the payment is on the ledger.
                    <strong className="font-semibold"> Confirm screenshot</strong> marks it checked and records nothing; <strong className="font-semibold">Reject</strong> asks the agent for a new one.
                  </>
                ) : (
                  <>The agent&apos;s collection was rejected. Reject this screenshot too.</>
                )}
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
          </div>
        </div>
      </div>

      <div
        className={cn(
          'border-t border-slate-100 dark:border-white/[.06]',
          canReview && pending && canAccept ? 'action-bar-3' : canReview ? 'action-bar-2' : 'action-bar-1',
        )}
      >
        <button
          type="button"
          onClick={onView}
          className="flex min-h-9 w-full min-w-0 items-center justify-center gap-1 py-2 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/[.05] sm:text-[12px]"
        >
          <Eye size={15} aria-hidden />
          View
        </button>
        {canReview && pending && (
          <>
            <button
              type="button"
              onClick={onReject}
              className="flex min-h-9 items-center justify-center gap-1 py-2 text-[11px] font-semibold text-danger transition-colors hover:bg-danger/[.06] sm:text-[12px]"
            >
              <X size={15} aria-hidden />
              Reject
            </button>
            {canAccept && (
              <button
                type="button"
                onClick={onAccept}
                title={evidence === 'booked'
                  ? 'Mark the screenshot checked — the payment is already on the ledger; nothing is recorded'
                  : 'Accept the borrower’s payment — records it on the ledger'}
                className="flex min-h-9 items-center justify-center gap-1 bg-success/[.04] py-2 text-[11px] font-semibold text-success transition-colors hover:bg-success/[.10] sm:text-[12px]"
              >
                <Check size={15} aria-hidden />
                {evidence === 'booked' ? 'Confirm screenshot' : 'Accept'}
              </button>
            )}
          </>
        )}
        {canReview && !pending && (
          <button
            type="button"
            onClick={onDelete}
            className="flex min-h-9 items-center justify-center gap-1 py-2 text-[11px] font-semibold text-muted transition-colors hover:bg-slate-100 hover:text-danger dark:hover:bg-white/[.04] sm:text-[12px]"
          >
            <Trash2 size={15} aria-hidden />
            Delete
          </button>
        )}
      </div>
    </motion.article>
  );
}

export function CustomerPortalProofsPanel({ canReview, onOpenLoan }: Props) {
  const toast = useToast();
  const d = useData();
  const recovery = useRecovery();
  const [tick, setTick] = useState(0);
  const [viewer, setViewer] = useState<PaymentProofRecord | null>(null);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const onChange = () => refresh();
    window.addEventListener(PAYMENT_PROOF_SUBMITTED_EVENT, onChange);
    return () => window.removeEventListener(PAYMENT_PROOF_SUBMITTED_EVENT, onChange);
  }, [refresh]);

  const proofs = useMemo(() => listPaymentProofs(), [tick]);
  const pendingCount = useMemo(() => proofs.filter((p) => p.status === 'pending').length, [proofs]);

  const customerName = (customerId: number) =>
    d.customers.find((c) => c.id === customerId)?.name ?? `Customer #${customerId}`;

  const loanTypeLabel = (loanId: number) => {
    const loan = d.loans.find((l) => l.id === loanId);
    return loan ? LOAN_LABELS[loan.type] : '—';
  };

  // Waits for the server: a refusal (e.g. the amount now exceeds the loan's
  // outstanding) is shown as an error, never as "accepted".
  const busyIds = useRef(new Set<string>());
  const onDeleteProof = (id: string, closeViewer?: boolean) => {
    removePaymentProofFromAdmin(id);
    toast('Payment proof removed', 'success');
    refresh();
    if (closeViewer) setViewer(null);
  };

  const duplicatesOf = (p: PaymentProofRecord) =>
    (p.status === 'pending' ? agentClaimsMatchingProof(p, recovery.submissions) : []);

  const setStatus = async (proof: PaymentProofRecord, status: 'verified' | 'rejected', closeViewer?: boolean) => {
    const { id } = proof;
    if (busyIds.current.has(id)) return;
    const evidence = evidenceState(proof);
    if (status === 'verified') {
      const matches = duplicatesOf(proof);
      if (matches.length > 0 && !window.confirm(
        `Possible duplicate payment.\n\n${duplicateNote(matches)}\n\nAccept ${inr(proof.amountRupees)} from this screenshot?`,
      )) return;
      if (evidence === 'booked' && !window.confirm(
        'The agent’s collection for this screenshot is already on the ledger.\n\nConfirm only marks the screenshot as checked — it records nothing.',
      )) return;
    }
    busyIds.current.add(id);
    try {
      const err = await reviewPaymentProof(id, status);
      if (err) {
        toast(err, 'error');
        refresh();
        return;
      }
      toast(
        status === 'rejected' ? 'Payment proof rejected' : evidence ? 'Screenshot confirmed' : 'Payment proof accepted',
        status === 'verified' ? 'success' : 'error',
      );
      refresh();
      if (closeViewer) setViewer(null);
    } finally {
      busyIds.current.delete(id);
    }
  };

  if (proofs.length === 0) {
    return (
      <section
        className="anim-pop flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200/90 bg-surface/60 px-6 py-14 text-center dark:border-white/[.08]"
        aria-label="Customer portal payment proofs"
      >
        <div className="grid h-14 w-14 place-items-center rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-300">
          <ImageIcon size={26} aria-hidden />
        </div>
        <p className="font-display text-lg font-bold text-ink">No open proof</p>
      </section>
    );
  }

  return (
    <>
      <section
        className="anim-pop min-w-0 max-w-full overflow-hidden rounded-2xl border border-violet-200/70 bg-surface shadow-card dark:border-violet-500/20"
        aria-label="Customer portal payment proofs"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100/80 bg-gradient-to-r from-violet-600/[.08] via-surface to-indigo-500/[.05] px-4 py-3.5 dark:border-white/[.06] sm:px-5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-300">
              <ImageIcon size={18} />
            </span>
            <div>
              <p className="font-display text-[15px] font-bold text-ink">
                Customer portal proofs
                {pendingCount > 0 ? (
                  <span className="ml-2 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                    {pendingCount} pending review
                  </span>
                ) : null}
              </p>
            </div>
          </div>
        </div>

        <div className="grid min-w-0 gap-3 p-2.5 sm:p-4 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
          {proofs.map((p, i) => {
            const matches = duplicatesOf(p);
            return (
              <PaymentProofCard
                key={p.id}
                proof={p}
                customerId={p.customerId}
                customerName={customerName(p.customerId)}
                loanTypeLabel={loanTypeLabel(p.loanId)}
                canReview={canReview}
                duplicateWarning={matches.length > 0 ? duplicateNote(matches) : null}
                onOpenLoan={onOpenLoan}
                onView={() => setViewer(p)}
                onReject={() => void setStatus(p, 'rejected')}
                onAccept={() => void setStatus(p, 'verified')}
                onDelete={() => onDeleteProof(p.id)}
                index={i}
              />
            );
          })}
        </div>
      </section>

      <Dialog
        open={!!viewer}
        onClose={() => setViewer(null)}
        xl
        centerOnMobile
        title={viewer ? `Screenshot · ${viewer.loanNumber}` : 'Screenshot'}
        footerClassName="flex-col gap-2.5 sm:flex-row sm:justify-end [&_button]:w-full sm:[&_button]:w-auto"
        footer={
          viewer && (
            <>
              <Button variant="ghost" className="order-3 sm:order-none" onClick={() => setViewer(null)}>
                Close
              </Button>
              {canReview && viewer.status === 'pending' && (() => {
                const evidence = evidenceState(viewer);
                return (
                <>
                  <Button
                    variant="ghost"
                    className="order-2 text-danger hover:border-danger/30 hover:bg-danger/5 sm:order-none"
                    onClick={() => void setStatus(viewer, 'rejected', true)}
                  >
                    <X size={15} />
                    Reject
                  </Button>
                  {(evidence === null || evidence === 'booked') && (
                    <Button
                      variant="success"
                      className="order-1 sm:order-none"
                      onClick={() => void setStatus(viewer, 'verified', true)}
                    >
                      <Check size={15} />
                      {evidence === 'booked' ? 'Confirm screenshot' : 'Accept'}
                    </Button>
                  )}
                </>
                );
              })()}
              {canReview && viewer.status !== 'pending' && (
                <Button
                  variant="ghost"
                  className="text-danger hover:border-danger/30 hover:bg-danger/5"
                  onClick={() => onDeleteProof(viewer.id, true)}
                >
                  <Trash2 size={15} />
                  Delete
                </Button>
              )}
            </>
          )
        }
      >
        {viewer && (
          <div className="-mx-4 -my-5 flex min-h-[min(55dvh,28rem)] flex-col justify-center sm:-mx-6">
            {viewer.dataUrl ? (
              <img
                src={viewer.dataUrl}
                alt={`Payment screenshot for loan ${viewer.loanNumber}, ${inr(viewer.amountRupees)}`}
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
    </>
  );
}
