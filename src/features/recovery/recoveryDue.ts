import type { Loan } from '@/mock/DataContext';
import { isDailyLoan, behavesInterestOnly } from '@/mock/DataContext';

type DataApi = {
  totalDueForDaily: (loan: Loan) => number;
  totalDueForMonthly: (loan: Loan) => number;
  totalDueForInterestOnly: (loan: Loan) => number;
};

/** Scheduled shortfall (instalment / interest cadence) — matches Dashboard & Collections. */
export function scheduleShortfall(d: DataApi, loan: Loan): number {
  const due = behavesInterestOnly(loan) ? d.totalDueForInterestOnly(loan)
    : isDailyLoan(loan.type) ? d.totalDueForDaily(loan)
      : d.totalDueForMonthly(loan);
  return Math.max(0, due);
}

/** @deprecated Use scheduleShortfall — kept for recovery agent cards. */
export function recoveryDueNow(d: DataApi, loan: Loan): number {
  return scheduleShortfall(d, loan);
}
