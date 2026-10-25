import { useState } from 'react';
import { motion } from 'framer-motion';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { inr } from '@/lib/format';
import { openUpiApp, upiAmountString, type UpiPayCredentials } from '@/lib/upiPay';
import { cn } from '@/lib/utils';
import type { Loan } from '@/mock/DataContext';
import type { PortalPayPurpose } from '@/features/customer-portal/loanPortalSummary';
import { payPurposeSubtitle, payPurposeTitle } from '@/features/customer-portal/loanPortalSummary';
import { GooglePayLogo, PhonePeLogo } from '@/components/payment/PaymentAppIcons';
import { ArrowRight, Check, Copy, Lock, ShieldCheck, Smartphone } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  loan: Loan;
  amountRupees: number;
  purpose?: PortalPayPurpose;
  upi: UpiPayCredentials;
}

export function PayWithUpiDialog({ open, onClose, loan, amountRupees, purpose = 'OUTSTANDING', upi }: Props) {
  const toast = useToast();
  const [focusApp, setFocusApp] = useState<'phonepe' | 'gpay' | null>(null);
  const [upiCopied, setUpiCopied] = useState(false);
  const note = `Loan ${loan.loanNumber} ${payPurposeTitle(purpose)}`;
  const canPay = amountRupees > 0 && loan.status === 'ACTIVE';

  const copyUpiId = async () => {
    try {
      await navigator.clipboard.writeText(upi.payeeVpa);
      setUpiCopied(true);
      toast('UPI ID copied', 'success');
      window.setTimeout(() => setUpiCopied(false), 2000);
    } catch {
      toast('Could not copy UPI ID', 'error');
    }
  };

  const pay = (app: 'phonepe' | 'gpay') => {
    if (!canPay) return;
    openUpiApp(app, { amountRupees, note, payeeVpa: upi.payeeVpa, payeeName: upi.payeeName });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title={payPurposeTitle(purpose)}
      subtitle={`${loan.loanNumber} · Secure UPI`}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} className="w-full sm:w-auto">Cancel</Button>
        </div>
      }
    >
      <div className="space-y-7">
        <div className="relative overflow-hidden rounded-[22px] bg-gradient-to-br from-[#022999] via-[#4f46e5] to-[#a855f7] px-6 py-8 text-center shadow-[0_24px_60px_-24px_rgba(79,70,229,.65)]">
          <motion.div
            className="pointer-events-none absolute -left-12 top-0 h-40 w-40 rounded-full bg-white/15 blur-3xl"
            animate={{ opacity: [0.4, 0.7, 0.4], scale: [1, 1.08, 1] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="pointer-events-none absolute -right-8 bottom-0 h-36 w-36 rounded-full bg-fuchsia-400/25 blur-3xl"
            animate={{ opacity: [0.3, 0.55, 0.3] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
          />
          <div className="relative">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/90 ring-1 ring-white/20">
              <ShieldCheck size={12} /> {payPurposeTitle(purpose)}
            </span>
            <p className="mx-auto mt-3 max-w-sm text-[13px] leading-relaxed text-white/80">
              {payPurposeSubtitle(purpose)}
            </p>
            <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.2em] text-white/55">Amount to pay</p>
            <p className="mt-2 font-display text-[2.5rem] font-bold leading-none tabular-nums tracking-tight text-white sm:text-[3rem]">
              {inr(amountRupees)}
            </p>
            <div className="mt-4 inline-flex max-w-full items-center gap-1.5 rounded-full bg-black/20 py-2 pl-3.5 pr-2 text-[12px] font-medium text-white/90 ring-1 ring-white/15 backdrop-blur-sm">
              <Lock size={13} className="shrink-0 opacity-90" aria-hidden />
              <span className="truncate font-mono">{upi.payeeVpa}</span>
              <button
                type="button"
                onClick={() => void copyUpiId()}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/90 transition-colors hover:bg-white/15 hover:text-white"
                aria-label={upiCopied ? 'UPI ID copied' : 'Copy UPI ID'}
                title="Copy UPI ID"
              >
                {upiCopied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
              </button>
            </div>
            {!canPay && (
              <p className="mt-4 text-[13px] font-medium text-rose-200">No payment due on this loan.</p>
            )}
          </div>
        </div>

        <div>
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
                <Smartphone size={17} />
              </span>
              <div>
                <p className="font-display text-[15px] font-bold text-ink">Choose payment app</p>
                <p className="text-[12px] text-muted">Amount is pre-filled — tap to open</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            {(['phonepe', 'gpay'] as const).map((app) => {
              const isPhonePe = app === 'phonepe';
              const active = focusApp === app;
              return (
                <motion.button
                  key={app}
                  type="button"
                  disabled={!canPay}
                  onFocus={() => setFocusApp(app)}
                  onBlur={() => setFocusApp(null)}
                  whileHover={canPay ? { y: -3 } : undefined}
                  whileTap={canPay ? { scale: 0.985 } : undefined}
                  onClick={() => pay(app)}
                  className={cn(
                    'group relative flex min-h-[10.5rem] flex-col items-center justify-between gap-3 overflow-hidden rounded-[20px] border p-5 text-center transition-all sm:min-h-[11rem] sm:p-6',
                    'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25',
                    isPhonePe
                      ? 'border-[#5f259f]/35 bg-gradient-to-b from-[#5f259f]/14 via-[#5f259f]/[.06] to-surface shadow-[0_12px_32px_-16px_rgba(95,37,159,.45)]'
                      : 'border-slate-200/90 bg-gradient-to-b from-slate-50/90 to-surface dark:border-white/[.1] dark:from-white/[.04]',
                    active && isPhonePe && 'ring-2 ring-[#5f259f]/40',
                    active && !isPhonePe && 'ring-2 ring-primary/30',
                    !canPay && 'cursor-not-allowed opacity-45',
                  )}
                >
                  {isPhonePe ? (
                    <PhonePeLogo className="h-14 w-14 drop-shadow-[0_8px_20px_rgba(95,37,159,.35)]" />
                  ) : (
                    <GooglePayLogo className="h-9 w-[5.5rem] text-ink" />
                  )}
                  <div>
                    <p className={cn('font-display text-lg font-bold', isPhonePe ? 'text-[#5f259f] dark:text-[#d4b8f0]' : 'text-ink')}>
                      {isPhonePe ? 'PhonePe' : 'Google Pay'}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-bold transition-all',
                      isPhonePe
                        ? 'bg-[#5f259f] text-white shadow-[0_6px_16px_-6px_rgba(95,37,159,.55)] group-hover:shadow-[0_8px_20px_-6px_rgba(95,37,159,.6)]'
                        : 'bg-slate-900 text-white dark:bg-white dark:text-slate-900',
                      'opacity-100 sm:opacity-90 sm:group-hover:opacity-100',
                    )}
                  >
                    Continue <ArrowRight size={14} />
                  </span>
                </motion.button>
              );
            })}
          </div>
        </div>

        <p className="rounded-2xl border border-slate-200/80 bg-gradient-to-r from-slate-50/90 via-surface to-primary/[.03] px-4 py-3.5 text-center text-[11.5px] leading-relaxed text-muted dark:border-white/[.08] dark:from-white/[.03]">
          <span className="font-semibold text-ink">₹{upiAmountString(amountRupees)}</span> will be sent to{' '}
          <span className="font-semibold text-ink">{upi.payeeName}</span>.
          Your lender updates the ledger after payment is received.
        </p>
      </div>
    </Dialog>
  );
}
