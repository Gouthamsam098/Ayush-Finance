import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { CalendarClock, Check, Eye, ImageIcon, Smartphone, Trash2, X } from 'lucide-react';
import { useData } from '@/mock/DataContext';
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
        'min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200/70 bg-slate-50/50 px-3 py-2 text-center dark:border-white/[.06] dark:bg-white/[.03] sm:text-left',
        className,
      )}
      title={title}
    >
      <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted">{label}</p>
      <div
        className={cn(
          'mt-0.5 text-[13px] font-semibold leading-snug text-ink',
          ellipsis ? 'min-w-0 truncate' : 'break-words',
        )}
      >
        {children}
      </div>
    </div>
  );
}

function PaymentProofCard({
  proof,
  customerName,
  customerId,
  canReview,
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
  canReview: boolean;
  onOpenLoan?: (loanId: number) => void;
  onView: () => void;
  onReject: () => void;
  onAccept: () => void;
  onDelete: () => void;
  index: number;
}) {
  const pending = proof.status === 'pending';
  const submission = paymentProofSubmissionMeta(proof, customerName);

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
      className={cn(
        'min-w-0 max-w-full overflow-hidden rounded-[18px] border bg-surface shadow-card transition-shadow hover:shadow-soft dark:border-white/[.08]',
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

      <div className="p-3 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
          <button
            type="button"
            onClick={onView}
            className="group/thumb relative mx-auto w-full max-w-[200px] shrink-0 overflow-hidden rounded-2xl ring-1 ring-slate-200/80 transition-all hover:ring-primary/40 sm:mx-0 sm:w-auto sm:max-w-none dark:ring-white/10"
            aria-label={`View payment screenshot for ${proof.loanNumber}`}
          >
            <img
              src={proof.dataUrl}
              alt=""
              className="h-auto max-h-40 w-full object-cover transition-transform duration-300 group-hover/thumb:scale-[1.03] sm:h-[96px] sm:w-[96px] sm:max-h-none"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-ink/0 transition-colors group-hover/thumb:bg-ink/25">
              <span className="grid h-9 w-9 scale-90 place-items-center rounded-full bg-surface/95 text-primary opacity-0 shadow-soft transition-all group-hover/thumb:scale-100 group-hover/thumb:opacity-100">
                <Eye size={16} aria-hidden />
              </span>
            </span>
          </button>

          <div className="min-w-0 w-full flex-1 max-sm:text-center">
            <div className="relative flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:justify-between sm:text-left">
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
              <div className="flex w-full flex-col items-center gap-2.5 sm:flex-row sm:items-start sm:gap-2.5">
                <CustomerAvatar
                  customerId={customerId}
                  name={submission.avatarName}
                  className="h-11 w-11 shrink-0 rounded-xl shadow-[0_6px_16px_-8px_rgba(79,70,229,.45)] sm:h-10 sm:w-10"
                />
                <div className="flex min-w-0 flex-1 flex-col items-center gap-1 sm:items-start">
                  <h3 className="break-words font-display text-[16px] font-bold leading-snug text-ink sm:text-[16px]">
                    {submission.titleName}
                  </h3>
                  <p className="break-words text-[11px] font-semibold leading-snug text-ink">
                    {submission.submitterLine}
                  </p>
                  <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-primary">
                    {submission.roleLabel}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                    <ProofStatusBadge status={proof.status} />
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

            <p className="mt-4 font-display text-[24px] font-bold leading-none tabular-nums text-ink sm:mt-3 sm:text-left sm:text-[24px]">
              {inr(proof.amountRupees)}
            </p>
            <p className="mt-1 text-[12px] text-muted sm:text-left">{payPurposeTitle(proof.purpose)}</p>

            <div
              className={cn(
                'mt-3 grid min-w-0 grid-cols-1 gap-2 [&>*]:min-w-0',
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
          </div>
        </div>
      </div>

      <div
        className={cn(
          'border-t border-slate-100 dark:border-white/[.06]',
          canReview && pending ? 'action-bar-3' : canReview && !pending ? 'action-bar-2' : 'action-bar-1',
        )}
      >
        <button
          type="button"
          onClick={onView}
          className="flex min-h-11 w-full min-w-0 items-center justify-center gap-1.5 py-3 text-[12px] font-semibold text-primary transition-colors hover:bg-primary/[.05] sm:text-[13px]"
        >
          <Eye size={15} aria-hidden />
          View
        </button>
        {canReview && pending && (
          <>
            <button
              type="button"
              onClick={onReject}
              className="flex min-h-11 items-center justify-center gap-1.5 py-3 text-[12px] font-semibold text-danger transition-colors hover:bg-danger/[.06] sm:text-[13px]"
            >
              <X size={15} aria-hidden />
              Reject
            </button>
            <button
              type="button"
              onClick={onAccept}
              className="flex min-h-11 items-center justify-center gap-1.5 bg-success/[.04] py-3 text-[12px] font-semibold text-success transition-colors hover:bg-success/[.10] sm:text-[13px]"
            >
              <Check size={15} aria-hidden />
              Accept
            </button>
          </>
        )}
        {canReview && !pending && (
          <button
            type="button"
            onClick={onDelete}
            className="flex min-h-11 items-center justify-center gap-1.5 py-3 text-[12px] font-semibold text-muted transition-colors hover:bg-slate-100 hover:text-danger dark:hover:bg-white/[.04] sm:text-[13px]"
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

  // Waits for the server: a refusal (e.g. the amount now exceeds the loan's
  // outstanding) is shown as an error, never as "accepted".
  const busyIds = useRef(new Set<string>());
  const onDeleteProof = (id: string, closeViewer?: boolean) => {
    removePaymentProofFromAdmin(id);
    toast('Payment proof removed', 'success');
    refresh();
    if (closeViewer) setViewer(null);
  };

  const setStatus = async (id: string, status: 'verified' | 'rejected', closeViewer?: boolean) => {
    if (busyIds.current.has(id)) return;
    busyIds.current.add(id);
    try {
      const err = await reviewPaymentProof(id, status);
      if (err) {
        toast(err, 'error');
        refresh();
        return;
      }
      toast(status === 'verified' ? 'Payment proof accepted' : 'Payment proof rejected', status === 'verified' ? 'success' : 'error');
      refresh();
      if (closeViewer) setViewer(null);
    } finally {
      busyIds.current.delete(id);
    }
  };

  if (proofs.length === 0) {
    return (
      <section
        className="anim-pop rounded-2xl border border-dashed border-slate-200/90 bg-surface/60 px-4 py-5 dark:border-white/[.08]"
        aria-label="Customer portal payment proofs"
      >
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300">
            <Smartphone size={18} />
          </span>
          <div>
            <p className="font-display text-[14px] font-bold text-ink">Customer portal proofs</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              When borrowers upload UPI payment screenshots from the portal, they appear here for verification.
            </p>
          </div>
        </div>
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
              <p className="font-display text-[15px] font-bold text-ink">Customer portal proofs</p>
              <p className="text-[11px] text-muted">
                {proofs.length} submission{proofs.length === 1 ? '' : 's'}
                {pendingCount > 0 && (
                  <span className="font-semibold text-amber-700 dark:text-amber-300">
                    {' '}· {pendingCount} pending review
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="grid min-w-0 gap-4 p-3 sm:p-5 lg:grid-cols-2 [&>*]:min-w-0">
          {proofs.map((p, i) => (
            <PaymentProofCard
              key={p.id}
              proof={p}
              customerId={p.customerId}
              customerName={customerName(p.customerId)}
              canReview={canReview}
              onOpenLoan={onOpenLoan}
              onView={() => setViewer(p)}
              onReject={() => setStatus(p.id, 'rejected')}
              onAccept={() => setStatus(p.id, 'verified')}
              onDelete={() => onDeleteProof(p.id)}
              index={i}
            />
          ))}
        </div>
      </section>

      <Dialog
        open={!!viewer}
        onClose={() => setViewer(null)}
        wide
        centerOnMobile
        title={viewer ? `Payment proof · ${viewer.loanNumber}` : 'Payment proof'}
        footerClassName="flex-col gap-2.5 sm:flex-row sm:justify-end [&_button]:w-full sm:[&_button]:w-auto"
        footer={
          viewer && (
            <>
              <Button variant="ghost" className="order-3 sm:order-none" onClick={() => setViewer(null)}>
                Close
              </Button>
              {canReview && viewer.status === 'pending' && (
                <>
                  <Button
                    variant="ghost"
                    className="order-2 text-danger hover:border-danger/30 hover:bg-danger/5 sm:order-none"
                    onClick={() => setStatus(viewer.id, 'rejected', true)}
                  >
                    <X size={15} />
                    Reject
                  </Button>
                  <Button
                    variant="success"
                    className="order-1 sm:order-none"
                    onClick={() => setStatus(viewer.id, 'verified', true)}
                  >
                    <Check size={15} />
                    Accept
                  </Button>
                </>
              )}
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
        {viewer && (() => {
          const m = paymentProofSubmissionMeta(viewer, customerName(viewer.customerId));
          const borrower = customerName(viewer.customerId);
          return (
            <div className="flex flex-col items-center gap-4 text-center">
              <CustomerAvatar
                customerId={viewer.customerId}
                name={m.avatarName}
                className="h-14 w-14 rounded-2xl shadow-[0_8px_24px_-10px_rgba(79,70,229,.5)]"
              />
              <div className="space-y-1">
                <p className="font-display text-[17px] font-bold leading-snug text-ink">{m.titleName}</p>
                <p className="text-[12px] font-semibold text-ink">{m.submitterLine}</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-primary">{m.roleLabel}</p>
              </div>
              <ProofStatusBadge status={viewer.status} />
              <p className="font-display text-[28px] font-bold leading-none tabular-nums text-ink">
                {inr(viewer.amountRupees)}
              </p>
              <p className="text-[12px] text-muted">{payPurposeTitle(viewer.purpose)}</p>
              <div className="flex w-full max-w-md flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted">
                {m.showBorrower && (
                  <span>
                    Borrower <span className="font-semibold text-ink">{borrower}</span>
                  </span>
                )}
                <span>
                  Loan <span className="font-mono font-semibold text-ink">{viewer.loanNumber}</span>
                </span>
                <span className="block min-w-0 max-w-full truncate px-1" title={viewer.fileName}>
                  {viewer.fileName}
                </span>
              </div>
              <div className="w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50/80 shadow-soft dark:border-white/[.08] dark:bg-white/[.03]">
                <img
                  src={viewer.dataUrl}
                  alt={`Payment screenshot for ${viewer.loanNumber}`}
                  className="max-h-[min(50dvh,420px)] w-full object-contain"
                />
              </div>
              <p className="flex items-center justify-center gap-1 text-[11px] text-muted">
                <CalendarClock size={12} className="opacity-70" aria-hidden />
                Submitted {fmtDate(viewer.submittedAt.slice(0, 10))}
              </p>
            </div>
          );
        })()}
      </Dialog>
    </>
  );
}
