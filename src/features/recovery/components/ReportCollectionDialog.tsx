import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { PayMode, Loan } from '@/mock/DataContext';
import { LOAN_LABELS } from '@/mock/DataContext';
import { todayISO, inr } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  LOAN_TYPE_UPI_CHANGED, isLoanTypeUpiSettled, readLoanTypeUpiMap, refreshLoanTypeUpi,
} from '@/lib/loanTypeUpiStore';
import { upiForLoanType, isLoanTypeUpiComplete } from '@/lib/loanTypeUpi';
import { HandCoins, Copy, Check, Lock, Smartphone, ImagePlus, Upload, X } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import {
  PAYMENT_PROOF_ACCEPT,
  PAYMENT_PROOF_MAX_BYTES,
} from '@/features/customer-portal/paymentProofStore';
import type { PaymentProofFile } from '../recoveryCollectionUi';

const MODES: PayMode[] = ['CASH', 'UPI', 'BANK', 'CHEQUE'];

export interface CollectionClaimSubmitPayload {
  amount: number;
  mode: PayMode;
  receiptDate: string;
  note: string;
  payeeVpa?: string;
  payeeName?: string;
  proofFile?: PaymentProofFile;
}

interface Props {
  open: boolean;
  onClose: () => void;
  loan: Loan;
  customerName: string;
  dueHint: number;
  variant?: 'create' | 'edit';
  initial?: {
    amount: number;
    mode: PayMode;
    receiptDate: string;
    note?: string;
    payeeVpa?: string;
    payeeName?: string;
  };
  onSubmit: (payload: CollectionClaimSubmitPayload) => Promise<string | null>;
}

export function ReportCollectionDialog({
  open,
  onClose,
  loan,
  customerName,
  dueHint,
  variant = 'create',
  initial,
  onSubmit,
}: Props) {
  const toast = useToast();
  const [amount, setAmount] = useState(dueHint > 0 ? String(dueHint) : '');
  const [mode, setMode] = useState<PayMode>('CASH');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const proofInputRef = useRef<HTMLInputElement>(null);
  const [proofFile, setProofFile] = useState<PaymentProofFile | null>(null);
  const [proofLabel, setProofLabel] = useState<string | null>(null);

  // The UPI IDs come from the server (Settings); re-read when they load or change.
  const [upiTick, setUpiTick] = useState(0);
  useEffect(() => {
    const bump = () => setUpiTick((n) => n + 1);
    window.addEventListener(LOAN_TYPE_UPI_CHANGED, bump);
    return () => window.removeEventListener(LOAN_TYPE_UPI_CHANGED, bump);
  }, []);
  useEffect(() => {
    if (open) void refreshLoanTypeUpi();
  }, [open]);

  const loanTypeUpi = useMemo(() => {
    const map = readLoanTypeUpiMap();
    if (!isLoanTypeUpiComplete(map)) return null;
    return upiForLoanType(map, loan.type);
  }, [loan.type, open, upiTick]);
  const upiLoading = useMemo(() => !isLoanTypeUpiSettled(), [open, upiTick]);

  useEffect(() => {
    if (!open) return;
    if (variant === 'edit' && initial) {
      setAmount(String(initial.amount));
      setMode(initial.mode);
      setDate(initial.receiptDate);
      setNote(initial.note ?? '');
    } else {
      setAmount(dueHint > 0 ? String(dueHint) : '');
      setMode('CASH');
      setDate(todayISO());
      setNote('');
    }
    setError(null);
    setCopied(false);
    setProofFile(null);
    setProofLabel(null);
    if (proofInputRef.current) proofInputRef.current.value = '';
  }, [open, variant, initial, dueHint]);

  const upiReady = mode === 'UPI' && loanTypeUpi != null;
  const upiPending = mode === 'UPI' && !loanTypeUpi && upiLoading;
  const upiBlocked = mode === 'UPI' && !loanTypeUpi && !upiLoading;
  const upiProofRequired = variant === 'create' && mode === 'UPI' && upiReady;
  const upiProofMissing = upiProofRequired && !proofFile;

  const ingestProof = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please upload a screenshot (JPEG, PNG, or WebP).');
      return;
    }
    if (file.size > PAYMENT_PROOF_MAX_BYTES) {
      setError('Image must be 5 MB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setProofFile({
        fileName: file.name,
        mimeType: file.type,
        dataUrl: reader.result as string,
      });
      setProofLabel(`${file.name} · ${(file.size / 1024).toFixed(0)} KB`);
      setError(null);
    };
    reader.onerror = () => setError('Could not read that file. Try again.');
    reader.readAsDataURL(file);
  };

  const copyUpi = async () => {
    if (!loanTypeUpi) return;
    try {
      await navigator.clipboard.writeText(loanTypeUpi.payeeVpa);
      setCopied(true);
      toast('UPI ID copied', 'success');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Could not copy UPI ID', 'error');
    }
  };

  const save = async () => {
    const n = Number(amount);
    if (!n || n <= 0) { setError('Enter a valid amount'); return; }
    if (mode === 'UPI') {
      if (!loanTypeUpi) {
        setError('UPI is not configured for this loan type. Ask admin to complete Settings → Customer portal · UPI IDs.');
        return;
      }
      if (variant === 'create' && !proofFile) {
        setError('Attach a payment screenshot for UPI collections.');
        return;
      }
    }
    setLoading(true);
    setError(null);
    const payload: CollectionClaimSubmitPayload = {
      amount: n,
      mode,
      receiptDate: date,
      note: note.trim(),
      ...(mode === 'UPI' && loanTypeUpi
        ? { payeeVpa: loanTypeUpi.payeeVpa, payeeName: loanTypeUpi.payeeName }
        : {}),
      ...(variant === 'create' && mode === 'UPI' && proofFile ? { proofFile } : {}),
    };
    const err = await onSubmit(payload);
    setLoading(false);
    if (err) { setError(err); return; }
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={variant === 'edit' ? 'Edit pending submission' : 'Customer paid'}
      subtitle={`${customerName} · ${loan.loanNumber}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={loading} disabled={upiBlocked || upiPending || upiProofMissing}>
            <HandCoins size={15} />
            {loading && variant === 'create' && mode === 'UPI'
              ? 'Submitting collection & screenshot…'
              : variant === 'edit'
                ? 'Save changes'
                : 'Submit for approval'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-xl border border-amber-200/80 bg-amber-50/80 px-4 py-3 text-[13px] leading-relaxed text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100">
          {variant === 'edit'
            ? 'Update the amount or receipt details while admin approval is still pending.'
            : <>Amount is recorded only after an <strong>admin approves</strong> this submission. The ledger updates on approval.</>}
        </p>
        {dueHint > 0 && (
          <p className="text-[13px] text-muted">Due now: <span className="font-semibold text-danger">{inr(dueHint)}</span></p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Amount collected *" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Select label="Mode" value={mode} onChange={(e) => setMode(e.target.value as PayMode)} options={MODES.map((m) => ({ value: m, label: m }))} />
          <Input label="Receipt date *" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="sm:col-span-2 sm:max-w-xs" />
        </div>

        <AnimatePresence mode="wait">
          {mode === 'UPI' && (
            <motion.div
              key="upi-panel"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className={cn(
                'overflow-hidden rounded-2xl border shadow-soft',
                upiReady
                  ? 'border-violet-300/50 bg-gradient-to-br from-[#5f259f]/12 via-surface to-violet-500/[.06] dark:border-violet-500/25'
                  : 'border-warning/40 bg-warning/[.06]',
              )}
            >
              {upiPending ? (
                <p className="flex items-center gap-2 p-4 text-[12px] text-muted">
                  <Smartphone size={16} className="shrink-0 animate-pulse" aria-hidden />
                  Loading the UPI ID for {LOAN_LABELS[loan.type]}…
                </p>
              ) : upiBlocked ? (
                <div className="flex gap-3 p-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-warning/15 text-warning">
                    <Smartphone size={20} />
                  </span>
                  <div>
                    <p className="font-display text-[14px] font-bold text-ink">UPI not configured</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-muted">
                      Admin must set a valid UPI ID and payee name for <strong>{LOAN_LABELS[loan.type]}</strong> under Settings → Customer portal · UPI IDs before you can submit a UPI collection.
                    </p>
                  </div>
                </div>
              ) : loanTypeUpi && (
                <div className="p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#5f259f]/15 text-[#5f259f] dark:text-violet-300">
                      <Smartphone size={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Collect via UPI</p>
                      <p className="mt-0.5 font-display text-[14px] font-bold text-ink">
                        {LOAN_LABELS[loan.type]}
                      </p>
                      <p className="mt-1 text-[12px] text-muted">
                        Customer pays to this ID. Admin approves the amount in Recovery queue; attach the screenshot below for verification.
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 rounded-xl bg-gradient-to-r from-[#5f259f] to-violet-600 px-4 py-4 text-white shadow-[0_12px_28px_-14px_rgba(95,37,159,.55)]">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-white/75">Amount to collect</p>
                    <p className="mt-1 font-display text-2xl font-bold tabular-nums">{inr(Number(amount) || 0)}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-black/20 py-1.5 pl-3 pr-1.5 text-[12px] font-medium ring-1 ring-white/15">
                        <Lock size={12} className="shrink-0 opacity-90" aria-hidden />
                        <span className="truncate font-mono">{loanTypeUpi.payeeVpa}</span>
                        <button
                          type="button"
                          onClick={() => void copyUpi()}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors hover:bg-white/15"
                          aria-label="Copy UPI ID"
                        >
                          {copied ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] text-white/80">
                      Payee: <span className="font-semibold text-white">{loanTypeUpi.payeeName}</span>
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {upiProofRequired && (
          <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4 dark:border-white/[.08] dark:bg-white/[.03]">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">Payment screenshot *</p>
            <p className="mt-1 text-[12px] text-muted">Required for UPI. Attached to this collection — the admin checks it when approving.</p>
            <input
              ref={proofInputRef}
              type="file"
              accept={PAYMENT_PROOF_ACCEPT}
              className="sr-only"
              onChange={(e) => ingestProof(e.target.files?.[0])}
            />
            {proofFile ? (
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                <img
                  src={proofFile.dataUrl}
                  alt=""
                  className="h-24 w-full max-w-[140px] rounded-xl border border-slate-200/80 object-cover dark:border-white/[.08]"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-ink">{proofLabel}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setProofFile(null);
                      setProofLabel(null);
                      if (proofInputRef.current) proofInputRef.current.value = '';
                    }}
                    className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-danger hover:underline"
                  >
                    <X size={14} /> Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => proofInputRef.current?.click()}
                className="mt-3 flex w-full min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-primary/35 bg-primary/[.04] px-4 py-4 text-[13px] font-semibold text-primary transition-colors hover:bg-primary/[.08]"
              >
                <ImagePlus size={22} aria-hidden />
                <span className="inline-flex items-center gap-1.5">
                  <Upload size={14} aria-hidden /> Choose screenshot
                </span>
              </button>
            )}
          </div>
        )}

        <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Paid at shop, partial…" />
        {error && <p className="text-[13px] font-medium text-danger" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
