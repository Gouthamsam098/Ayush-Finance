import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, ImagePlus, ShieldCheck, Upload, X } from 'lucide-react';
import { inr, fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import type { PortalPayPurpose } from '@/features/customer-portal/loanPortalSummary';
import {
  getLatestPaymentProof,
  persistPaymentProof,
  PAYMENT_PROOF_ACCEPT,
  PAYMENT_PROOF_MAX_BYTES,
  PAYMENT_PROOF_SUBMITTED_EVENT,
  type PaymentProofRecord,
} from '@/features/customer-portal/paymentProofStore';

interface Props {
  customerId: number;
  loanId: number;
  loanNumber: string;
  amountRupees: number;
  purpose: PortalPayPurpose;
}

type PickedFile = { name: string; mime: string; dataUrl: string; sizeLabel: string };

export function PaymentProofUpload({
  customerId, loanId, loanNumber, amountRupees, purpose,
}: Props) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [latest, setLatest] = useState<PaymentProofRecord | null>(() => getLatestPaymentProof(loanId));

  const refreshLatest = useCallback(() => {
    setLatest(getLatestPaymentProof(loanId));
  }, [loanId]);

  useEffect(() => {
    refreshLatest();
    const onSubmitted = (e: Event) => {
      const detail = (e as CustomEvent<PaymentProofRecord>).detail;
      if (detail?.loanId === loanId) refreshLatest();
    };
    window.addEventListener(PAYMENT_PROOF_SUBMITTED_EVENT, onSubmitted);
    return () => window.removeEventListener(PAYMENT_PROOF_SUBMITTED_EVENT, onSubmitted);
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
    if (!picked || submitting) return;
    setSubmitting(true);
    try {
      persistPaymentProof({
        customerId,
        loanId,
        loanNumber,
        fileName: picked.name,
        mimeType: picked.mime,
        dataUrl: picked.dataUrl,
        amountRupees,
        purpose,
      });
      setPicked(null);
      if (inputRef.current) inputRef.current.value = '';
      toast('Payment proof submitted. Your lender will verify it shortly.', 'success');
      refreshLatest();
    } finally {
      setSubmitting(false);
    }
  };

  const pending = latest?.status === 'pending';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.2 }}
      className={cn(
        'rounded-xl border border-violet-200/60 bg-surface/90 px-3 py-2.5 shadow-soft dark:border-violet-500/15 dark:bg-surface',
        dragOver && 'ring-2 ring-primary/20',
      )}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
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

      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-500/12 text-violet-600 dark:text-violet-300">
          <ShieldCheck size={16} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <p className="font-display text-[12px] font-bold text-ink sm:text-[13px]">Payment screenshot</p>
            {pending && latest && (
              <span className="rounded-full bg-amber-500/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                Pending
              </span>
            )}
          </div>
          {latest && !picked && (
            <p className="mt-0.5 truncate text-[10px] text-muted">
              <CheckCircle2 size={10} className="mr-0.5 inline text-success" aria-hidden />
              {fmtDate(latest.submittedAt.slice(0, 10))} · {inr(latest.amountRupees)}
            </p>
          )}
        </div>

        <AnimatePresence mode="wait">
          {!picked ? (
            <motion.button
              key="pick"
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => inputRef.current?.click()}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-semibold transition-colors',
                'border-violet-300/45 bg-violet-500/[.06] text-violet-800 hover:bg-violet-500/12',
                'dark:border-violet-500/30 dark:text-violet-200 dark:hover:bg-violet-500/15',
              )}
            >
              <ImagePlus size={14} aria-hidden />
              Add
            </motion.button>
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
            <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50/50 p-2 dark:border-white/[.06] dark:bg-white/[.03]">
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
  );
}
