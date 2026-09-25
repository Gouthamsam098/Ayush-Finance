import { motion } from 'framer-motion';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { inr } from '@/lib/format';
import { config } from '@/lib/config';
import { openUpiApp, upiAmountString } from '@/lib/upiPay';
import type { Loan } from '@/mock/DataContext';
import type { PortalPayPurpose } from '@/features/customer-portal/loanPortalSummary';
import { payPurposeSubtitle, payPurposeTitle } from '@/features/customer-portal/loanPortalSummary';
import { ArrowRight, Lock, Smartphone } from 'lucide-react';

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
      footer={<Button variant="ghost" onClick={onClose}>Cancel</Button>}
    >
      <div className="space-y-6">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0f172a] via-[#1e3a8a] to-[#4f46e5] px-6 py-7 text-center shadow-[0_20px_50px_-20px_rgba(37,99,235,.55)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,.15),transparent_50%)]" />
          <p className="relative text-[11px] font-bold uppercase tracking-[0.14em] text-white/60">{payPurposeTitle(purpose)}</p>
          <p className="relative mx-auto mt-2 max-w-sm text-[12px] leading-relaxed text-white/75">{payPurposeSubtitle(purpose)}</p>
          <p className="relative mt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">Amount</p>
          <p className="relative mt-2 font-display text-3xl font-bold tabular-nums tracking-tight text-white sm:text-[2.75rem]">
            {inr(amountRupees)}
          </p>
          <p className="relative mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-white/85">
            <Lock size={12} /> {config.merchantUpiVpa}
          </p>
          {!canPay && (
            <p className="relative mt-3 text-[12px] text-red-200">No payment due on this loan.</p>
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center gap-2">
            <Smartphone size={16} className="text-primary" />
            <p className="text-[13px] font-semibold text-ink">Choose payment app</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <motion.button
              type="button"
              disabled={!canPay}
              whileHover={canPay ? { y: -2 } : undefined}
              whileTap={canPay ? { scale: 0.98 } : undefined}
              onClick={() => pay('phonepe')}
              className="touch-target group relative flex min-h-[7.5rem] flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-[#5f259f]/30 bg-gradient-to-b from-[#5f259f]/[.12] to-[#5f259f]/[.04] p-5 text-center transition-shadow active:scale-[.99] sm:p-6 sm:hover:shadow-[0_16px_40px_-16px_rgba(95,37,159,.5)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <PhonePeIcon className="h-14 w-14 shadow-[0_8px_24px_rgba(95,37,159,.4)]" />
              <div>
                <p className="font-display text-lg font-bold text-[#5f259f] dark:text-[#d4b8f0]">PhonePe</p>
                <p className="mt-0.5 text-[12px] text-muted">Opens PhonePe with amount filled</p>
              </div>
              <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#5f259f] opacity-0 transition-opacity group-hover:opacity-100">
                Continue <ArrowRight size={14} />
              </span>
            </motion.button>

            <motion.button
              type="button"
              disabled={!canPay}
              whileHover={canPay ? { y: -2 } : undefined}
              whileTap={canPay ? { scale: 0.98 } : undefined}
              onClick={() => pay('gpay')}
              className="touch-target group relative flex min-h-[7.5rem] flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-slate-200/90 bg-surface p-5 text-center shadow-soft transition-shadow active:scale-[.99] sm:p-6 sm:hover:border-slate-300 sm:hover:shadow-[0_16px_40px_-18px_rgba(30,39,64,.2)] disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/[.1] dark:sm:hover:border-white/20"
            >
              <GooglePayIcon className="h-14 w-14" />
              <div>
                <p className="font-display text-lg font-bold text-ink">Google Pay</p>
                <p className="mt-0.5 text-[12px] text-muted">Opens GPay with amount filled</p>
              </div>
              <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100">
                Continue <ArrowRight size={14} />
              </span>
            </motion.button>
          </div>
        </div>

        <p className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 text-center text-[11px] leading-relaxed text-muted dark:border-white/[.06] dark:bg-white/[.02]">
          Amount ₹{upiAmountString(amountRupees)} will be sent to <span className="font-semibold text-ink">{config.merchantPayeeName}</span>.
          Your lender updates the ledger after they receive payment.
        </p>
      </div>
    </Dialog>
  );
}
