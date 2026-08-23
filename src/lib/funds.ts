/**
 * Available funds — the single source of truth for "how much can we lend".
 *
 * Shared by the Dashboard (the Available Funds KPI) and Loans (the funding
 * guard on loan creation) so the number a user sees and the number that blocks
 * a loan can never disagree.
 *
 *     available = investor capital
 *               − outstanding        (cash currently out with borrowers)
 *               + net profit         (interest earned − all expenses)
 *
 * Every rupee is counted once: `outstanding` falls as borrowers repay, which
 * returns the PRINCIPAL to the pot, while `net profit` adds the interest those
 * repayments earned and subtracts everything the business spent (including the
 * investor-interest payouts the Investments page posts to Expenses).
 *
 * Anchoring on capital − outstanding (rather than summing lifetime collections
 * and disbursals) keeps the figure bounded and self-correcting: it cannot drift
 * upward from historical volume, so it degrades sanely if the data is ever
 * inconsistent.
 */

import { behavesInterestOnly, type Collection, type Expense, type Loan } from '@/mock/DataContext';
import { activeInvestorCapital } from '@/lib/investments';
import { config } from '@/lib/config';

/**
 * Lifetime interest realised, per collection — the SAME recognition rules as
 * Dashboard.profitByCollectionId (kept here so the funds figure and the Profit
 * KPI can never diverge):
 *   • interest-only behaviour → every non-PRINCIPAL payment is interest;
 *   • upfront/EMI → profit-last: the band (disbursed, disbursed + margin].
 */
/** Interest realised on ONE loan, with the context needed to explain it. */
export interface LoanProfitRow {
  loan: Loan;
  collected: number;   // total received on this loan
  interest: number;    // the profit portion realised so far
  margin: number;      // the most this loan can ever yield
  disbursed: number;   // cash handed out
}

/** Per-loan profit breakdown — the same recognition rules as interestRealised,
 *  but itemised so the UI can show WHERE the profit came from. Loans that have
 *  yielded nothing yet are included with interest 0, so the list is complete
 *  rather than silently hiding them. */
export function profitByLoan(loans: Loan[], collections: Collection[]): LoanProfitRow[] {
  const byLoan = new Map<number, Collection[]>();
  for (const c of collections) {
    const arr = byLoan.get(c.loanId) ?? [];
    arr.push(c);
    byLoan.set(c.loanId, arr);
  }
  const out: LoanProfitRow[] = [];
  for (const loan of loans) {
    const colls = byLoan.get(loan.id) ?? [];
    const ordered = [...colls].sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
    const disbursed = loan.disbursed ?? Math.max(0, loan.principal - (loan.deduction ?? 0));
    // Interest-only loans are open-ended, so there is no finite margin. Report
    // 0 rather than Infinity: the interest-only branch below never reads
    // `margin`, and an Infinity escaping onto a rendered figure would print
    // "₹∞". (It is a live trap for any future caller, so it is not stored.)
    const margin = behavesInterestOnly(loan)
      ? 0
      : (loan.deduction ?? 0) > 0 ? (loan.deduction ?? 0) : loan.interest;
    let collected = 0;
    let interest = 0;
    if (behavesInterestOnly(loan)) {
      for (const c of ordered) {
        collected += c.amount;
        if (c.kind !== 'PRINCIPAL') interest += c.amount;
      }
    } else {
      let cum = 0;
      for (const c of ordered) {
        const before = cum;
        cum += c.amount;
        collected = cum;
        interest += Math.max(0, Math.min(cum, disbursed + margin) - Math.max(before, disbursed));
      }
    }
    out.push({ loan, collected, interest, margin, disbursed });
  }
  // Biggest earners first — that is what a reader wants to see.
  return out.sort((a, b) => b.interest - a.interest);
}

export function interestRealised(loans: Loan[], collections: Collection[]): number {
  const loanById = new Map(loans.map((l) => [l.id, l] as const));
  const byLoan = new Map<number, Collection[]>();
  for (const c of collections) {
    const arr = byLoan.get(c.loanId) ?? [];
    arr.push(c);
    byLoan.set(c.loanId, arr);
  }
  let total = 0;
  for (const [loanId, colls] of byLoan) {
    const loan = loanById.get(loanId);
    if (!loan) continue;
    const ordered = [...colls].sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
    if (behavesInterestOnly(loan)) {
      for (const c of ordered) if (c.kind !== 'PRINCIPAL') total += c.amount;
    } else {
      const disbursed = loan.disbursed ?? Math.max(0, loan.principal - (loan.deduction ?? 0));
      const margin = (loan.deduction ?? 0) > 0 ? (loan.deduction ?? 0) : loan.interest;
      let cum = 0;
      for (const c of ordered) {
        const before = cum;
        cum += c.amount;
        total += Math.max(0, Math.min(cum, disbursed + margin) - Math.max(before, disbursed));
      }
    }
  }
  return total;
}

export interface FundsBreakdown {
  /** Active investor capital raised. */
  capital: number;
  /** Cash still out with borrowers = disbursed − collected, never below 0.
   *  This is CASH, not the gross receivable (which includes unearned interest). */
  outstanding: number;
  /** Interest realised to date (profit recognition — never principal). */
  interestEarned: number;
  /** Total cash spent (all expense categories, incl. investor interest). */
  expenses: number;
  /** interestEarned − expenses. Negative when costs exceed interest. */
  netProfit: number;
  /** Cash on hand, floored at 0 for display. */
  available: number;
  /** Raw (unfloored) figure — negative means the business is overdrawn. */
  rawAvailable: number;
  /** The lending guard is ALWAYS on: a loan can only be funded from available
   *  funds, so ₹0 available means no lending. Kept as a field (rather than
   *  removed) so existing call sites keep compiling. */
  enforced: boolean;
}

/** Cash actually handed to a borrower. Daily Collection retains the interest
 *  upfront, so the cash out is `disbursed`, NOT the principal. Falls back to
 *  the derivation when the server value is absent (mock loans). */
export const cashDisbursedFor = (l: Loan): number =>
  l.disbursed ?? Math.max(0, l.principal - (l.deduction ?? 0));

/**
 * Cash available to lend.
 *
 *     available = capital + collected − disbursed − expenses
 *
 * CASH BASIS, and it must stay that way. The previous form was
 * `capital − loanOutstanding + netProfit`, which was wrong in two ways because
 * `outstandingFor()` is a gross RECEIVABLE, not cash:
 *
 *  1. For upfront/EMI loans the receivable includes interest not yet earned, so
 *     the margin was deducted immediately but only credited back (via
 *     profit-last recognition) on the final instalment. A ₹1L Vehicle EMI at 12%
 *     made available funds read −₹12,000 the moment it was disbursed — the
 *     business appeared overdrawn by its own profit.
 *  2. For interest-only loans the receivable GROWS with accrued unpaid interest,
 *     so one defaulting borrower drove available funds ever more negative while
 *     no cash had moved, freezing all further lending.
 *
 * Counting actual cash movements avoids both: every rupee is counted once, when
 * it moves. Interest earned still raises capacity (it arrives inside
 * `collected`) and every expense lowers it.
 */
export function computeFunds(
  loans: Loan[],
  expenses: Expense[],
  /** Lifetime interest realised — reported for display; the cash figure does
   *  not need it, since collections already include the interest received. */
  interestEarned: number,
  /** Total collected across ALL loans (cash received from borrowers). */
  collected: number,
): FundsBreakdown {
  // API mode reads the cached server figure; mock mode reads the local
  // register. See activeInvestorCapital for why the cache exists.
  const capital = activeInvestorCapital(config.useApi);
  const spent = expenses.reduce((s, e) => s + e.amount, 0);
  // EVERY loan ever made consumed cash — closed ones included, since their
  // repayments are inside `collected`. Counting only active loans would credit
  // a closed loan's repayments without ever debiting its disbursal.
  const disbursed = loans.reduce((s, l) => s + cashDisbursedFor(l), 0);
  // Cash still out with borrowers, for display. Floored at 0: once a loan has
  // repaid more than was disbursed the surplus is profit, not negative cash.
  const cashOut = Math.max(0, disbursed - collected);
  const netProfit = interestEarned - spent;
  const rawAvailable = capital + collected - disbursed - spent;
  return {
    capital,
    outstanding: cashOut,
    interestEarned,
    expenses: spent,
    netProfit,
    rawAvailable,
    available: Math.max(0, rawAvailable),
    // ALWAYS enforced. This used to be `capital > 0`, which switched the guard
    // OFF when no investor existed — so a loan could be created against ₹0 of
    // funds. Lending capacity is available funds, full stop.
    enforced: true,
  };
}
