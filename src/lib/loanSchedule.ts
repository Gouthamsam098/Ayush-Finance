import type { Loan } from '@/mock/DataContext';
import {
  isInstalmentLoan, behavesEmi, behavesInterestOnly, cadenceDaysForLoan,
} from '@/mock/DataContext';
import { addDays, addMonths, isoLocal, todayISO } from '@/lib/format';

/** One row of a Bajaj-style repayment schedule. */
export interface ScheduleRow {
  sn: number;
  dueDate: string;        // YYYY-MM-DD
  opening: number;        // principal outstanding at the start of this instalment
  instalment: number;     // amount due this instalment
  principal: number;     // portion applied to principal (flat model: whole instalment)
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
 *  • EMI (Vehicle/Property tenure): full principal + flat interest. Each EMI splits
 *    into interest + principal shares.
 *  • Interest-only / Flexible: same table shape as Daily Collection; each row is an
 *    interest period (principal column 0, interest = period due).
 */
export function buildSchedule(loan: Loan, opts?: ScheduleOpts): ScheduleRow[] {
  const term = loan.numDays ?? 0;
  const instalment = loan.dailyAmount ?? 0;

  const collected = opts?.collected ?? 0;
  const settlement = loan.status === 'CLOSED' && opts?.settlement && collected > 0 ? opts.settlement : null;

  // ── EMI loans (Vehicle/Property in tenure mode only) ──
  if (behavesEmi(loan)) {
    if (term <= 0 || instalment <= 0) return [];
    const fundedBefore = settlement
      ? Math.max(0, Math.floor((collected - settlement.amount) / instalment))
      : term;
    const stepDays = 30;
    const elapsedBySettle = settlement
      ? Math.min(
          Math.floor(
            (new Date(settlement.date + 'T00:00:00').getTime() -
             new Date(loan.loanDate + 'T00:00:00').getTime()) / (86400000 * stepDays)
          ),
          term,
        )
      : 0;
    const settleAt = settlement && fundedBefore < term
      ? Math.max(fundedBefore, elapsedBySettle)
      : term;

    const perInterest = Math.round(loan.interest / term);
    const rows: ScheduleRow[] = [];
    let openPrincipal = loan.principal;
    let intLeft = loan.interest;
    for (let i = 0; i < term; i++) {
      if (settlement && i === settleAt && settleAt < term) {
        const amount = Math.max(0, collected - i * instalment);
        rows.push({
          sn: i + 1, dueDate: settlement.date, opening: openPrincipal,
          instalment: amount, principal: amount - intLeft, interest: intLeft,
          closing: 0, settled: true,
        });
        return rows;
      }
      const last = i === term - 1;
      const intPortion = last ? intLeft : perInterest;
      const emi = last ? openPrincipal + intPortion : instalment;
      const prinPortion = emi - intPortion;
      const closing = Math.max(0, openPrincipal - prinPortion);
      rows.push({
        sn: i + 1,
        dueDate: addMonths(loan.loanDate, i + 1, 0),
        opening: openPrincipal,
        instalment: emi,
        principal: prinPortion,
        interest: intPortion,
        closing,
      });
      openPrincipal = closing;
      intLeft -= intPortion;
    }
    if (settlement && fundedBefore < term) {
      const amount = Math.max(0, collected - fundedBefore * instalment);
      rows.push({
        sn: rows.length + 1, dueDate: settlement.date, opening: 0,
        instalment: amount, principal: amount, interest: 0,
        closing: 0, settled: true,
      });
    }
    return rows;
  }

  // ── Daily Collection (upfront interest) ──
  if (isInstalmentLoan(loan.type)) {
    if (term <= 0 || instalment <= 0) return [];
    const fundedBefore = settlement
      ? Math.max(0, Math.floor((collected - settlement.amount) / instalment))
      : term;
    const stepDays = 1;
    const elapsedBySettle = settlement
      ? Math.min(
          Math.floor(
            (new Date(settlement.date + 'T00:00:00').getTime() -
             new Date(loan.loanDate + 'T00:00:00').getTime()) / (86400000 * stepDays)
          ),
          term,
        )
      : 0;
    const settleAt = settlement && fundedBefore < term
      ? Math.max(fundedBefore, elapsedBySettle)
      : term;

    const rows: ScheduleRow[] = [];
    let opening = loan.principal;
    for (let i = 0; i < term; i++) {
      if (settlement && i === settleAt && settleAt < term) {
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
        principal: pay,
        interest: 0,
        closing,
      });
      opening = closing;
      if (opening <= 0) break;
    }
    if (settlement && fundedBefore < term) {
      const amount = Math.max(0, collected - fundedBefore * instalment);
      rows.push({
        sn: rows.length + 1, dueDate: settlement.date, opening: 0,
        instalment: amount, principal: amount, interest: 0,
        closing: 0, settled: true,
      });
    }
    return rows;
  }

  // ── Interest-only / Flexible — same columns as Daily Collection statement ──
  if (behavesInterestOnly(loan)) {
    if (instalment <= 0) return [];
    const step = cadenceDaysForLoan(loan);
    const flexSameDay = loan.type === 'FLEXIBLE';
    const monthlyCadence = loan.type === 'MONTHLY_INTEREST'
      || (loan.type !== 'DAILY_INTEREST' && loan.type !== 'FLEXIBLE' && step >= 30);

    const [ly, lm, ld] = loan.loanDate.split('-').map(Number);
    const [ty, tm, td] = todayISO().split('-').map(Number);
    const start = new Date(ly, lm - 1, ld);
    const todayD = new Date(ty, tm - 1, td);
    const daysSince = Math.max(0, Math.round((todayD.getTime() - start.getTime()) / 86400000));
    const elapsed = Math.floor(daysSince / step) + (flexSameDay ? 1 : 0);
    const paidSlots = Math.floor(collected / instalment);
    const upcoming = loan.status === 'CLOSED' ? 0 : 1;
    // Mirror ledger window: elapsed (and paid-ahead) + one upcoming next due.
    let count = Math.max(elapsed, paidSlots) + upcoming;
    if (loan.status === 'CLOSED') count = Math.max(elapsed, paidSlots, 1);
    // Flexible is typically a single custom cycle — never invent dozens of rows.
    if (flexSameDay) count = Math.min(Math.max(count, 1), Math.max(1, paidSlots + upcoming));
    count = Math.max(1, count);

    const rows: ScheduleRow[] = [];
    const principal = loan.principal;
    for (let k = 1; k <= count; k++) {
      const dueOffsetDays = flexSameDay ? (k - 1) * step : k * step;
      const dueDate = monthlyCadence && !flexSameDay
        ? addMonths(loan.loanDate, k, 0)
        : isoLocal(new Date(ly, lm - 1, ld + dueOffsetDays));
      rows.push({
        sn: k,
        dueDate,
        opening: principal,
        instalment,
        principal: 0,
        interest: instalment,
        closing: principal,
      });
    }

    // Settlement payoff row (principal cleared) — same visual cue as Daily Collection.
    if (settlement) {
      rows.push({
        sn: rows.length + 1,
        dueDate: settlement.date,
        opening: principal,
        instalment: settlement.amount,
        principal: settlement.amount,
        interest: 0,
        closing: 0,
        settled: true,
      });
    }
    return rows;
  }

  return [];
}

/** Which instalments have actually been collected (by cumulative amount). */
export function collectedInstalments(loan: Loan, collectedTotal: number): number {
  const instalment = loan.dailyAmount ?? 0;
  return instalment > 0 ? Math.floor(collectedTotal / instalment) : 0;
}

// isoLocal re-exported for callers that build dates alongside a schedule.
export { isoLocal };
