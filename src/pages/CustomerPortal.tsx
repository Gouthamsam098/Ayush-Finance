import { useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useData, type Loan } from '@/mock/DataContext';
import type { RootState } from '@/store';
import { logout } from '@/store/authSlice';
import { authApi } from '@/services/authApi';
import { inr, todayISO } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { LedgerDialog } from '@/components/LedgerDialog';
import { AlertCircle, Wallet } from 'lucide-react';
import { PayWithUpiDialog } from '@/features/customer-portal/components/PayWithUpiDialog';
import { CustomerProfileHero } from '@/features/customer-portal/components/CustomerProfileHero';
import { CustomerDetailsCard } from '@/features/customer-portal/components/CustomerDetailsCard';
import { CustomerLoanCard } from '@/features/customer-portal/components/CustomerLoanCard';
import { buildLoanPortalSummary, type PortalPayPurpose } from '@/features/customer-portal/loanPortalSummary';

export default function CustomerPortal() {
  const dispatch = useDispatch();
  const customerId = useSelector((s: RootState) => s.auth.user?.customerId);
  const d = useData();
  const [statementLoan, setStatementLoan] = useState<Loan | null>(null);
  const [payTarget, setPayTarget] = useState<{ loan: Loan; amountRupees: number; purpose: PortalPayPurpose } | null>(null);
  const today = todayISO();

  const customer = useMemo(
    () => (customerId != null ? d.customers.find((c) => c.id === customerId) : undefined),
    [d.customers, customerId],
  );

  const loans = useMemo(
    () => (customerId != null ? d.loans.filter((l) => l.customerId === customerId) : []),
    [d.loans, customerId],
  );

  const activeLoans = useMemo(() => loans.filter((l) => l.status === 'ACTIVE'), [loans]);

  const totalOutstanding = useMemo(
    () => activeLoans.reduce((s, l) => s + d.outstandingFor(l), 0),
    [activeLoans, d],
  );

  if (customerId == null || !customer) {
    return (
      <div className="rounded-card border border-amber-200/80 bg-amber-50/60 px-6 py-12 text-center shadow-card dark:border-amber-500/25 dark:bg-amber-500/10">
        <AlertCircle className="mx-auto mb-3 text-amber-600 dark:text-amber-400" size={28} />
        <h1 className="font-display text-lg font-bold text-ink">Portal access not configured</h1>
        <p className="mt-2 text-[13px] text-muted">
          Your account is not linked to a customer record. Ask your lender to set this up in Settings.
        </p>
        <Button
          variant="ghost"
          className="mt-6"
          onClick={() => { authApi.logout(); dispatch(logout()); }}
        >
          Sign out
        </Button>
      </div>
    );
  }

  const kycLine = [
    customer.aadhaarMasked || (customer.hasAadhaar ? 'Aadhaar on file' : null),
    customer.panMasked || (customer.hasPan ? 'PAN on file' : null),
  ].filter(Boolean).join(' · ');

  return (
    <div className="space-y-5 pb-2 sm:space-y-8 md:space-y-8">
      <CustomerProfileHero customer={customer} />

      {activeLoans.length > 0 && totalOutstanding > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-surface px-5 py-4 shadow-soft dark:border-white/[.08]">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Wallet size={20} />
            </span>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Total outstanding</p>
              <p className="font-display text-xl font-bold tabular-nums text-ink">{inr(totalOutstanding)}</p>
            </div>
          </div>
          <p className="text-[12px] text-muted">{activeLoans.length} active loan{activeLoans.length === 1 ? '' : 's'}</p>
        </div>
      )}

      <CustomerDetailsCard customer={customer} kycLine={kycLine} />

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-[17px] font-bold text-ink">Your loans</h2>
            <p className="text-[13px] text-muted">Choose interest or full closure, then pay via PhonePe or Google Pay.</p>
          </div>
        </div>

        {loans.length === 0 ? (
          <div className="rounded-card border border-dashed border-slate-200/90 bg-surface/80 px-6 py-14 text-center dark:border-white/10">
            <p className="font-medium text-ink">No loans yet</p>
            <p className="mt-1 text-[13px] text-muted">Your lender will add accounts here when a loan is booked.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:mx-auto md:max-w-2xl md:gap-5 lg:max-w-none">
            {loans.map((loan, i) => {
              const summary = buildLoanPortalSummary(loan, {
                collectedFor: d.collectedFor,
                principalCollectedFor: d.principalCollectedFor,
                outstandingFor: d.outstandingFor,
                totalDueForInterestOnly: d.totalDueForInterestOnly,
                totalDueForDaily: d.totalDueForDaily,
                totalDueForMonthly: d.totalDueForMonthly,
              });
              const nd = d.nextDueFor(loan);
              const overdue = loan.status === 'ACTIVE' && summary.outstanding > 0 && !!nd && nd < today;
              return (
                <CustomerLoanCard
                  key={loan.id}
                  customerId={customerId}
                  loan={loan}
                  summary={summary}
                  nextDue={nd}
                  overdue={overdue}
                  index={i}
                  onPay={(amountRupees, purpose) => setPayTarget({ loan, amountRupees, purpose })}
                  onStatement={() => setStatementLoan(loan)}
                />
              );
            })}
          </div>
        )}
      </section>

      {activeLoans.length > 0 && (
        <p className="text-center text-[12px] leading-relaxed text-muted">
          Payment history reflects amounts recorded by your lender. For disputes, contact your branch.
        </p>
      )}

      {statementLoan && (
        <LedgerDialog loan={statementLoan} onClose={() => setStatementLoan(null)} statementOnly />
      )}

      {payTarget && (
        <PayWithUpiDialog
          open
          onClose={() => setPayTarget(null)}
          loan={payTarget.loan}
          amountRupees={payTarget.amountRupees}
          purpose={payTarget.purpose}
        />
      )}
    </div>
  );
}
