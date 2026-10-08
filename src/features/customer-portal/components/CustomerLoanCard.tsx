import { useMemo, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LOAN_LABELS, behavesInterestOnly, type Loan } from '@/mock/DataContext';
import { inr, fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { LoanPortalSummary, PortalPayPurpose } from '@/features/customer-portal/loanPortalSummary';
import {
  CalendarClock, ChevronRight, CircleCheck, FileText, Landmark, Percent, SlidersHorizontal, Smartphone, Wallet,
} from 'lucide-react';
import { PaymentProofUpload } from '@/features/customer-portal/components/PaymentProofUpload';

const PAY_OPTION_ICON: Record<PortalPayPurpose, ReactNode> = {
  INTEREST: <Percent size={18} strokeWidth={2.25} />,
  FULL_SETTLEMENT: <CircleCheck size={18} strokeWidth={2.25} />,
  OUTSTANDING: <Wallet size={18} strokeWidth={2.25} />,
  CUSTOM: <SlidersHorizontal size={18} strokeWidth={2.25} />,
};

function PayOptionRow({
  active,
  title,
  hint,
  amountLabel,
  icon,
  onSelect,
}: {
  active: boolean;
  title: string;
  hint: string;
  amountLabel: string;
  icon: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        'relative flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left transition-all sm:px-4 sm:py-4',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        active
          ? 'bg-primary/[.06] shadow-[inset_0_0_0_1px_rgba(79,70,229,.22)] dark:bg-primary/10'
          : 'hover:bg-slate-50/90 dark:hover:bg-white/[.04]',
      )}
    >
      <span
        className={cn(
          'grid h-11 w-11 shrink-0 place-items-center rounded-xl transition-colors',
          active
            ? 'bg-gradient-to-br from-primary to-violet-600 text-white shadow-[0_6px_16px_-6px_rgba(79,70,229,.55)]'
            : 'bg-slate-100 text-slate-600 dark:bg-white/[.06] dark:text-slate-300',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[14px] font-bold leading-snug text-ink sm:text-[15px]">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-muted sm:text-[12px]">{hint}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-2 pl-1">
        <span className="font-display text-[14px] font-bold tabular-nums text-ink sm:text-[15px]">{amountLabel}</span>
        <span
          className={cn(
            'grid h-[18px] w-[18px] place-items-center rounded-full border-2 transition-all',
            active ? 'border-primary bg-primary' : 'border-slate-300/90 dark:border-white/20',
          )}
          aria-hidden
        >
          {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
        </span>
      </span>
    </button>
  );
}

function Metric({
  label,
  value,
  sub,
  highlight,
  delay,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      className="flex min-h-[72px] flex-col justify-center rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-2.5 md:min-h-[64px] md:py-2 dark:border-white/[.06] dark:bg-white/[.03]"
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">{label}</p>
      <p className={cn('mt-1 font-display text-[15px] font-bold tabular-nums leading-tight', highlight ? 'text-danger' : 'text-ink')}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[10px] font-medium text-muted">{sub}</p>}
    </motion.div>
  );
}

interface Props {
  customerId: number;
  loan: Loan;
  summary: LoanPortalSummary;
  nextDue: string | null;
  overdue: boolean;
  index: number;
  onPay: (amountRupees: number, purpose: PortalPayPurpose) => void;
  onStatement: () => void;
}

export function CustomerLoanCard({
  customerId, loan, summary, nextDue, overdue, index, onPay, onStatement,
}: Props) {
  const canPay = loan.status === 'ACTIVE' && summary.outstanding > 0;

  const payOptions = useMemo(() => {
    const opts: { id: PortalPayPurpose; title: string; hint: string; amount: number; accent: string }[] = [];
    if (summary.showInterestPay && summary.interestPayAmount > 0) {
      opts.push({
        id: 'INTEREST',
        title: 'Pay interest due',
        hint: 'Keeps loan active · clears accrued interest',
        amount: summary.interestPayAmount,
        accent: 'from-violet-600 via-indigo-600 to-blue-600',
      });
    }
    if (summary.fullSettlementAmount > 0) {
      const sameAsInterest =
        summary.showInterestPay &&
        summary.interestPayAmount > 0 &&
        summary.fullSettlementAmount === summary.interestPayAmount;
      if (!sameAsInterest) {
        opts.push({
          id: 'FULL_SETTLEMENT',
          title: 'Close loan (full balance)',
          hint: 'Principal + all pending interest',
          amount: summary.fullSettlementAmount,
          accent: 'from-emerald-600 via-emerald-500 to-teal-500',
        });
      }
    }
    if (opts.length === 0 && canPay) {
      opts.push({
        id: 'OUTSTANDING',
        title: 'Pay outstanding',
        hint: summary.scheduleDue ? 'Or pay on your instalment schedule' : 'Balance due on account',
        amount: summary.fullSettlementAmount,
        accent: 'from-emerald-600 via-emerald-500 to-teal-500',
      });
    }
    if (canPay && summary.fullSettlementAmount > 0) {
      opts.push({
        id: 'CUSTOM',
        title: 'Custom amount',
        hint: `Enter any amount up to ${inr(summary.fullSettlementAmount)}`,
        amount: 0,
        accent: 'from-slate-600 via-slate-500 to-slate-600',
      });
    }
    return opts;
  }, [summary, canPay]);

  const [selected, setSelected] = useState<PortalPayPurpose>(() => payOptions[0]?.id ?? 'OUTSTANDING');
  const [customAmount, setCustomAmount] = useState('');

  const activeOption = payOptions.find((o) => o.id === selected) ?? payOptions[0];
  const maxPay = summary.fullSettlementAmount;
  const customParsed = Math.round(Number(customAmount.replace(/[^\d.]/g, '')) || 0);
  const payAmount = selected === 'CUSTOM' ? customParsed : (activeOption?.amount ?? 0);
  const customError = selected === 'CUSTOM' && customAmount.trim() && (customParsed <= 0 || customParsed > maxPay)
    ? (customParsed <= 0 ? 'Enter a valid amount' : `Maximum ${inr(maxPay)}`)
    : undefined;
  const payValid = payAmount > 0 && payAmount <= maxPay;

  const presetOptions = useMemo(() => payOptions.filter((o) => o.id !== 'CUSTOM'), [payOptions]);
  const hasCustomOption = payOptions.some((o) => o.id === 'CUSTOM');

  const quickAmountChips = useMemo(() => {
    const seen = new Set<number>();
    const chips: { label: string; value: number }[] = [];
    const add = (label: string, value: number) => {
      const v = Math.round(value);
      if (v > 0 && v <= maxPay && !seen.has(v)) {
        seen.add(v);
        chips.push({ label, value: v });
      }
    };
    if (summary.interestPayAmount > 0) add('Interest due', summary.interestPayAmount);
    if (summary.scheduleDue && summary.scheduleDue > 0) add('Due now', summary.scheduleDue);
    add('Full balance', maxPay);
    return chips;
  }, [summary.interestPayAmount, summary.scheduleDue, maxPay]);

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: Math.min(index, 4) * 0.07, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden rounded-card border border-slate-200/80 bg-surface shadow-card dark:border-white/[.08]"
    >
      <div className="relative overflow-hidden bg-gradient-to-r from-[#1e3a8a] via-[#4f46e5] to-[#7c3aed] px-5 py-4 sm:px-6">
        <motion.div
          className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl"
          animate={{ scale: [1, 1.08, 1], opacity: [0.5, 0.75, 0.5] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">Loan account</p>
            <p className="font-display text-xl font-bold text-white">{loan.loanNumber}</p>
            <p className="mt-0.5 text-[13px] text-white/85">{LOAN_LABELS[loan.type]}</p>
          </div>
          <span
            className={cn(
              'rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide',
              loan.status === 'CLOSED'
                ? 'bg-white/15 text-white/90'
                : overdue
                  ? 'bg-danger/90 text-white shadow-[0_4px_14px_rgba(225,29,72,.4)]'
                  : 'bg-emerald-400/25 text-emerald-50 ring-1 ring-emerald-300/40',
            )}
          >
            {loan.status === 'CLOSED' ? 'Closed' : overdue ? 'Overdue' : 'Active'}
          </span>
        </div>
      </div>

      <div className="space-y-4 p-4 sm:space-y-5 sm:p-6">
        <div className="grid grid-cols-1 gap-2.5 min-[380px]:grid-cols-2 lg:grid-cols-3">
          <Metric label="Principal" value={inr(loan.principal)} delay={0.05} />
          <Metric label="Outstanding" value={inr(summary.outstanding)} highlight={overdue} delay={0.1} />
          <Metric label="Paid till date" value={inr(summary.paidTillDate)} delay={0.15} />
          {summary.interestPerPeriod != null && (
            <Metric
              label="Interest"
              value={inr(summary.interestPerPeriod)}
              sub={summary.interestPeriodLabel ?? undefined}
              delay={0.2}
            />
          )}
          {summary.interestPending != null && (
            <Metric
              label="Interest pending"
              value={inr(summary.interestPending)}
              highlight={summary.interestPending > 0 && overdue}
              delay={0.25}
            />
          )}
          {summary.principalOutstanding != null && behavesInterestOnly(loan) && (
            <Metric label="Principal outstanding" value={inr(summary.principalOutstanding)} delay={0.28} />
          )}
          {summary.scheduleDue != null && (
            <Metric label="Schedule due now" value={inr(summary.scheduleDue)} highlight delay={0.3} />
          )}
          <Metric label="Next due" value={nextDue ? fmtDate(nextDue) : '—'} delay={0.32} />
        </div>

        {canPay && payOptions.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.4 }}
            className="overflow-hidden rounded-2xl border border-slate-200/90 bg-surface shadow-card dark:border-white/[.08]"
            aria-label="Make a payment"
          >
            <div className="border-b border-slate-200/80 bg-gradient-to-r from-primary/[.04] via-surface to-violet-500/[.05] px-4 py-4 sm:px-5 dark:border-white/[.06]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-[16px] font-bold tracking-tight text-ink sm:text-[17px]">Make a payment</h3>
                  <p className="mt-1 max-w-md text-[12px] leading-relaxed text-muted sm:text-[13px]">
                    Choose an amount. Your UPI app opens with the total pre-filled — no manual entry on our side.
                  </p>
                </div>
                <div className="flex items-center gap-1.5 rounded-full border border-slate-200/90 bg-surface/80 px-2.5 py-1 dark:border-white/[.08]">
                  <Smartphone size={12} className="text-primary" aria-hidden />
                  <span className="text-[10px] font-semibold text-muted">PhonePe</span>
                  <span className="text-muted/40" aria-hidden>·</span>
                  <span className="text-[10px] font-semibold text-muted">GPay</span>
                </div>
              </div>
            </div>

            <div className="space-y-1 p-2 sm:p-2.5" role="radiogroup" aria-label="Payment amount">
              {presetOptions.map((opt) => (
                <PayOptionRow
                  key={opt.id}
                  active={selected === opt.id}
                  title={opt.title}
                  hint={opt.hint}
                  amountLabel={inr(opt.amount)}
                  icon={PAY_OPTION_ICON[opt.id]}
                  onSelect={() => {
                    setSelected(opt.id);
                    setCustomAmount('');
                  }}
                />
              ))}

              {hasCustomOption && (
                <>
                  <PayOptionRow
                    active={selected === 'CUSTOM'}
                    title="Custom amount"
                    hint={`Any amount up to ${inr(maxPay)}`}
                    amountLabel={selected === 'CUSTOM' && customParsed > 0 ? inr(customParsed) : 'You choose'}
                    icon={PAY_OPTION_ICON.CUSTOM}
                    onSelect={() => setSelected('CUSTOM')}
                  />
                  <AnimatePresence initial={false}>
                    {selected === 'CUSTOM' && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="mx-1 mb-1 rounded-xl border border-slate-200/90 bg-slate-50/70 p-4 dark:border-white/[.08] dark:bg-white/[.03]">
                          <label className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted" htmlFor={`custom-amt-${loan.id}`}>
                            Enter amount
                          </label>
                          <div className="mt-2 flex items-baseline gap-1 border-b border-slate-200/90 pb-2 dark:border-white/[.08]">
                            <span className="font-display text-2xl font-bold text-muted">₹</span>
                            <input
                              id={`custom-amt-${loan.id}`}
                              inputMode="numeric"
                              autoComplete="off"
                              placeholder="0"
                              value={customAmount}
                              onChange={(e) => setCustomAmount(e.target.value.replace(/[^\d]/g, ''))}
                              className="min-w-0 flex-1 bg-transparent font-display text-3xl font-bold tabular-nums text-ink outline-none placeholder:text-slate-300 dark:placeholder:text-white/20"
                            />
                          </div>
                          {customError && (
                            <p className="mt-2 text-[12px] font-medium text-danger">{customError}</p>
                          )}
                          <p className="mt-1 text-[11px] text-muted">Maximum {inr(maxPay)}</p>
                          {quickAmountChips.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {quickAmountChips.map((chip) => (
                                <button
                                  key={chip.value}
                                  type="button"
                                  onClick={() => setCustomAmount(String(chip.value))}
                                  className={cn(
                                    'rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors',
                                    customParsed === chip.value
                                      ? 'border-primary/40 bg-primary/10 text-primary'
                                      : 'border-slate-200/90 bg-surface text-muted hover:border-primary/25 hover:text-ink dark:border-white/[.1]',
                                  )}
                                >
                                  {chip.label} · {inr(chip.value)}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}
            </div>

            <div className="border-t border-slate-200/80 bg-slate-50/50 px-4 py-4 dark:border-white/[.06] dark:bg-white/[.02] sm:px-5">
              <div className="mb-3 flex items-center justify-between gap-3 text-[12px]">
                <span className="font-medium text-muted">You pay</span>
                <span className="font-display text-lg font-bold tabular-nums text-ink">
                  {payValid ? inr(payAmount) : '—'}
                </span>
              </div>
              <motion.button
                type="button"
                layout
                disabled={!payValid}
                onClick={() => onPay(payAmount, selected === 'CUSTOM' ? 'CUSTOM' : (activeOption?.id ?? 'OUTSTANDING'))}
                className={cn(
                  'group relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl px-4 py-3.5',
                  'bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 text-[14px] font-bold text-white',
                  'shadow-[0_10px_28px_-12px_rgba(16,185,129,.5)] transition-all',
                  'hover:shadow-[0_14px_32px_-10px_rgba(16,185,129,.55)] active:scale-[.995]',
                  !payValid && 'cursor-not-allowed opacity-45 shadow-none hover:shadow-none',
                )}
              >
                <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/12 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                <Wallet size={18} className="relative shrink-0" />
                <span className="relative">Continue to UPI</span>
                <ChevronRight size={18} className="relative shrink-0 opacity-90" />
              </motion.button>
              <p className="mt-2.5 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted">
                <CalendarClock size={12} className="shrink-0 opacity-70" />
                Amount is copied into PhonePe or Google Pay automatically
              </p>
            </div>
          </motion.section>
        )}

        {canPay && payValid && (
          <PaymentProofUpload
            customerId={customerId}
            loanId={loan.id}
            loanNumber={loan.loanNumber}
            amountRupees={payAmount}
            purpose={selected}
          />
        )}

        <motion.button
          type="button"
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.99 }}
          onClick={onStatement}
          className="flex w-full min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200/90 bg-surface py-2.5 text-[13px] font-semibold text-ink transition-colors hover:border-primary/30 hover:bg-primary/[.04] md:mx-auto md:max-w-md md:min-h-10 dark:border-white/[.08] dark:hover:bg-white/[.03]"
        >
          <FileText size={16} className="text-primary" />
          View loan statement
          <Landmark size={14} className="text-muted opacity-60" />
        </motion.button>
      </div>
    </motion.article>
  );
}
