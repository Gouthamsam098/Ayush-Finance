import type { Loan } from '@/mock/DataContext';
import { behavesEmi, behavesInterestOnly, isInstalmentLoan } from '@/mock/DataContext';

export type PortalPayPurpose = 'INTEREST' | 'FULL_SETTLEMENT' | 'OUTSTANDING';

export interface LoanPortalSummary {
  paidTillDate: number;
  outstanding: number;
  interestPerPeriod: number | null;
  interestPeriodLabel: string | null;
  interestPending: number | null;
  principalOutstanding: number | null;
  scheduleDue: number | null;
  showInterestPay: boolean;
  fullSettlementAmount: number;
  interestPayAmount: number;
}

export interface LoanPortalContext {
  collectedFor: (loanId: number) => number;
  principalCollectedFor: (loanId: number) => number;
  outstandingFor: (loan: Loan) => number;
  totalDueForInterestOnly: (loan: Loan) => number;
  totalDueForDaily: (loan: Loan) => number;
  totalDueForMonthly: (loan: Loan) => number;
}

export function interestPeriodLabelFor(loan: Loan): string {
  if (loan.type === 'DAILY_INTEREST' || loan.type === 'DAILY_COLLECTION') return 'Per day';
  if (loan.type === 'FLEXIBLE') return `Per ${loan.numDays ?? 30}-day cycle`;
  return 'Per month';
}

export function buildLoanPortalSummary(loan: Loan, ctx: LoanPortalContext): LoanPortalSummary {
  const paidTillDate = ctx.collectedFor(loan.id);
  const outstanding = ctx.outstandingFor(loan);
  const fullSettlementAmount = Math.max(0, outstanding);

  if (behavesInterestOnly(loan)) {
    const interestPending = ctx.totalDueForInterestOnly(loan);
    const principalOutstanding = Math.max(0, loan.principal - ctx.principalCollectedFor(loan.id));
    const interestPayAmount = Math.max(0, interestPending);
    return {
      paidTillDate,
      outstanding,
      interestPerPeriod: loan.interest,
      interestPeriodLabel: interestPeriodLabelFor(loan),
      interestPending,
      principalOutstanding,
      scheduleDue: null,
      showInterestPay: loan.status === 'ACTIVE' && interestPayAmount > 0,
      fullSettlementAmount,
      interestPayAmount,
    };
  }

  let scheduleDue: number | null = null;
  if (isInstalmentLoan(loan.type)) scheduleDue = ctx.totalDueForDaily(loan);
  else if (behavesEmi(loan)) scheduleDue = ctx.totalDueForMonthly(loan);

  const principalOutstanding = isInstalmentLoan(loan.type)
    ? Math.max(0, loan.principal - paidTillDate)
    : behavesEmi(loan)
      ? Math.max(0, loan.principal + loan.interest - paidTillDate)
      : null;

  return {
    paidTillDate,
    outstanding,
    interestPerPeriod: isInstalmentLoan(loan.type) || behavesEmi(loan) ? loan.interest : null,
    interestPeriodLabel: isInstalmentLoan(loan.type) || behavesEmi(loan) ? 'Loan interest' : null,
    interestPending: null,
    principalOutstanding,
    scheduleDue: scheduleDue != null && scheduleDue > 0 ? scheduleDue : null,
    showInterestPay: false,
    fullSettlementAmount,
    interestPayAmount: 0,
  };
}

export function payPurposeTitle(purpose: PortalPayPurpose): string {
  switch (purpose) {
    case 'INTEREST':
      return 'Interest payment';
    case 'FULL_SETTLEMENT':
      return 'Full loan closure';
    default:
      return 'Outstanding payment';
  }
}

export function payPurposeSubtitle(purpose: PortalPayPurpose): string {
  switch (purpose) {
    case 'INTEREST':
      return 'Pays accrued interest due — principal remains until full closure.';
    case 'FULL_SETTLEMENT':
      return 'Principal plus all pending interest — closes the loan when recorded by your lender.';
    default:
      return 'Pays the balance currently due on your account.';
  }
}
