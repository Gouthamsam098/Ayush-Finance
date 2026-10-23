import type { Loan } from '@/mock/DataContext';
import { behavesEmi } from '@/mock/DataContext';
import type { LoanPortalSummary, PortalPayPurpose } from '@/features/customer-portal/loanPortalSummary';

/** Customer portal screenshot upload — not offered on daily collection or monthly-interest products. */
export function customerPortalPaymentProofEnabled(loan: Loan): boolean {
  return loan.type !== 'DAILY_COLLECTION' && loan.type !== 'MONTHLY_INTEREST';
}

export function resolveCustomerPortalProof(
  loan: Loan,
  summary: LoanPortalSummary,
  payValid: boolean,
  payAmount: number,
  selected: PortalPayPurpose,
  activeOptionId: PortalPayPurpose | undefined,
): { amountRupees: number; purpose: PortalPayPurpose } | null {
  const purposeWhenValid: PortalPayPurpose =
    selected === 'CUSTOM' ? 'CUSTOM' : (activeOptionId ?? 'OUTSTANDING');

  let fallback = 0;
  if (summary.scheduleDue != null && summary.scheduleDue > 0) {
    fallback = summary.scheduleDue;
  } else if (summary.interestPayAmount > 0) {
    fallback = summary.interestPayAmount;
  } else if (behavesEmi(loan) && (loan.dailyAmount ?? 0) > 0) {
    fallback = loan.dailyAmount!;
  }

  const amountRupees = payValid ? payAmount : fallback;
  if (amountRupees <= 0) return null;

  if (payValid) {
    return { amountRupees, purpose: purposeWhenValid };
  }
  if (summary.interestPayAmount > 0 && fallback === summary.interestPayAmount) {
    return { amountRupees, purpose: 'INTEREST' };
  }
  return { amountRupees, purpose: 'CUSTOM' };
}
