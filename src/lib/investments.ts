/**
 * Investments — money the business BORROWS from investors. The mirror image of
 * an interest-only loan: the investor is the lender, we are the borrower, and
 * every interest payout is a business COST (auto-posted to Expenses).
 *
 * Money math deliberately mirrors the interest-only loan rules in DataContext
 * (accrual by elapsed cycles, netted against what has been paid), so the two
 * sides of the book are computed the same way and can be reasoned about
 * together. Rupees are plain integers; never a float in balance math.
 *
 * Storage: localStorage until the backend feature exists. The auto-posted
 * EXPENSES are real records in the normal expense store — only the investment
 * register and its payout history live here.
 */

import { todayISO, addMonths, isoLocal } from '@/lib/format';

/** Interest cadence. 'MONTHLY' accrues every calendar month, 'YEARLY' annually. */
export type PayoutFrequency = 'MONTHLY' | 'YEARLY';
export type InvestmentStatus = 'ACTIVE' | 'CLOSED';
export type PayMode = 'CASH' | 'UPI' | 'BANK' | 'CHEQUE';

/** One interest payout to the investor. Every payout has a matching Expenses
 *  record (posted at the same moment, under INVESTOR_EXPENSE_CATEGORY with
 *  investorExpenseName as its name) — that expense is the authoritative cost. */
export interface InvestorPayout {
  id: number;
  investmentId: number;
  date: string;          // YYYY-MM-DD — when the money actually left (receipt-date rule)
  amount: number;
  mode: PayMode;
  remarks?: string;
}

export interface Investment {
  id: number;
  code: string;          // INV-#### — human-readable reference
  investorName: string;
  mobile?: string;
  email?: string;
  principal: number;     // amount received from the investor
  /** Rate is PER CYCLE: 2% monthly = 2% of principal every month;
   *  12% yearly = 12% of principal once a year. Mirrors loan rate semantics. */
  rate: number;
  frequency: PayoutFrequency;
  startDate: string;     // YYYY-MM-DD — when the money was received
  status: InvestmentStatus;
  /** Set when the principal is returned; the investment then stops accruing. */
  settledDate?: string;
  notes?: string;
  createdAt: string;
}

// ── derived money ─────────────────────────────────────────────────────────────

/** Interest due per cycle = principal × rate / 100 (rounded to whole rupees). */
export const interestPerCycle = (inv: Investment): number =>
  Math.round((inv.principal * inv.rate) / 100);

/** Cycle length in days, for display only (accrual uses calendar months). */
export const cycleDays = (f: PayoutFrequency): number => (f === 'MONTHLY' ? 30 : 365);

/** Cycles that have FALLEN DUE by `asOf`. Cycle k is due at start + k months
 *  (12k for yearly), so it counts from its due day — never a day early. This
 *  mirrors monthlyCyclesElapsed for loans. An investment stops accruing on the
 *  day it is settled. */
export function cyclesElapsed(inv: Investment, asOf = todayISO()): number {
  const end = inv.status === 'CLOSED' && inv.settledDate && inv.settledDate < asOf
    ? inv.settledDate
    : asOf;
  const step = inv.frequency === 'MONTHLY' ? 1 : 12;
  let k = 0;
  // Walk forward one cycle at a time: calendar-correct (month lengths vary) and
  // bounded — a 10-year monthly investment is only 120 iterations.
  for (;;) {
    const due = addMonths(inv.startDate, (k + 1) * step, 0);
    if (due > end) break;
    k += 1;
    if (k > 1200) break; // hard stop against a corrupt start date
  }
  return k;
}

/** The due date of cycle k (1-based). */
export const cycleDueDate = (inv: Investment, k: number): string =>
  addMonths(inv.startDate, k * (inv.frequency === 'MONTHLY' ? 1 : 12), 0);

/** Next payout date — the first cycle not yet fully funded. Null once closed. */
export function nextPayoutDate(inv: Investment, payouts: InvestorPayout[]): string | null {
  if (inv.status === 'CLOSED') return null;
  const per = interestPerCycle(inv);
  if (per <= 0) return null;
  const paidCycles = Math.min(
    Math.floor(totalPaid(inv.id, payouts) / per),
    cyclesElapsed(inv), // cap at accrued, so paying ahead can't mask arrears
  );
  return cycleDueDate(inv, paidCycles + 1);
}

export const totalPaid = (investmentId: number, payouts: InvestorPayout[]): number =>
  payouts.filter((p) => p.investmentId === investmentId).reduce((s, p) => s + p.amount, 0);

/** Interest accrued to date (whether paid or not). */
export const accruedInterest = (inv: Investment, asOf = todayISO()): number =>
  cyclesElapsed(inv, asOf) * interestPerCycle(inv);

/** Interest owed to the investor right now = accrued − paid. Never negative
 *  (paying ahead shows as 0 outstanding, not a credit). */
export const interestDue = (inv: Investment, payouts: InvestorPayout[]): number =>
  Math.max(0, accruedInterest(inv) - totalPaid(inv.id, payouts));

/** Total we owe if we closed today: principal back + unpaid interest. */
export const payableNow = (inv: Investment, payouts: InvestorPayout[]): number =>
  (inv.status === 'CLOSED' ? 0 : inv.principal) + interestDue(inv, payouts);

/** Days overdue on the current cycle (0 when on schedule). */
export function daysOverdue(inv: Investment, payouts: InvestorPayout[], asOf = todayISO()): number {
  const nd = nextPayoutDate(inv, payouts);
  if (!nd || nd >= asOf) return 0;
  const [ay, am, ad] = asOf.split('-').map(Number);
  const [by, bm, bd] = nd.split('-').map(Number);
  return Math.round((new Date(ay, am - 1, ad).getTime() - new Date(by, bm - 1, bd).getTime()) / 86400000);
}

/** Per-cycle schedule for the detail view: due date, amount, and funded state
 *  (FIFO — the oldest unpaid cycle is funded first, like the loan ledger). */
export interface CycleRow {
  sn: number;
  dueDate: string;
  due: number;
  paid: number;
  status: 'Paid' | 'Partial' | 'Overdue' | 'Upcoming';
}

export function buildCycles(inv: Investment, payouts: InvestorPayout[], asOf = todayISO()): CycleRow[] {
  const per = interestPerCycle(inv);
  if (per <= 0) return [];
  const pool = totalPaid(inv.id, payouts);
  const elapsed = cyclesElapsed(inv, asOf);
  const funded = Math.floor(pool / per);
  // Show every elapsed cycle, every funded cycle (paid ahead stays visible),
  // plus ONE upcoming — mirrors the loan ledger's row rule.
  const count = Math.max(elapsed, funded) + (inv.status === 'CLOSED' ? 0 : 1);
  const rows: CycleRow[] = [];
  for (let k = 1; k <= count; k++) {
    const dueDate = cycleDueDate(inv, k);
    const paid = Math.max(0, Math.min(pool - (k - 1) * per, per));
    rows.push({
      sn: k,
      dueDate,
      due: per,
      paid,
      status: paid >= per ? 'Paid' : paid > 0 ? 'Partial' : dueDate < asOf ? 'Overdue' : 'Upcoming',
    });
  }
  return rows;
}

/** Portfolio roll-up for the page KPIs. */
export function investmentTotals(list: Investment[], payouts: InvestorPayout[]) {
  const active = list.filter((i) => i.status === 'ACTIVE');
  return {
    investors: new Set(list.map((i) => i.investorName.trim().toLowerCase())).size,
    activeCount: active.length,
    capital: active.reduce((s, i) => s + i.principal, 0),
    monthlyOutgo: active.reduce(
      (s, i) => s + (i.frequency === 'MONTHLY' ? interestPerCycle(i) : Math.round(interestPerCycle(i) / 12)),
      0,
    ),
    interestDue: active.reduce((s, i) => s + interestDue(i, payouts), 0),
    interestPaid: payouts.reduce((s, p) => s + p.amount, 0),
    overdueCount: active.filter((i) => daysOverdue(i, payouts) > 0).length,
  };
}

// ── storage ──────────────────────────────────────────────────────────────────

const INV_KEY = 'anush.investments.v1';
const PAY_KEY = 'anush.investorPayouts.v1';
const SEQ_KEY = 'anush.investments.seq';

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}
function write<T>(key: string, rows: T[]) {
  try { localStorage.setItem(key, JSON.stringify(rows)); } catch { /* quota — ignore */ }
}

export const loadInvestments = (): Investment[] => read<Investment>(INV_KEY);
export const saveInvestments = (rows: Investment[]) => write(INV_KEY, rows);

/**
 * Active investor capital, for the funds guard on the Dashboard and Loans.
 *
 * In API mode the register lives on the server, so localStorage would read 0 —
 * which would silently DISABLE the lending guard (the worst failure mode: it
 * fails open, permitting unfunded loans). A tiny cache, refreshed by
 * `cacheInvestorCapital` whenever the Investments page loads from the API,
 * keeps the figure available to those synchronous call sites.
 */
const CAPITAL_CACHE_KEY = 'anush.investorCapital.v1';

export function cacheInvestorCapital(total: number): void {
  try { localStorage.setItem(CAPITAL_CACHE_KEY, String(total)); } catch { /* quota */ }
}

/** Active investor capital: the API-mode cache when present, else the local
 *  register. Returns 0 when there is genuinely no investor capital. */
export function activeInvestorCapital(useApi: boolean): number {
  if (useApi) {
    const raw = localStorage.getItem(CAPITAL_CACHE_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  return loadInvestments()
    .filter((i) => i.status === 'ACTIVE')
    .reduce((s, i) => s + i.principal, 0);
}
export const loadPayouts = (): InvestorPayout[] => read<InvestorPayout>(PAY_KEY);
export const savePayouts = (rows: InvestorPayout[]) => write(PAY_KEY, rows);

/** Monotonic id/code sequence, shared by investments and payouts. */
export function nextSeq(): number {
  const cur = Number(localStorage.getItem(SEQ_KEY) ?? '4000');
  const next = cur + 1;
  try { localStorage.setItem(SEQ_KEY, String(next)); } catch { /* ignore */ }
  return next;
}

export const investmentCode = (seq: number) => `INV-${seq}`;

/** Today, clamped to on/after the investment start (a payout can't predate the
 *  money arriving) — mirrors the collections minPaymentDate rule. */
export const payoutDefaultDate = (inv: Investment): string => {
  const t = todayISO();
  return t < inv.startDate ? inv.startDate : t;
};

/** Expense category + sub-category every auto-posted payout uses, so investor
 *  cost is separable in expense reports and never mixed with office costs. */
export const INVESTOR_EXPENSE_CATEGORY = 'Investor Interest';
export const investorExpenseName = (inv: Investment) => `Interest — ${inv.investorName} (${inv.code})`;

/** Maturity/first-payout helper for the create form's live preview. */
export const firstPayoutDate = (startDate: string, frequency: PayoutFrequency): string =>
  addMonths(startDate, frequency === 'MONTHLY' ? 1 : 12, 0);

/** Simple ISO date for N days from a date (used by the summary strip). */
export const isoFrom = (d: Date) => isoLocal(d);

/** Whole calendar days a − b, local-time (never Date-from-ISO, which is UTC). */
export function daysBetweenISO(aISO: string, bISO: string): number {
  const [ay, am, ad] = aISO.split('-').map(Number);
  const [by, bm, bd] = bISO.split('-').map(Number);
  return Math.round((new Date(ay, am - 1, ad).getTime() - new Date(by, bm - 1, bd).getTime()) / 86400000);
}

/** Whole months between two dates (how long capital has been held). */
export function monthsBetweenISO(fromISO: string, toISO: string): number {
  const [fy, fm, fd] = fromISO.split('-').map(Number);
  const [ty, tm, td] = toISO.split('-').map(Number);
  let n = (ty - fy) * 12 + (tm - fm);
  if (td < fd) n -= 1; // the current month is not complete yet
  return Math.max(0, n);
}
