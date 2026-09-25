import type { Loan } from '@/mock/DataContext';
import { isDailyLoan, isMonthlyLike, behavesInterestOnly } from '@/mock/DataContext';

type DataApi = {
  totalDueForDaily: (loan: Loan) => number;
  totalDueForMonthly: (loan: Loan) => number;
  totalDueForInterestOnly: (loan: Loan) => number;
};

/** Scheduled shortfall — same rule as Collections / agent cards. */
export function recoveryDueNow(d: DataApi, loan: Loan): number {
  const due = isDailyLoan(loan.type) ? d.totalDueForDaily(loan)
    : isMonthlyLike(loan.type) ? d.totalDueForMonthly(loan)
      : behavesInterestOnly(loan) ? d.totalDueForInterestOnly(loan)
        : 0;
  return Math.max(0, due);
}
