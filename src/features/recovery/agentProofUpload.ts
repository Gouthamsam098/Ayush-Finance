import type { PortalPayPurpose } from '@/features/customer-portal/loanPortalSummary';
import type { Loan } from '@/mock/DataContext';
import { behavesEmi, behavesInterestOnly, isDailyLoan } from '@/mock/DataContext';

/**
 * Recovery agents upload proof for a single collection (today's instalment / EMI /
 * interest due), not the full loan outstanding. Using cumulative schedule due or
 * total outstanding caused portal approvals to record a settlement-sized payment.
 */
export function agentProofUploadDefaults(
  loan: Loan,
  scheduleDue: number,
  outstanding: number,
): { amountRupees: number; purpose: PortalPayPurpose } {
  const cap = (amount: number) =>
    Math.min(Math.max(0, amount), Math.max(0, outstanding));

  if (outstanding <= 0) return { amountRupees: 0, purpose: 'CUSTOM' };

  if (isDailyLoan(loan.type)) {
    const instalment = loan.dailyAmount ?? 0;
    if (instalment > 0) return { amountRupees: cap(instalment), purpose: 'CUSTOM' };
  }

  if (behavesEmi(loan)) {
    const emi = loan.dailyAmount ?? 0;
    if (emi > 0) return { amountRupees: cap(emi), purpose: 'CUSTOM' };
  }

  if (behavesInterestOnly(loan)) {
    const interestDue = scheduleDue > 0 ? scheduleDue : (loan.dailyAmount ?? loan.interest ?? 0);
    if (interestDue > 0) return { amountRupees: cap(interestDue), purpose: 'INTEREST' };
  }

  if (scheduleDue > 0) return { amountRupees: cap(scheduleDue), purpose: 'CUSTOM' };

  return { amountRupees: cap(outstanding), purpose: 'FULL_SETTLEMENT' };
}
