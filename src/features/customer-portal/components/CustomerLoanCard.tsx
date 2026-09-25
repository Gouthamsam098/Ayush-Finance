import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LOAN_LABELS, behavesInterestOnly, type Loan } from '@/mock/DataContext';
import { inr, fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { LoanPortalSummary, PortalPayPurpose } from '@/features/customer-portal/loanPortalSummary';
import { CalendarClock, ChevronRight, FileText, Landmark, Sparkles, Wallet } from 'lucide-react';

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
  loan: Loan;
  summary: LoanPortalSummary;
  nextDue: string | null;
  overdue: boolean;
  index: number;
  onPay: (amountRupees: number, purpose: PortalPayPurpose) => void;
  onStatement: () => void;
}

export function CustomerLoanCard({
  loan, summary, nextDue, overdue, index, onPay, onStatement,
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
    return opts;
  }, [summary, canPay]);

  const [selected, setSelected] = useState<PortalPayPurpose>(() => payOptions[0]?.id ?? 'OUTSTANDING');

  const activeOption = payOptions.find((o) => o.id === selected) ?? payOptions[0];
  const payAmount = activeOption?.amount ?? 0;

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
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="rounded-2xl border border-emerald-500/15 bg-gradient-to-br from-emerald-500/[.06] via-surface to-violet-500/[.04] p-3.5 sm:p-4 lg:p-5 dark:from-emerald-500/10 dark:to-violet-500/5"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-500/15">
                  <Sparkles size={14} />
                </span>
                Choose payment
              </div>
              <div className="flex items-center gap-1 text-[10px] font-medium text-muted sm:text-[11px]">
                <CalendarClock size={12} className="opacity-70" />
                PhonePe · GPay
              </div>
            </div>

            <div
              className={cn(
                'grid gap-2 sm:gap-2.5',
                payOptions.length > 1 ? 'md:grid-cols-2' : 'md:max-w-xl',
              )}
            >
              {payOptions.map((opt) => {
                const active = selected === opt.id;
                return (
                  <motion.button
                    key={opt.id}
                    type="button"
                    layout
                    onClick={() => setSelected(opt.id)}
                    whileTap={{ scale: 0.99 }}
                    className={cn(
                      'relative w-full overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-all sm:px-3.5 sm:py-3 md:py-2.5',
                      'max-md:min-h-[3.25rem] md:min-h-0',
                      active
                        ? 'border-primary/35 bg-primary/[.05] shadow-[0_4px_20px_-10px_rgba(79,70,229,.4)] ring-1 ring-primary/20 dark:bg-primary/10'
                        : 'border-slate-200/90 bg-surface/90 hover:border-slate-300/90 dark:border-white/[.08] dark:hover:border-white/15',
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId={`pay-glow-${loan.id}`}
                        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[.04] to-violet-500/[.06]"
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                      />
                    )}
                    <div className="relative flex items-start justify-between gap-2 sm:items-center sm:gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-display text-[13px] font-bold leading-snug text-ink sm:text-[14px]">{opt.title}</p>
                        <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-muted sm:text-[11px]">{opt.hint}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                        <span className="font-display text-[13px] font-bold tabular-nums text-ink sm:text-[14px]">{inr(opt.amount)}</span>
                        <span
                          className={cn(
                            'grid h-4 w-4 place-items-center rounded-full border-2 transition-colors sm:h-[18px] sm:w-[18px]',
                            active ? 'border-primary bg-primary' : 'border-slate-300 dark:border-white/25',
                          )}
                        >
                          {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                        </span>
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </div>

            <div className="mt-3 border-t border-slate-200/60 pt-3 dark:border-white/[.06] sm:mt-4 sm:pt-4">
              <AnimatePresence mode="wait">
                <motion.button
                  key={activeOption?.id}
                  type="button"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -2 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => onPay(payAmount, activeOption?.id ?? 'OUTSTANDING')}
                  className={cn(
                    'group relative mx-auto flex w-full max-w-md items-center justify-center gap-2 overflow-hidden rounded-xl',
                    'bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 px-4 py-2.5',
                    'text-[13px] font-bold text-white shadow-[0_8px_24px_-12px_rgba(16,185,129,.45)]',
                    'transition-all active:scale-[.99] hover:shadow-[0_10px_26px_-10px_rgba(16,185,129,.55)]',
                    'min-h-11 md:min-h-10 md:max-w-sm',
                  )}
                >
                  <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/10 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                  <Wallet size={16} className="relative shrink-0 opacity-95" />
                  <span className="relative">Pay with UPI</span>
                  <span className="relative tabular-nums">{inr(payAmount)}</span>
                  <ChevronRight size={16} className="relative shrink-0 opacity-80" />
                </motion.button>
              </AnimatePresence>
              <p className="mt-2 text-center text-[10px] text-muted sm:text-[11px]">
                PhonePe or GPay opens with this amount pre-filled
              </p>
            </div>
          </motion.div>
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
