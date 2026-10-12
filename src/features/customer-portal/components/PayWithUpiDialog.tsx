import { useState } from 'react';
import { motion } from 'framer-motion';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { inr } from '@/lib/format';
import { config } from '@/lib/config';
import { openUpiApp, upiAmountString } from '@/lib/upiPay';
import { cn } from '@/lib/utils';
import type { Loan } from '@/mock/DataContext';
import type { PortalPayPurpose } from '@/features/customer-portal/loanPortalSummary';
import { payPurposeSubtitle, payPurposeTitle } from '@/features/customer-portal/loanPortalSummary';
import { ArrowRight, Lock, ShieldCheck, Smartphone } from 'lucide-react';

function PhonePeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 56 56" aria-hidden>
      <circle cx="28" cy="28" r="28" fill="#5F259F" />
      <path
        fill="#fff"
        d="M20 16h9.5c4.8 0 8.2 3 8.2 7.5 0 2.9-1.5 5.2-4 6.4l4.9 8.2h-5.3l-4.2-7.1H24v7.1h-4.5V16zm4.6 10.7h4.4c1.9 0 3-.9 3-2.7s-1.1-2.7-3-2.7H24.6v5.4z"
      />
    </svg>
  );
}

function GooglePayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 56 56" aria-hidden>
      <circle cx="28" cy="28" r="28" fill="currentColor" className="text-slate-100 dark:text-white/[.08]" />
      <path fill="#4285F4" d="M28 27v9.8h13.6c-.6 3.2-3.9 9.4-13.6 9.4-8.2 0-14.9-6.7-14.9-15S19.8 16.3 28 16.3c4.6 0 7.7 1.9 9.5 3.7l6.7-6.5C40.2 10 34.6 7.5 28 7.5 15.1 7.5 5 17.6 5 30.5S15.1 53.5 28 53.5c13.2 0 22-9.3 22-22.5 0-1.5-.1-2.6-.3-3.8H28z" />
      <path fill="#34A853" d="M10 35.7l5.6 4.2C18 43.6 22.5 46.2 28 46.2c6.7 0 12.3-3.6 14.4-8.7l-7.1-5.5c-1.6 4.8-6.2 8.2-11.7 8.2-4.6 0-8.5-2.4-10.8-6z" />
      <path fill="#FBBC05" d="M50.5 24.1H28v10.7h12.9c-.6 3-2.3 5.5-4.8 7.2l7.1 5.5c4.1-3.8 6.7-9.4 6.7-16.1 0-1.5-.1-2.9-.4-4.2z" />
      <path fill="#EA4335" d="M28 16.3c3.1 0 5.9 1 8 2.9l6-6C39.8 9.6 36.3 8 28 8 17.4 8 9.5 14.4 7 23.1l7.9 6.2C11.6 21.5 16.8 16.3 28 16.3z" />
    </svg>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  loan: Loan;
  amountRupees: number;
  purpose?: PortalPayPurpose;
}

export function PayWithUpiDialog({ open, onClose, loan, amountRupees, purpose = 'OUTSTANDING' }: Props) {
  const [focusApp, setFocusApp] = useState<'phonepe' | 'gpay' | null>(null);
  const note = `Loan ${loan.loanNumber} ${payPurposeTitle(purpose)}`;
  const canPay = amountRupees > 0 && loan.status === 'ACTIVE';

  const pay = (app: 'phonepe' | 'gpay') => {
    if (!canPay) return;
    openUpiApp(app, { amountRupees, note });
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
            <p className="mt-4 inline-flex max-w-full items-center gap-2 rounded-full bg-black/20 px-4 py-2 text-[12px] font-medium text-white/90 ring-1 ring-white/15 backdrop-blur-sm">
              <Lock size={13} className="shrink-0 opacity-90" />
              <span className="truncate font-mono">{config.merchantUpiVpa}</span>
            </p>
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
                    <PhonePeIcon className="h-[3.25rem] w-[3.25rem] shadow-[0_10px_28px_rgba(95,37,159,.45)]" />
                  ) : (
                    <GooglePayIcon className="h-[3.25rem] w-[3.25rem]" />
                  )}
                  <div>
                    <p className={cn('font-display text-lg font-bold', isPhonePe ? 'text-[#5f259f] dark:text-[#d4b8f0]' : 'text-ink')}>
                      {isPhonePe ? 'PhonePe' : 'Google Pay'}
                    </p>
                    <p className="mt-1 text-[12px] leading-snug text-muted">
                      {isPhonePe ? 'Opens PhonePe with amount filled' : 'Opens GPay with amount filled'}
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
          <span className="font-semibold text-ink">{config.merchantPayeeName}</span>.
          Your lender updates the ledger after payment is received.
        </p>
      </div>
    </Dialog>
  );
}
