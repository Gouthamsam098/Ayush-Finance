import { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '@/store';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, CircleX, Clock, ImagePlus, ShieldCheck, Sparkles, Upload, X } from 'lucide-react';
import { inr, fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import type { PortalPayPurpose } from '@/features/customer-portal/loanPortalSummary';
import {
  getLatestPaymentProof,
  submitPaymentProof,
  PAYMENT_PROOF_ACCEPT,
  PAYMENT_PROOF_MAX_BYTES,
  PAYMENT_PROOF_STORAGE_KEY,
  PAYMENT_PROOF_SUBMITTED_EVENT,
  type PaymentProofRecord,
} from '@/features/customer-portal/paymentProofStore';
import { recordAgentActivity } from '@/lib/recoveryAgentActivity';

interface Props {
  customerId: number;
  loanId: number;
  loanNumber: string;
  amountRupees: number;
  purpose: PortalPayPurpose;
  /** Recovery card: true while a Collect submission is awaiting admin approval. */
  collectionClaimPending?: boolean;
  /** For recovery agent activity log (recovery portal only). */
  activityCustomerName?: string;
}

type PickedFile = { name: string; mime: string; dataUrl: string; sizeLabel: string };

function PaymentThankYouModal({
  open,
  onClose,
  agent,
}: {
  open: boolean;
  onClose: () => void;
  agent?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onEsc);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="payment-thank-you-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="relative z-10 w-full max-w-sm overflow-hidden rounded-card border border-slate-200/80 bg-surface shadow-glow dark:border-white/[.08]"
            initial={{ opacity: 0, scale: 0.88, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 12 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-br from-primary/15 via-violet-500/10 to-transparent" />
            <div className="relative px-6 pb-6 pt-8 text-center">
              <motion.div
                className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-primary to-violet-600 text-white shadow-[0_12px_28px_-10px_rgba(79,70,229,.55)]"
                initial={{ scale: 0, rotate: -12 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 18, delay: 0.08 }}
              >
                <CheckCircle2 size={32} strokeWidth={2.25} aria-hidden />
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.35 }}
              >
                <p id="payment-thank-you-title" className="font-display text-lg font-bold text-ink sm:text-xl">
                  Thank you!
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-muted sm:text-[14px]">
                  {agent
                    ? 'The screenshot is queued for admin review in Portal proofs.'
                    : 'Your payment will be confirmed once admin approves.'}
                </p>
                {!agent && (
                  <p className="mt-3 inline-flex items-center justify-center gap-1.5 text-[11px] font-medium text-primary">
                    <Sparkles size={12} aria-hidden />
                    We&apos;ll notify you after verification
                  </p>
                )}
              </motion.div>
              <motion.div
                className="mt-6"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.28, duration: 0.3 }}
              >
                <Button type="button" className="w-full sm:w-auto sm:min-w-[140px]" onClick={onClose}>
                  Got it
                </Button>
              </motion.div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function PaymentProofUpload({
  customerId, loanId, loanNumber, amountRupees, purpose, collectionClaimPending, activityCustomerName,
}: Props) {
  const toast = useToast();
  const authUser = useSelector((s: RootState) => s.auth.user);
  const isAgent = authUser?.role === 'RECOVERY_AGENT';
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous twin of `submitting`: state only changes on the next render,
  // so two taps inside one frame both read `false` and both upload.
  const submittingRef = useRef(false);
  const [thankYouOpen, setThankYouOpen] = useState(false);
  const [latest, setLatest] = useState<PaymentProofRecord | null>(() => getLatestPaymentProof(loanId));

  const refreshLatest = useCallback(() => {
    setLatest(getLatestPaymentProof(loanId));
  }, [loanId]);

  useEffect(() => {
    refreshLatest();
    const onSubmitted = (e: Event) => {
      const detail = (e as CustomEvent<PaymentProofRecord>).detail;
      if (!detail || detail.loanId === loanId) refreshLatest();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === PAYMENT_PROOF_STORAGE_KEY) refreshLatest();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshLatest();
    };
    window.addEventListener(PAYMENT_PROOF_SUBMITTED_EVENT, onSubmitted);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(PAYMENT_PROOF_SUBMITTED_EVENT, onSubmitted);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loanId, refreshLatest]);

  const ingestFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Please upload a screenshot (JPEG, PNG, or WebP).', 'error');
      return;
    }
    if (file.size > PAYMENT_PROOF_MAX_BYTES) {
      toast('Image must be 5 MB or smaller.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPicked({
        name: file.name,
        mime: file.type,
        dataUrl: reader.result as string,
        sizeLabel: `${(file.size / 1024).toFixed(0)} KB`,
      });
    };
    reader.onerror = () => toast('Could not read that file. Try again.', 'error');
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    if (!picked || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      // Wait for the server: only a saved upload gets the thank-you; a refusal
      // shows why and keeps the screenshot so the borrower can retry.
      const err = await submitPaymentProof({
        customerId,
        loanId,
        loanNumber,
        fileName: picked.name,
        mimeType: picked.mime,
        dataUrl: picked.dataUrl,
        amountRupees,
        purpose,
        recoveryAgentName: isAgent ? authUser?.fullName ?? null : null,
        submittedByName: authUser?.fullName ?? null,
        submittedByRole: authUser?.role ?? null,
      });
      if (err) {
        toast(`Screenshot not submitted: ${err}`, 'error');
        return;
      }
      setPicked(null);
      if (inputRef.current) inputRef.current.value = '';
      refreshLatest();
      if (isAgent && authUser && activityCustomerName) {
        recordAgentActivity({
          agentUserId: authUser.id,
          at: new Date().toISOString(),
          kind: 'PROOF_UPLOADED',
          loanId,
          loanNumber,
          customerName: activityCustomerName,
          title: 'Screenshot submitted',
          detail: 'Payment proof queued for admin review',
          amountRupees,
        });
      }
      setThankYouOpen(true);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const status = latest?.status;
  const pending = status === 'pending';
  const rejected = status === 'rejected';
  const accepted = status === 'verified';
  const recoveryAgentFlow = collectionClaimPending !== undefined;
  const awaitingNewCollect =
    recoveryAgentFlow && accepted && !collectionClaimPending;
  const canAddScreenshot = !pending && !awaitingNewCollect;

  return (
    <>
    <PaymentThankYouModal
      open={thankYouOpen}
      onClose={() => setThankYouOpen(false)}
      agent={isAgent}
    />
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.2 }}
      className={cn(
        'rounded-xl border bg-surface/90 px-3 py-2.5 shadow-soft dark:bg-surface',
        rejected
          ? 'border-rose-300/55 dark:border-rose-500/25'
          : 'border-violet-200/60 dark:border-violet-500/15',
        dragOver && 'ring-2 ring-primary/20',
      )}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!canAddScreenshot) return;
        ingestFile(e.dataTransfer.files?.[0]);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={PAYMENT_PROOF_ACCEPT}
        className="hidden"
        onChange={(e) => ingestFile(e.target.files?.[0])}
      />

      <div className="flex flex-col gap-2 xs:flex-row xs:items-center xs:gap-2.5">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-500/12 text-violet-600 dark:text-violet-300">
          <ShieldCheck size={16} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <p className="font-display text-[12px] font-bold text-ink sm:text-[13px]">Payment screenshot</p>
            {latest && pending && (
              <span className="rounded-full bg-amber-500/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                Pending review
              </span>
            )}
            {latest && rejected && (
              <span className="rounded-full bg-rose-500/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-800 dark:text-rose-200">
                Rejected
              </span>
            )}
            {latest && accepted && (
              <span className="rounded-full bg-emerald-500/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                Accepted
              </span>
            )}
          </div>
          {latest && !picked && (
            <p className="mt-0.5 text-[10px] leading-relaxed text-muted">
              {rejected ? (
                <>
                  <CircleX size={10} className="mr-0.5 inline text-danger" aria-hidden />
                  {isAgent
                    ? 'Admin could not verify this screenshot. Upload again.'
                    : 'Admin could not verify your screenshot. Please upload again.'}
                </>
              ) : pending ? (
                <>
                  <Clock size={10} className="mr-0.5 inline text-amber-600 dark:text-amber-400" aria-hidden />
                  <span className="truncate">
                    Submitted {fmtDate(latest.submittedAt.slice(0, 10))} · {inr(latest.amountRupees)} — awaiting approval
                  </span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={10} className="mr-0.5 inline text-success" aria-hidden />
                  <span className="truncate">
                    {fmtDate(latest.submittedAt.slice(0, 10))} · {inr(latest.amountRupees)} — payment confirmed
                  </span>
                </>
              )}
            </p>
          )}
          {awaitingNewCollect && !picked && (
            <p className="mt-0.5 text-[10px] leading-relaxed text-muted">
              Use <span className="font-semibold text-ink">Collect</span> for the next payment before adding another screenshot.
            </p>
          )}
        </div>
        </div>

        <AnimatePresence mode="wait">
          {!picked && canAddScreenshot ? (
            <motion.button
              key="pick"
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => inputRef.current?.click()}
              className={cn(
                'inline-flex h-10 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-[11px] font-semibold transition-colors xs:h-9 xs:w-auto',
                'border-violet-300/45 bg-violet-500/[.06] text-violet-800 hover:bg-violet-500/12',
                'dark:border-violet-500/30 dark:text-violet-200 dark:hover:bg-violet-500/15',
              )}
            >
              <ImagePlus size={14} aria-hidden />
              {rejected ? 'Upload again' : 'Add'}
            </motion.button>
          ) : !picked && awaitingNewCollect ? (
            <span
              className="inline-flex h-9 w-full shrink-0 cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-slate-200/80 px-3 text-[11px] font-semibold text-muted opacity-55 xs:w-auto dark:border-white/[.08]"
              title="Submit Collect first"
            >
              <ImagePlus size={14} aria-hidden />
              Add
            </span>
          ) : null}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {picked && (
          <motion.div
            key="preview"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2.5 flex flex-col gap-2 rounded-lg border border-slate-200/80 bg-slate-50/50 p-2 min-[400px]:flex-row min-[400px]:items-center dark:border-white/[.06] dark:bg-white/[.03]">
              <img
                src={picked.dataUrl}
                alt=""
                className="h-11 w-11 shrink-0 rounded-md object-cover ring-1 ring-slate-200/80 dark:ring-white/10"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-ink">{picked.name}</p>
                <p className="text-[10px] tabular-nums text-muted">
                  {inr(amountRupees)} · {picked.sizeLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPicked(null);
                  if (inputRef.current) inputRef.current.value = '';
                }}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-slate-200/60 hover:text-ink dark:hover:bg-white/[.06]"
                aria-label="Remove screenshot"
              >
                <X size={14} />
              </button>
              <Button
                type="button"
                className="h-8 shrink-0 px-2.5 text-[11px]"
                loading={submitting}
                onClick={submit}
              >
                <Upload size={13} />
                Submit
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
    </>
  );
}
