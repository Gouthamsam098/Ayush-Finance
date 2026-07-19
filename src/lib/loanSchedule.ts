import type { Loan } from '@/mock/DataContext';
import { isDailyLoan, isInstalmentLoan, isEmiLoan } from '@/mock/DataContext';
import { addDays, isoLocal } from '@/lib/format';

/** One row of a Bajaj-style repayment schedule. */
export interface ScheduleRow {
  sn: number;
  dueDate: string;        // YYYY-MM-DD
  opening: number;        // principal outstanding at the start of this instalment
  instalment: number;     // amount due this instalment
  principal: number;      // portion applied to principal (flat model: whole instalment)
  interest: number;       // portion applied to interest (flat model: 0 — taken upfront)
  closing: number;        // principal outstanding after this instalment
  settled?: boolean;      // TRUE on the single foreclosure/settlement row
}

/** Foreclosure context: when a CLOSED loan was settled early, the schedule
 *  collapses Bajaj-style — regular rows up to the last fully-funded instalment,
 *  then ONE final row on the settlement date carrying the exact payoff amount
 *  (closing → 0), and nothing after. */
export interface ScheduleOpts {
  collected?: number;                                  // total collected on the loan
  settlement?: { amount: number; date: string } | null; // the final (payoff) payment
}

/** Header facts for the statement (mirrors the Bajaj "Payment Schedule" block). */
export interface ScheduleMeta {
  loanNumber: string;
  loanTypeLabel: string;
  customerName: string;
  customerMobile: string;
  loanDate: string;         // YYYY-MM-DD
  frequency: string;        // "Daily" | "Monthly EMIs"
  tenure: number;           // number of instalments
  rate: number;             // annual-equivalent %
  principal: number;
  interest: number;         // upfront interest
  deduction: number;        // = interest for instalment loans
  netDisbursed: number;
  instalmentAmount: number; // per-instalment amount
}

/** Add n cadence steps (days for daily loans, 30-day months for monthly) to a date. */
const stepDate = (iso: string, steps: number, stepDays: number) => addDays(iso, steps * stepDays);

/**
 * Build a repayment schedule.
 *  • Daily Collection: interest deducted upfront (header), each instalment repays
 *    principal only; interest column is 0.
 *  • EMI (Vehicle/Property): full principal + flat interest. Each EMI splits into
 *    an even interest share (totalInterest ÷ months) and a principal share
 *    (EMI − interest). Opening/closing track the PRINCIPAL remaining.
 */
export function buildSchedule(loan: Loan, opts?: ScheduleOpts): ScheduleRow[] {
  const term = loan.numDays ?? 0;
  const instalment = loan.dailyAmount ?? 0;
  if (term <= 0 || instalment <= 0) return [];

  // Foreclosure collapse (Bajaj-style): a CLOSED loan settled by a final payoff
  // shows its regular rows only up to the last instalment fully funded BEFORE
  // the settlement, then a single settlement row (exact payoff, closing 0).
  // settleAt = 0-based index of the settlement row; term when no collapse.
  const collected = opts?.collected ?? 0;
  const settlement = loan.status === 'CLOSED' && opts?.settlement && collected > 0 ? opts.settlement : null;
  const fundedBefore = settlement
    ? Math.max(0, Math.floor((collected - settlement.amount) / instalment))
    : term;
  const settleAt = settlement && fundedBefore < term ? fundedBefore : term;

  // ── EMI loans ──
  if (isEmiLoan(loan.type)) {
    const perInterest = Math.round(loan.interest / term);
    const rows: ScheduleRow[] = [];
    let openPrincipal = loan.principal;
    let intLeft = loan.interest;
    for (let i = 0; i < term; i++) {
      // Settlement row: everything still owed, paid in one shot on the payoff
      // date. Interest column carries the whole remaining (flat) interest.
      if (settlement && i === settleAt) {
        const amount = Math.max(0, collected - i * instalment);
        rows.push({
          sn: i + 1, dueDate: settlement.date, opening: openPrincipal,
          instalment: amount, principal: amount - intLeft, interest: intLeft,
          closing: 0, settled: true,
        });
        return rows;
      }
      const last = i === term - 1;
      // Last row absorbs rounding so totals reconcile exactly.
      const intPortion = last ? intLeft : perInterest;
      const emi = last ? openPrincipal + intPortion : instalment;
      const prinPortion = emi - intPortion;
      const closing = Math.max(0, openPrincipal - prinPortion);
      rows.push({
        sn: i + 1,
        dueDate: stepDate(loan.loanDate, i + 1, 30),
        opening: openPrincipal,
        instalment: emi,
        principal: prinPortion,
        interest: intPortion,
        closing,
      });
      openPrincipal = closing;
      intLeft -= intPortion;
    }
    return rows;
  }

  // ── Daily Collection (upfront interest) ──
  if (!isInstalmentLoan(loan.type)) return [];
  const stepDays = isDailyLoan(loan.type) ? 1 : 30;
  const rows: ScheduleRow[] = [];
  let opening = loan.principal;
  for (let i = 0; i < term; i++) {
    // Settlement row: the remaining principal cleared in one payoff.
    if (settlement && i === settleAt) {
      const amount = Math.max(0, collected - i * instalment);
      rows.push({
        sn: i + 1, dueDate: settlement.date, opening,
        instalment: amount, principal: amount, interest: 0,
        closing: 0, settled: true,
      });
      return rows;
    }
    const pay = Math.min(instalment, opening);
    const closing = Math.max(0, opening - pay);
    rows.push({
      sn: i + 1,
      dueDate: stepDate(loan.loanDate, i + 1, stepDays),
      opening,
      instalment: pay,
      principal: pay,   // flat model — the whole instalment repays principal
      interest: 0,      // interest was deducted upfront (see header)
      closing,
    });
    opening = closing;
    if (opening <= 0) break;
  }
  return rows;
}

/** Which instalments have actually been collected (by cumulative amount). */
export function collectedInstalments(loan: Loan, collectedTotal: number): number {
  const instalment = loan.dailyAmount ?? 0;
  return instalment > 0 ? Math.floor(collectedTotal / instalment) : 0;
}

// isoLocal re-exported for callers that build dates alongside a schedule.
export { isoLocal };
