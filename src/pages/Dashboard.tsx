import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  useData, LOAN_LABELS, isDailyLoan, behavesInterestOnly, type Loan,
} from '@/mock/DataContext';
import { inr, inrShort, fmtDate, todayISO, isoLocal } from '@/lib/format';
import { whatsappHref } from '@/lib/whatsapp';
import { usePermissions } from '@/lib/permissions';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useOpenSidebar } from '@/components/layout/AppShell';
import {
  ChartCard, KpiCard, LoanPerformanceChart, CashFlowChart, EfficiencyGauge, RangeToggle, C,
  type LoanPerfPoint, type CashFlowPoint, type KpiTrend, type Range,
} from '@/components/dashboard/Charts';
import {
  PeriodFilter, type PeriodMode, type PeriodRangeKey, RANGE_PRESETS, periodDisplayLabel, isPeriodDefault,
} from '@/components/dashboard/PeriodFilter';
import { computeFunds, interestRealised } from '@/lib/funds';
import { buildSchedule } from '@/lib/loanSchedule';
import { riskFor, RISK_PILL, AVATAR_TINT } from '@/lib/risk';
import { WhatsAppIcon } from '@/components/ui/whatsapp-icon';
import { OverdueLoansDialog, type OverdueLoanRow } from '@/components/dashboard/OverdueLoansDialog';
import {
  Wallet, IndianRupee, TrendingUp, Menu, Landmark, PiggyBank, Banknote, Percent,
  Phone, Eye, HandCoins, ArrowRight, Search, Receipt, FileDown, MoreVertical,
} from 'lucide-react';

/** Whole calendar days between two YYYY-MM-DD dates (a − b). */
function daysBetween(aISO: string, bISO: string): number {
  const [ay, am, ad] = aISO.split('-').map(Number);
  const [by, bm, bd] = bISO.split('-').map(Number);
  return Math.round((new Date(ay, am - 1, ad).getTime() - new Date(by, bm - 1, bd).getTime()) / 86400000);
}

/** Digits-only tel: href for the device dialer (user still confirms the call). */
function telHref(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return `tel:${digits}`;
}

/**
 * Overdue reminder for WhatsApp.
 *
 * WhatsApp carries PLAIN TEXT only — no colour, HTML or tables; the sole
 * formatting is *bold*, _italic_ and ~strike~. Emoji are therefore the only
 * elements that render in colour, so each fact is led by one: the message stays
 * scannable in a notification preview without any alignment that could wrap.
 *
 * A monospace block was tried and dropped — it wrapped badly on narrow phones,
 * which looked worse than no alignment at all.
 */
function overdueWhatsAppMessage(r: {
  customer: string; loanNo: string; type: string; due: number; days: number; dueSince: string;
}): string {
  return [
    '🔔 *Payment Reminder*',
    `Hi *${r.customer}*,`,
    '',
    'Your payment is currently overdue.',
    '',
    // Emoji chosen from Emoji 1.0/2.0 ONLY (2015-era), so they render on old
    // Android builds and on desktop clients with incomplete emoji fonts. The
    // receipt glyph 🧾 (U+1F9FE) was dropped for 📄: it is Emoji 12.0 (2019)
    // and shows as a ◆ placeholder wherever the font predates it.
    `💰 Amount: *${inr(r.due)}*`,
    `📅 Due date: ${r.dueSince}`,
    // A loan number is this business's equivalent of an invoice number.
    `📄 Loan: ${r.loanNo} (${r.type})`,
    `⏰ Overdue by: *${r.days} ${r.days === 1 ? 'day' : 'days'}*`,
    '',
    'If you have already made the payment, please ignore this message.',
    '',
    'Thank you,',
    '*Anush Finserv*',
  ].join('\n');
}

/**
 * Unpaid instalments for an overdue notice: the elapsed schedule slots that
 * FIFO-funding has not covered. Mirrors the ledger's allocation (payments fund
 * the oldest slot first), so the notice lists exactly the rows the Collection
 * Ledger shows as Overdue/Partial — never a different set.
 */
function unpaidRowsFor(
  loan: Loan, collected: number, todayStr: string, cadence: 'day' | 'month',
): { label: string; dueDate: string; amount: string; pending: number }[] {
  const sched = buildSchedule(loan, { collected, settlement: null });
  const per = loan.dailyAmount ?? 0;
  if (per <= 0) return [];
  const out: { label: string; dueDate: string; amount: string; pending: number }[] = [];
  let pool = collected;
  for (const row of sched) {
    if (row.settled) continue;
    const funded = Math.max(0, Math.min(pool, row.instalment));
    pool -= funded;
    const pending = row.instalment - funded;
    // Only ELAPSED slots that are still short — an upcoming instalment is not
    // overdue, and including it would overstate what the customer owes today.
    if (pending > 0 && row.dueDate < todayStr) {
      out.push({
        label: `${cadence === 'day' ? 'Day' : 'Month'} ${row.sn}`,
        dueDate: fmtDate(row.dueDate),
        amount: inr(pending),
        pending,
      });
    }
  }
  return out;
}

/** Last N months as {key:'YYYY-MM', label, endISO}, oldest first. */
function lastMonths(n: number): { key: string; label: string; endISO: string }[] {
  const out: { key: string; label: string; endISO: string }[] = [];
  const base = new Date(); base.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const end = new Date(dt.getFullYear(), dt.getMonth() + 1, 0);
    out.push({ key: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`, label: dt.toLocaleDateString('en-IN', { month: 'short' }), endISO: isoLocal(end) });
  }
  return out;
}

/** Honest % change vs a prior value ('' if no meaningful base to compare). */
function trendOf(current: number, prev: number): KpiTrend | null {
  if (prev <= 0) return null;
  const pct = Math.round(((current - prev) / prev) * 100);
  if (pct === 0) return null;
  return { value: `${Math.abs(pct)}%`, positive: pct > 0 };
}

export default function Dashboard() {
  const d = useData();
  const navigate = useNavigate();
  const openSidebar = useOpenSidebar();
  const { canView } = usePermissions();
  const [overdueQuery, setOverdueQuery] = useState('');
  // The search field is collapsed to its icon until asked for. The card header
  // has to fit a title, a count, the field and "View all" inside 7/10 of the
  // content width; a permanently-open 208px input left the header wrapping onto
  // two lines on a laptop. Collapsed, the row breathes and the field is one
  // click away.
  const [overdueSearchOpen, setOverdueSearchOpen] = useState(false);
  const overdueSearchRef = useRef<HTMLInputElement>(null);
  // Full-list dialog — the card shows only the 6 worst, so this is the only
  // place loans 7+ are reachable from the dashboard.
  const [overdueAllOpen, setOverdueAllOpen] = useState(false);
  // Row whose mobile ⋮ menu is open (phones only — desktop shows the icon row).
  // Which KPI breakdown popup is open. The Profit card deep-links to the
  // Investments page; Investments and Available Funds explain themselves
  // right here, because both are derived figures a reader cannot verify
  // from the card alone.
  const [fundsDialog, setFundsDialog] = useState<null | 'investments' | 'available'>(null);
  const [overdueMenu, setOverdueMenu] = useState<number | null>(null);
  // Screen coords for the portalled menu (see the trigger's onClick).
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  // Charts open on the same 1-year window as the KPIs, so every figure on
  // the screen describes one period (see periodMode default below).
  const [cashRange, setCashRange] = useState<Range>('1y');
  const [perfRange, setPerfRange] = useState<Range>('1y');
  // Period filter — day defaults to today; month to current calendar month;
  // 'range' scopes the KPIs to a quick-range preset AND drives both chart
  // toggles to the same window, so the whole dashboard describes one period.
  // Default to the 1-YEAR range, not today. A single day shows ₹0 on every
  // money card whenever nothing was collected that morning, which reads as
  // "the business earned nothing" rather than "no cash in yet today". The year
  // view answers the question the dashboard is actually for — how is the book
  // doing — and the date filter is still there for a specific day or month.
  const [periodMode, setPeriodMode] = useState<PeriodMode>('range');
  const [periodDate, setPeriodDate] = useState(todayISO);
  const [periodRange, setPeriodRange] = useState<PeriodRangeKey>('1y');

  const active = d.loans.filter((l) => l.status === 'ACTIVE');
  const today = todayISO();
  const thisMonth = today.slice(0, 7);
  const periodKey = periodDate.slice(0, 7);
  const [ly, lm] = thisMonth.split('-').map(Number);
  const lastMonthKey = `${lm === 1 ? ly - 1 : ly}-${String(lm === 1 ? 12 : lm - 1).padStart(2, '0')}`;

  // Range window = the SAME calendar months the charts bucket over
  // (lastMonths(n)), so the range KPIs are exactly the sum of the chart bars —
  // never a rolling window that would quietly disagree with the chart next to it.
  const rangeMonthsN = RANGE_PRESETS.find((p) => p.key === periodRange)?.months ?? 1;
  const rangeFrom = `${lastMonths(rangeMonthsN)[0].key}-01`;
  const inRange = (date: string) => date >= rangeFrom;

  const applyRangePreset = (key: PeriodRangeKey) => {
    setPeriodMode('range');
    setPeriodRange(key);
    // Re-scope the charts to the same window (their Range keys are identical).
    setCashRange(key);
    setPerfRange(key);
  };

  const resetPeriod = () => {
    // Leaving a range restores the charts' defaults too (the range set them).
    if (periodMode === 'range') { setCashRange('month'); setPerfRange('6m'); }
    setPeriodMode('day');
    setPeriodDate(todayISO());
  };

  // Scheduled shortfall, dispatched by BEHAVIOUR (three economic groups), not by
  // "daily vs everything else": an interest-only loan (incl. a monthly-mode
  // Vehicle/Property) accrues interest cycles, so measuring it with the EMI
  // formula compared EMI-style expectations against total collections and
  // reported the wrong Due Amount on the overdue list.
  const dueFor = (l: Loan) =>
    behavesInterestOnly(l) ? d.totalDueForInterestOnly(l)
      : isDailyLoan(l.type) ? d.totalDueForDaily(l)
        : d.totalDueForMonthly(l);
  const isOverdue = (l: Loan) => { const nd = d.nextDueFor(l); return !!nd && nd < today; };

  // Current loan-status counts (for the Loan Performance summary strip).
  const overdueCount = active.filter(isOverdue).length;
  const activeCount = active.length - overdueCount;   // active & on schedule
  const closedCount = d.loans.length - active.length;

  // ── monthly money helpers ──
  const collInMonth = (key: string) => d.collections.filter((c) => c.date.slice(0, 7) === key).reduce((s, c) => s + c.amount, 0);
  const expInMonth = (key: string) => d.expenses.filter((e) => e.date.slice(0, 7) === key).reduce((s, e) => s + e.amount, 0);

  const monthColl = collInMonth(thisMonth);
  const monthExp = expInMonth(thisMonth);
  const lastColl = collInMonth(lastMonthKey);
  const lastExp = expInMonth(lastMonthKey);

  const monthDue = active.reduce((s, l) => s + dueFor(l), 0);
  // Total Outstanding stays GROSS — the true amount borrowers owe. It must
  // match the Loans and Reports pages, which list those very loans.
  const totalOutstanding = active.reduce((s, l) => s + d.outstandingFor(l), 0);
  // Funding position on a CASH basis — the same helper the Loans page uses to
  // gate lending, so the KPI and the guard can never disagree. Interest earned
  // raises it (it arrives inside collections); every expense lowers it.
  const funds = useMemo(
    () => computeFunds(
      d.loans, d.expenses,
      interestRealised(d.loans, d.collections),
      // TOTAL COLLECTED (cash in) — not the outstanding receivable. See
      // computeFunds: passing a receivable made the business look overdrawn by
      // its own unearned margin.
      d.collections.reduce((s, c) => s + c.amount, 0),
    ),
    [d.loans, d.collections, d.expenses],
  );
  const investorCapital = funds.capital;

  // Selected period (day or month) — drives Collections / Profit / Expenses KPIs.
  const periodColl = periodMode === 'day'
    ? d.collections.filter((c) => c.date === periodDate).reduce((s, c) => s + c.amount, 0)
    : periodMode === 'range'
      ? d.collections.filter((c) => inRange(c.date)).reduce((s, c) => s + c.amount, 0)
      : collInMonth(periodKey);

  const periodExp = periodMode === 'day'
    ? d.expenses.filter((e) => e.date === periodDate).reduce((s, e) => s + e.amount, 0)
    : periodMode === 'range'
      ? d.expenses.filter((e) => inRange(e.date)).reduce((s, e) => s + e.amount, 0)
      : expInMonth(periodKey);

  const totalCollected = d.collections.reduce((s, c) => s + c.amount, 0); // all-time collections

  // Collection efficiency = collected ÷ (collected + still-due) this month.
  // NULL when there's no collection activity at all — showing "100%" with zero
  // collections is misleading, so we render "—" instead.
  // (The month-on-month trend that fed the retired KPI card is gone with it —
  // the gauge below shows the current figure, not a comparison.)
  const hasEfficiency = monthColl + monthDue > 0;
  const efficiency = hasEfficiency ? Math.round((monthColl / (monthColl + monthDue)) * 100) : null;

  const loanById = useMemo(() => new Map(d.loans.map((l) => [l.id, l])), [d.loans]);

  // ── Profit recognition (realised only as money is COLLECTED) ──────────────
  // Two economic behaviours, each recognised differently:
  //  • Interest-only (Daily/Monthly Interest, Flexible, monthly-mode Vehicle/
  //    Property): every interest-kind payment IS profit; a PRINCIPAL settlement
  //    (returning our own money) is not.
  //  • Upfront/EMI (Daily Collection, Vehicle/Property EMI): the customer repays
  //    MORE than we disbursed; the surplus is profit. We recognise PROFIT-LAST —
  //    the first `disbursed` collected is principal return (₹0 profit); every
  //    rupee collected ABOVE `disbursed` is profit, capped at the total margin
  //    (deduction, or interest for EMI). A foreclosure's big final payment pushes
  //    cumulative collections over `disbursed`, so its profit portion lands in
  //    that month automatically.
  // profitByCollectionId maps each collection → the profit realised by THAT
  // payment, so summing by month gives profit-per-month correctly.
  const profitByCollectionId = useMemo(() => {
    const map = new Map<number, number>();
    // group collections per loan, chronological (date, then id for same-day order)
    const byLoan = new Map<number, typeof d.collections>();
    for (const c of d.collections) {
      const arr = byLoan.get(c.loanId) ?? [];
      arr.push(c); byLoan.set(c.loanId, arr);
    }
    for (const [loanId, colls] of byLoan) {
      const loan = loanById.get(loanId);
      if (!loan) continue;
      const ordered = [...colls].sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
      if (behavesInterestOnly(loan)) {
        for (const c of ordered) map.set(c.id, c.kind === 'PRINCIPAL' ? 0 : c.amount);
      } else {
        // Upfront/EMI, profit-last. Profit band = collections above `disbursed`,
        // capped at the total margin.
        const disbursed = loan.disbursed ?? Math.max(0, loan.principal - (loan.deduction ?? 0));
        const margin = (loan.deduction ?? 0) > 0 ? (loan.deduction ?? 0) : loan.interest; // Daily=deduction, EMI=interest
        let cum = 0;
        for (const c of ordered) {
          const before = cum;
          cum += c.amount;
          // profit portion of THIS payment = part landing in (disbursed, disbursed+margin]
          const lo = Math.max(before, disbursed);
          const hi = Math.min(cum, disbursed + margin);
          map.set(c.id, Math.max(0, hi - lo));
        }
      }
    }
    return map;
  }, [d.collections, loanById]);

  // ── Cards the lender actually reads the book by ────────────────────────────
  // The old strip mixed capital, cash position and period takings, so nothing
  // answered "what did I lend, what is late, what came back, what did I earn".
  // These four do, and they split cash from earnings instead of blending them.

  /** Actual Principal — face value of every ACTIVE loan: what is on the books. */
  /** Total handed to borrowers — CASH, across every loan ever made.
   *
   *  Deliberately the same definition `computeFunds` uses for `disbursed`, so
   *  the card and the Available Funds popup row show one identical number.
   *  Three different figures were previously called "lent": active-only face
   *  principal here, all-loans cash in the popup, and cash-still-out in the
   *  Investments popup. Same word, three values, nothing on screen explaining
   *  the difference — which made the dashboard impossible to reconcile by eye.
   *
   *  CASH not face principal: Daily Collection keeps its interest upfront, so
   *  face principal counts money that never left the bank.
   *  ALL loans not just active: a closed loan's repayments sit in `collected`,
   *  so omitting its disbursal would credit the return without debiting the
   *  outlay. */
  const actualPrincipal = funds.disbursed;

  /** Interest taken UPFRONT at disbursal, across all loans ever made.
   *
   *  Daily Collection deducts its interest before handing the money over: a
   *  ₹10,00,000 loan pays out ₹9,70,000 while the borrower still owes the full
   *  ₹10,00,000. That ₹30,000 never left the bank, which is the whole reason
   *  "disbursed" is lower than "principal" — the single most-questioned gap on
   *  this dashboard. Spanning ALL loans (not just active) because `disbursed`
   *  in computeFunds does too, so the two figures describe the same set. */
  const upfrontDeducted = d.loans.reduce(
    (s, l) => s + Math.max(0, l.principal - (l.disbursed ?? l.principal)),
    0,
  );

  /** Overdue — arrears across active loans (the shortfall owed by today), and
   *  how many borrowers it spans. Same helper the Overdue Loans table uses, so
   *  the card and the list below it can never disagree. */
  /** Arrears split by WHAT is actually late — the two are different debts, not
   *  a presentational slice of one number:
   *
   *  • Collection overdue (Daily Collection, EMI-mode Vehicle/Property):
   *    interest was deducted upfront, so a missed instalment is unrecovered
   *    PRINCIPAL — cash the lender is out of pocket.
   *  • Interest overdue (Daily/Monthly Interest, Flexible, monthly-mode
   *    Vehicle/Property): principal is not due until settlement, so what is
   *    late is accrued INTEREST — unearned revenue, not lost capital.
   *
   *  Mixing them hides which problem the book has. The predicate is the same
   *  behavesInterestOnly() the ledger, profit and dueFor() already branch on,
   *  so the two cards always sum to the Overdue total above. */
  const collectionOverdue = active
    .filter((l) => !behavesInterestOnly(l))
    .reduce((s, l) => s + Math.max(0, dueFor(l)), 0);

  /** Collection Receivable — PRINCIPAL still owed across EVERY active loan.
   *  Paired with Interest Overdue, the two split Total Outstanding cleanly:
   *
   *      Collection Receivable + Interest Overdue = Total Outstanding
   *
   *  Principal behaves differently by loan type, so the sum dispatches:
   *   • Daily Collection — interest was taken upfront, so instalments repay
   *     principal and it SHRINKS with every payment → principal − collected.
   *   • Interest-only — principal is settled in one lump at the end, so
   *     periodic payments never reduce it → principal, in full.
   *
   *  An earlier version counted collection-type loans only. That left the
   *  interest-only loans' ₹70.2 L of principal on no card at all — nearly half
   *  the book invisible — and the two cards then failed to reconcile against
   *  Total Outstanding. */
  const collectionReceivable = active.reduce(
    (s, l) => s + Math.max(0, behavesInterestOnly(l) ? l.principal : d.outstandingFor(l)),
    0,
  );
  const collectionReceivableCount = active.length;
  const interestOverdue = active
    .filter((l) => behavesInterestOnly(l))
    .reduce((s, l) => s + Math.max(0, dueFor(l)), 0);
  const interestOverdueCount = active.filter((l) => behavesInterestOnly(l) && isOverdue(l)).length;

  /** Interest Collected — the earnings half of the money received, on the SAME
   *  recognition rules as the Profit KPI (interestRealised → per-collection),
   *  so the two can never drift. Bucketed by receipt date, like every other
   *  period figure. */
  const collectionsInPeriod = periodMode === 'day'
    ? d.collections.filter((c) => c.date === periodDate)
    : periodMode === 'range'
      ? d.collections.filter((c) => inRange(c.date))
      : d.collections.filter((c) => c.date.slice(0, 7) === periodKey);
  const interestCollected = collectionsInPeriod
    .reduce((s, c) => s + (profitByCollectionId.get(c.id) ?? 0), 0);

  /** Actual Collection — cash received MINUS the interest portion, i.e. the
   *  principal actually recovered. Interest is shown in its own card, so adding
   *  it here would count the same rupee twice on one screen. */
  const actualCollection = Math.max(0, periodColl - interestCollected);

  const profitInMonth = (key: string) =>
    d.collections.reduce((s, c) => (c.date.slice(0, 7) === key ? s + (profitByCollectionId.get(c.id) ?? 0) : s), 0);
  // Range profit = sum of each in-range receipt's realised profit — the SAME
  // per-collection recognition profitInMonth uses (interest-only: full payment;
  // upfront/EMI: profit-last band), just bucketed by a wider window.
  const periodProfit = periodMode === 'day'
    ? d.collections.reduce((s, c) => (c.date === periodDate ? s + (profitByCollectionId.get(c.id) ?? 0) : s), 0)
    : periodMode === 'range'
      ? d.collections.reduce((s, c) => (inRange(c.date) ? s + (profitByCollectionId.get(c.id) ?? 0) : s), 0)
      : profitInMonth(periodKey);
  const monthInterest = profitInMonth(thisMonth);   // "Profit" this month (name kept for downstream use)
  const lastInterest = profitInMonth(lastMonthKey);
  // NET profit for the selected period: interest earned LESS expenses paid in
  // the SAME window (periodExp already follows day/month/range). Deliberately
  // not clamped — a loss-making month must read as a loss.
  const netPeriodProfit = periodProfit - periodExp;
  const periodLabel = periodDisplayLabel(periodMode, periodDate, periodRange);
  const periodIsDefault = isPeriodDefault(periodMode, periodDate, today);

  // ── Section 1 KPIs ──
  // Each card drills down to the page that can show the SAME figure:
  //  • Total Outstanding / Due Today → Loans, pre-filtered to ACTIVE (the set
  //    both figures sum over; Due Today additionally sorts by urgency).
  //  • Collections / Expenses → Reports on that tab, which lists the underlying
  //    records (the Collections page is a loan tracker, not a receipt list, so
  //    it cannot reproduce the figure).
  //  • Profit → Reports' Collections tab: profit is recognised per collection,
  //    so those receipts ARE its source records.
  //  • Collection Efficiency is a ratio with no record list — NOT clickable.
  const kpis = [
    // Investor capital leads: it is the funding the whole book sits on.
    { icon: Landmark, tint: 'bg-violet-50 dark:bg-violet-500/15', iconColor: 'text-violet-600 dark:text-violet-400', label: 'Investments', value: inr(investorCapital),
      // Shows the SAME figure as the Borrower Lent card — the plain total lent
      // to customers, nothing derived. It previously showed cash-still-deployed
      // (disbursed − collected), which is a different, smaller number and made
      // the two cards look contradictory for no benefit to the reader.
      hint: investorCapital > 0 ? `${inr(actualPrincipal)} given to borrowers` : 'No investor capital', trend: null as KpiTrend | null,
      onClick: () => setFundsDialog('investments'), actionLabel: `Investor capital ${inr(investorCapital)} — see the breakdown` },
    // Available to lend: capital − lent out + net profit (interest − expenses).
    { icon: PiggyBank, tint: 'bg-teal-50 dark:bg-teal-500/15', iconColor: 'text-teal-600 dark:text-teal-400', label: 'Available Funds', value: inr(funds.available),
      // Breakdown uses the SAME terms computeFunds adds up (capital + collected
      // − disbursed − expenses). The old hint restated it as
      // `capital − outstanding + profit`, which matched only while collections
      // ≤ disbursals: `outstanding` floors at 0, so once a book is repaid past
      // its disbursals the hint under-reported the very figure above it.
      hint: investorCapital > 0
        ? `${inr(investorCapital)} capital + ${inr(funds.collected)} collected − ${inr(funds.disbursed)} lent${funds.expenses > 0 ? ` − ${inr(funds.expenses)} expenses` : ''}`
        : 'No investor capital',
      trend: null,
      onClick: () => setFundsDialog('available'), actionLabel: `Available funds ${inr(funds.available)} — see how it is calculated` },
    // BORROWER LENT — face value of the active book: what borrowers OWE.
    // Distinct from the Investments card's "lent out", which is cash still
    // deployed; this one does not shrink as borrowers repay.
    { icon: Banknote, tint: 'bg-blue-50 dark:bg-blue-500/15', iconColor: 'text-blue-600 dark:text-blue-400', label: 'Given to Borrowers', value: inr(actualPrincipal),
      hint: 'Cash handed over, all loans to date', trend: null,
      onClick: () => navigate('/loans?status=ACTIVE'), actionLabel: `Given to borrowers ${inr(actualPrincipal)} — view loans` },
    { icon: Wallet, tint: 'bg-indigo-50 dark:bg-indigo-500/15', iconColor: 'text-indigo-600 dark:text-indigo-400', label: 'Total Outstanding', value: inr(totalOutstanding),
      hint: 'Principal + accrued interest', trend: null,
      onClick: () => navigate('/loans?status=ACTIVE'), actionLabel: `Total outstanding ${inr(totalOutstanding)} — view active loans` },
    // COLLECTION RECEIVABLE — every rupee of principal still to be collected on
    // collection-type loans, arrears included. Sits immediately before the
    // overdue card because it is the whole of which that is the late part.
    { icon: HandCoins, tint: 'bg-cyan-50 dark:bg-cyan-500/15', iconColor: 'text-cyan-600 dark:text-cyan-400', label: 'Collection Receivable', value: inr(collectionReceivable),
      hint: `${collectionReceivableCount} loan${collectionReceivableCount === 1 ? '' : 's'} · incl. ${inr(collectionOverdue)} overdue`,
      trend: null,
      onClick: () => navigate('/collections'), actionLabel: `Collection receivable ${inr(collectionReceivable)} — view collections` },
    // Collection Overdue was a card here. Removed: it is a SUBSET of Collection
    // Receivable above (which states the overdue portion in its own hint), so
    // showing both invited adding them together and double-counting the arrears.
    // INTEREST OVERDUE — accrued interest unpaid on interest-only loans. The
    // principal is not late here, so it reads amber, not red: unearned revenue
    // rather than lost capital.
    { icon: Percent, tint: 'bg-orange-50 dark:bg-orange-500/15', iconColor: 'text-orange-600 dark:text-orange-400', label: 'Interest Overdue', value: inr(interestOverdue),
      hint: `${interestOverdueCount} loan${interestOverdueCount === 1 ? '' : 's'} · interest unpaid`, trend: null,
      onClick: () => navigate('/loans?status=ACTIVE&urgency=overdue'), actionLabel: `Interest overdue ${inr(interestOverdue)} — view loans in arrears` },
    // PRINCIPAL RECOVERED — cash in, MINUS its interest portion. Interest has
    // its own card, so counting it here too would show the same rupee twice.
    { icon: IndianRupee, tint: 'bg-emerald-50 dark:bg-emerald-500/15', iconColor: 'text-emerald-600 dark:text-emerald-400', label: 'Principal Recovered', value: inr(actualCollection),
      hint: `${periodLabel} · ${inr(periodColl)} received in total`, trend: null,
      onClick: () => navigate('/reports?tab=collections'), actionLabel: `Principal recovered ${inr(actualCollection)} — view the collections report` },
    // INTEREST EARNED — the earnings half of the same cash, on the SAME
    // recognition rules as Profit, so the two can never disagree.
    { icon: Percent, tint: 'bg-amber-50 dark:bg-amber-500/15', iconColor: 'text-amber-600 dark:text-amber-400', label: 'Interest Earned', value: inr(interestCollected),
      hint: `${periodLabel} · before expenses`, trend: null,
      onClick: () => navigate('/reports?tab=collections'), actionLabel: `Interest earned ${inr(interestCollected)} — view the collections report` },
    // NET profit — interest earned in the period LESS the expenses paid in it.
    // Can be negative in a month with heavy costs; shown as-is (never clamped),
    // because hiding a loss would misreport the business.
    { icon: TrendingUp, tint: 'bg-emerald-50 dark:bg-emerald-500/15', iconColor: 'text-emerald-600 dark:text-emerald-400', label: 'Profit', value: inr(netPeriodProfit),
      hint: `${inr(interestCollected)} interest earned − ${inr(periodExp)} expenses`,
      trend: periodIsDefault ? trendOf(monthInterest - monthExp, lastInterest - lastExp) : null,
      // Opens the Business Profit breakdown (which loans earned it, what it was
      // spent on) rather than a generic report.
      onClick: () => navigate('/investments?view=profit'),
      actionLabel: `Profit ${inr(netPeriodProfit)} — see which loans earned it and what it was spent on` },
    { icon: Receipt, tint: 'bg-rose-50 dark:bg-rose-500/15', iconColor: 'text-rose-600 dark:text-rose-400', label: 'Expenses', value: inr(periodExp), hint: periodLabel, trend: periodIsDefault && periodMode === 'month' ? trendOf(monthExp, lastExp) : null,
      onClick: () => navigate('/reports?tab=expenses'), actionLabel: `Expenses ${inr(periodExp)} — view the expenses report` },
  ];

  // ── Section 2a — Loan Performance: money OUT (disbursed) vs money IN
  //    (collected) per month, so you see business volume + repayment health. ──
  const loanPerf: LoanPerfPoint[] = useMemo(() => {
    const n = perfRange === 'month' ? 1 : perfRange === '3m' ? 3 : perfRange === '6m' ? 6 : 12;
    return lastMonths(n).map(({ key, label }) => ({
      month: label,
      disbursed: d.loans.filter((l) => l.loanDate.slice(0, 7) === key).reduce((s, l) => s + l.principal, 0),
      collected: d.collections.filter((c) => c.date.slice(0, 7) === key).reduce((s, c) => s + c.amount, 0),
    }));
  }, [perfRange, d.loans, d.collections]);

  // ── Section 2b — Cash Flow Trend. Per-PERIOD (not cumulative) so the lines
  //    spike day-to-day / month-to-month. THREE INDEPENDENT lines: Collections,
  //    Expenses, and Profit (pure interest earned — matches the Profit KPI).
  //    Profit does NOT subtract expenses: mixing them made the line dip negative
  //    on any expense day, which read as a lending loss. Expenses have their own
  //    line for that story.
  //    Range: 'month' = every day of the current month; 3m/6m/1y = monthly totals.
  // Profit realised by a single collection (profit-last / interest rules above).
  const profitOf = (c: { id: number }) => profitByCollectionId.get(c.id) ?? 0;
  const cashFlow: CashFlowPoint[] = useMemo(() => {
    if (cashRange === 'month') {
      const [y, m] = thisMonth.split('-').map(Number);
      const days = new Date(y, m, 0).getDate(); // days in this month
      const coll = new Array(days + 1).fill(0), intr = new Array(days + 1).fill(0), exp = new Array(days + 1).fill(0);
      for (const c of d.collections) if (c.date.slice(0, 7) === thisMonth) {
        const dd = Number(c.date.slice(8, 10));
        coll[dd] += c.amount;
        intr[dd] += profitOf(c);
      }
      for (const e of d.expenses) if (e.date.slice(0, 7) === thisMonth) exp[Number(e.date.slice(8, 10))] += e.amount;
      // HONESTY: plot only days that have actually happened — rendering the
      // rest of the month as ₹0 fabricates a "collections collapsed" cliff.
      const lastDay = Math.min(days, Number(todayISO().slice(8, 10)));
      const pts: CashFlowPoint[] = [];
      for (let day = 1; day <= lastDay; day++) {
        pts.push({ label: String(day), collections: coll[day], expenses: exp[day], net: intr[day] });
      }
      return pts;
    }
    // monthly totals over N months
    const n = cashRange === '3m' ? 3 : cashRange === '6m' ? 6 : 12;
    return lastMonths(n).map(({ key, label }) => {
      let coll = 0, intr = 0, exp = 0;
      for (const c of d.collections) if (c.date.slice(0, 7) === key) { coll += c.amount; intr += profitOf(c); }
      for (const e of d.expenses) if (e.date.slice(0, 7) === key) exp += e.amount;
      return { label, collections: coll, expenses: exp, net: intr };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashRange, thisMonth, d.collections, d.expenses, profitByCollectionId]);

  // ── Section 3 — Overdue loans (real, ranked by days overdue) ──
  // The FULL list. The card renders only the worst 6 (`overdueRows` below) so
  // the dashboard stays scannable; the "View all" dialog renders this one, and
  // is the only place loans 7+ can be reached from here.
  const overdueAll = useMemo(() => active
    .filter(isOverdue)
    .map((l): OverdueLoanRow & { loan: Loan } => {
      const nd = d.nextDueFor(l)!;
      const cust = d.customers.find((c) => c.id === l.customerId);
      return {
        id: l.id,
        customer: cust?.name ?? '—',
        loanNo: l.loanNumber,
        due: dueFor(l),
        days: daysBetween(today, nd),
        // The date the oldest unpaid instalment fell due — states WHEN the
        // arrears began, rather than only how large they are.
        dueSince: nd,
        type: LOAN_LABELS[l.type],
        // Raw type as well as the label, so the dialog's type filter matches on
        // the enum rather than re-parsing display text.
        typeKey: l.type,
        // Total still owed on the loan — the arrears figure alone does not say
        // how big the exposure is (a 3,500 EMI arrear on a 94,000 balance reads
        // very differently from one on a 7,000 balance).
        outstanding: d.outstandingFor(l),
        loan: l, // carried so the notice can itemise the unpaid instalments
        mobile: (l.contact || cust?.mobile || '').trim(),
      };
    })
    .sort((a, b) => b.days - a.days),
    // NO .slice() here. It used to cap at 6, but the panel badge counts THIS
    // array — so a book with 38 loans in arrears reported "6", hiding 32 of
    // them (the worst 227 days late) from whoever works the list. The cap is
    // now applied at RENDER time only, with a "show all" toggle, so the count
    // is always the truth and every loan is reachable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, d, today]);

  /** The card's preview — the 6 worst. Unchanged from what it always showed. */
  const overdueRows = useMemo(() => overdueAll.slice(0, 6), [overdueAll]);

  /** Build the overdue notice PDF and hand it to the OS share sheet, so it can
   *  be sent to the customer on WhatsApp as a document. jsPDF is ~415 KB, so it
   *  is imported on demand rather than bundled into the dashboard. */
  const sendOverdueNotice = async (r: typeof overdueRows[number]) => {
    const { buildOverdueNoticePDF, sharePDF, fileNamePart } = await import('@/lib/pdfReport');
    const cust = d.customers.find((c) => c.id === r.loan.customerId);
    const collected = d.collectedFor(r.loan.id);
    const cadence = isDailyLoan(r.loan.type) ? 'day' : 'month';
    const rows = unpaidRowsFor(r.loan, collected, today, cadence);
    const doc = buildOverdueNoticePDF({
      customerName: r.customer,
      customerMobile: r.mobile || cust?.mobile || '—',
      loanNumber: r.loanNo,
      loanTypeLabel: r.type,
      loanDate: fmtDate(r.loan.loanDate),
      // Fall back to a single summary line when the schedule cannot be itemised
      // (interest-only loans are open-ended), so the notice is never empty.
      rows: rows.length > 0
        ? rows.map((u) => ({ label: u.label, dueDate: u.dueDate, amount: u.amount }))
        : [{ label: '—', dueDate: fmtDate(r.dueSince), amount: inr(r.due) }],
      totalDue: inr(r.due),
      dueSince: fmtDate(r.dueSince),
      daysOverdue: r.days,
      contactLine: 'Anush Finserv · Please contact us if you have any questions.',
    });
    const who = fileNamePart(r.customer);
    await sharePDF(doc, `${who ? `${who}-` : ''}Overdue-Notice-${r.loanNo}-${today}.pdf`);
  };

  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; })();

  // Live data only — every figure derives from the real portfolio.
  const loanPerfView = loanPerf;
  const cashFlowView = cashFlow;
  const overdueView = overdueRows;
  const kpisView = kpis;
  const efficiencyView = efficiency;

  // Search filter for the Overdue Loans list (customer / loan id / risk / type).
  // Risk is still MATCHED here — typing "high" narrows to the high-risk rows —
  // so dropping the risk dropdown from the header did not remove the ability to
  // filter by risk, it just stopped spending header width on it.
  const oq = overdueQuery.trim().toLowerCase();
  const overdueFiltered = oq
    ? overdueView.filter((r) => r.customer.toLowerCase().includes(oq) || r.loanNo.toLowerCase().includes(oq) || riskFor(r.days).toLowerCase().includes(oq) || (r.type ?? '').toLowerCase().includes(oq))
    : overdueView;

  return (
    <div className="min-h-full bg-[#F8FAFC] dark:bg-transparent">
      <div className="flex w-full flex-col gap-4 p-3 sm:p-4">
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={openSidebar} aria-label="Open menu" className="grid h-10 w-10 place-items-center rounded-xl border-[0.5px] border-slate-200 bg-white text-slate-600 lg:hidden dark:border-white/10 dark:bg-white/5 dark:text-slate-300"><Menu size={18} /></button>
            <div>
              <h1 className="font-display text-[22px] font-bold tracking-tight text-ink">{greeting}, Admin 👋</h1>
              <p className="text-[13px] text-muted">
                {periodIsDefault && periodMode === 'day'
                  ? "Here's what's happening with your portfolio today."
                  : `Showing collections & profit for ${periodLabel}.`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <PeriodFilter
              mode={periodMode}
              dateISO={periodDate}
              rangeKey={periodRange}
              onModeChange={setPeriodMode}
              onDateChange={setPeriodDate}
              onRangeSelect={applyRangePreset}
              onReset={resetPeriod}
            />
          </div>
        </div>

        {/* SECTION 1 — Portfolio Summary (5 KPI cards) */}
        {/* 7 cards in ONE row from xl up. Tighter gap at that breakpoint so
            seven cards fit without the values wrapping. */}
        {/* 10 cards in a clean 5 x 2 at xl. Seven-across truncated the rupee
            figures, so the strip steps 2 → 3 → 5; each breakpoint divides the
            count evenly, which keeps the rows balanced rather than ragged. */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5 xl:gap-3">
          {kpisView.map((k) => <KpiCard key={k.label} {...k} />)}
        </div>

        {/* SECTION 2 — Business Performance (2 columns: Cash Flow left, Loan Performance right) */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* flex column + flex-1 wrapper: the chart stretches to the full card
              height (the row's height is set by the taller right card), instead
              of leaving dead space under the plot. min-h keeps it sane when the
              grid collapses to one column on mobile. */}
          <ChartCard className="flex flex-col" title="Cash Flow Trend" subtitle={`(${cashRange === 'month' ? 'This Month' : cashRange === '3m' ? 'Last 3 Months' : cashRange === '6m' ? 'Last 6 Months' : 'Last 12 Months'})`} right={<RangeToggle value={cashRange} onChange={setCashRange} />}>
            <div className="min-h-[320px] flex-1">
              <CashFlowChart data={cashFlowView} height="100%" />
            </div>
          </ChartCard>

          <ChartCard title="Loan Performance" subtitle={`(${perfRange === 'month' ? 'This Month' : perfRange === '3m' ? 'Last 3 Months' : perfRange === '6m' ? 'Last 6 Months' : 'Last 12 Months'})`} right={<RangeToggle value={perfRange} onChange={setPerfRange} />}>
            <LoanPerformanceChart data={loanPerfView} />
            <div className="mt-3 grid grid-cols-3 gap-3 border-t border-slate-100 pt-3 dark:border-white/[.06]">
              <Summary label="Active" value={String(activeCount)} color="text-indigo-600 dark:text-indigo-400" />
              <Summary label="Overdue" value={String(overdueCount)} color="text-amber-600 dark:text-amber-400" />
              <Summary label="Closed" value={String(closedCount)} color="text-emerald-600 dark:text-emerald-400" />
            </div>
          </ChartCard>
        </div>

        {/* SECTION 3 — Operations (table 70% + gauge 30%) */}
        {/* items-start: grid stretches children to equal height by default, so
            this row forced the Overdue card to match the (taller) Efficiency
            gauge beside it — the empty space under a short list was stretch,
            not padding. Each card now sizes to its own content. */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
          {/* Overdue Loans — grows to fit its rows, scrolls only past ~6.
              Padding and hover match ChartCard so the dashboard reads as one
              system rather than this card being visibly different. */}
          <div className="flex flex-col rounded-2xl border-[0.5px] border-slate-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(17,24,39,.04)] transition-all duration-200 hover:shadow-[0_8px_28px_-14px_rgba(17,24,39,.18)] dark:border-white/[.08] dark:bg-surface">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              {/* The badge counts the WHOLE book, not the 6 rows below it.
                  Previously it read `overdueView.length`, which is capped at 6,
                  so a portfolio with 43 overdue loans showed "6" here while the
                  KPI tile above showed 43 — two numbers for one fact. */}
              <h3 className="text-[15px] font-bold tracking-tight text-ink">
                Overdue Loans
                {overdueAll.length > 0 && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 align-middle text-[11px] font-bold text-red-600 dark:bg-red-500/15 dark:text-red-400">
                    {overdueAll.length}
                  </span>
                )}
              </h3>
              {/* Search / View all. Two things this header deliberately does
                  NOT carry: a "Call" button (it could only ever dial whichever
                  loan sorted first — a row action masquerading as a bulk one),
                  and a risk dropdown (risk is derivable by typing "high" into
                  the search, and the dropdown cost ~130px of a header that has
                  to fit inside 7/10 of the content width). */}
              <div className="flex items-center gap-2">
                {/* Expanding search: an icon until clicked, then a 208px field.
                    One element throughout — the width transitions rather than
                    the input mounting — so focus is never lost mid-animation
                    and the header never reflows in a jump. */}
                <div
                  className={`flex h-9 items-center overflow-hidden rounded-xl border-[0.5px] transition-all duration-200 ${
                    overdueSearchOpen
                      ? 'w-52 gap-2 border-slate-200/80 bg-white px-3 focus-within:border-indigo-400 dark:border-white/[.08] dark:bg-surface'
                      : 'w-9 border-transparent bg-transparent'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => { setOverdueSearchOpen(true); requestAnimationFrame(() => overdueSearchRef.current?.focus()); }}
                    // Once open the glyph is decoration, not a control, and
                    // must be inert: a click on it would blur the input, whose
                    // onBlur collapses the field, which then races the refocus
                    // above. Disabled also drops it from the tab order.
                    disabled={overdueSearchOpen}
                    aria-label="Search overdue loans"
                    aria-expanded={overdueSearchOpen}
                    title="Search"
                    className={`grid shrink-0 place-items-center text-muted transition-colors ${
                      overdueSearchOpen
                        ? 'h-9 w-4 cursor-default text-slate-400'
                        : 'h-full w-full rounded-xl hover:bg-slate-100 hover:text-ink dark:hover:bg-white/[.08]'
                    }`}
                  >
                    <Search size={15} />
                  </button>
                  {/* flex-1 in a w-9 box that the button already fills leaves
                      the input at 0px when collapsed — no extra state needed to
                      hide it, and overflow-hidden clips the caret. */}
                  <input
                    ref={overdueSearchRef}
                    value={overdueQuery}
                    onChange={(e) => setOverdueQuery(e.target.value)}
                    // Collapse only when it is empty: closing on a live query
                    // would silently un-filter the table behind the user.
                    onBlur={() => { if (!overdueQuery.trim()) setOverdueSearchOpen(false); }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Escape') return;
                      // Stop the card's Escape here — otherwise it would also
                      // reach any dialog above and close that too.
                      e.stopPropagation();
                      setOverdueQuery('');
                      setOverdueSearchOpen(false);
                    }}
                    placeholder="Search customer, loan…"
                    tabIndex={overdueSearchOpen ? 0 : -1}
                    aria-hidden={!overdueSearchOpen}
                    className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-muted"
                  />
                </div>
                {/* Opens the full paginated list. The card is a top-6 triage
                    preview, so this is how the rest of the book is reached —
                    the Loans page is still one click away from the sidebar, and
                    from each row's "Open ledger". */}
                {overdueAll.length > 0 && (
                  <button
                    onClick={() => setOverdueAllOpen(true)}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2 text-[13px] font-semibold transition-opacity hover:opacity-80"
                    style={{ color: C.primary }}
                  >
                    View all {overdueAll.length > 6 && <span className="tabular-nums">({overdueAll.length})</span>}
                    <ArrowRight size={14} className="shrink-0" />
                  </button>
                )}
              </div>
            </div>

            {overdueView.length === 0 ? (
              // A clean book is good news, so this state is compact and calm —
              // it no longer reserves 340px of blank card to say "nothing here".
              <div className="grid place-items-center py-12 text-center">
                <div>
                  <div className="mx-auto mb-2.5 grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-500 ring-1 ring-emerald-100 dark:bg-emerald-500/15 dark:ring-emerald-500/20"><HandCoins size={22} /></div>
                  <p className="text-[13.5px] font-semibold text-ink">No overdue loans</p>
                  <p className="mt-0.5 text-[12px] text-muted">Every active loan is on schedule.</p>
                </div>
              </div>
            ) : (
              // max-h, not a fixed h: with one or two overdue loans a fixed
              // 340px reserved the full box and left a large empty void under
              // the rows — the "so much gap" this card was showing. It now
              // grows to its content and only scrolls past ~6 rows.
              // Borderless: the card already frames this content, and a third
              // nested box (card > container > table) read as clutter.
              <div className="overflow-x-auto overscroll-contain sm:max-h-[340px] sm:overflow-auto">
                {/* Column count is kept low so this card (7/10 of the content
                    width, ~700px at 1280) needs as little horizontal scroll as
                    possible: the loan id lives in the customer cell (they
                    identify the same record) and the risk pill lives with the
                    day count (risk IS a band of days, so two columns said one
                    thing twice).

                    The min-w still matters: table-fixed will happily squeeze a
                    column below its content, and at 14% the Actions column
                    (~98px) could not hold the kebab AND the Call button
                    (~114px) — that cell overflowed its track and pushed every
                    column left of it out of line with the sticky header. The
                    widths below give Actions room; the min-w + the scrolling
                    parent stop a narrow viewport from taking it away again. */}
                <table className="w-full min-w-[620px] table-fixed text-sm sm:min-w-[820px]">
                  <colgroup>
                    <col className="w-[34%] sm:w-[22%]" />{/* Customer + loan id */}
                    <col className="hidden sm:table-column sm:w-[15%]" />{/* Loan type + since when */}
                    <col className="w-[26%] sm:w-[16%]" />{/* Overdue amount */}
                    <col className="hidden md:table-column md:w-[15%]" />{/* Outstanding */}
                    <col className="w-[18%] sm:w-[14%]" />{/* Overdue period: days + risk */}
                    <col className="w-[22%] sm:w-[18%]" />{/* Actions */}
                  </colgroup>
                  {/* Sticky header needs its own opaque background AND a hairline
                      shadow, or scrolled rows appear to bleed through it. */}
                  <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_rgba(17,24,39,.06)] dark:bg-surface dark:shadow-[0_1px_0_rgba(255,255,255,.08)]">
                    {/* Header alignment MUST mirror the body cells below:
                        money and Days Overdue right, Status centred, Actions
                        right. Previously Due Amount/Actions were right-aligned
                        in the header only, so nothing lined up. */}
                    <tr className="border-b-2 border-slate-200 bg-gradient-to-b from-slate-50 to-slate-100/60 text-[10.5px] font-bold uppercase tracking-[0.09em] text-slate-600 dark:border-white/[.10] dark:from-white/[.05] dark:to-white/[.02] dark:text-slate-300">
                      <th className="whitespace-nowrap rounded-l-lg px-3 py-2 text-left font-bold">Customer</th>
                      <th className="hidden whitespace-nowrap px-3 py-2 text-left font-bold sm:table-cell">Loan</th>
                      <th className="whitespace-nowrap px-3 py-2 text-right font-bold">Overdue Amount</th>
                      <th className="hidden whitespace-nowrap px-3 py-2 text-right font-bold md:table-cell">Outstanding</th>
                      <th className="whitespace-nowrap px-3 py-2 text-right font-bold">Overdue Period</th>
                      <th className="whitespace-nowrap rounded-r-lg px-3 py-2 text-right font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdueFiltered.length === 0 ? (
                      <tr><td colSpan={6} className="py-16 text-center text-[13px] text-muted">No loans match &quot;{overdueQuery}&quot;.</td></tr>
                    ) : overdueFiltered.map((r) => {
                      const risk = riskFor(r.days);
                      const callHref = r.mobile ? telHref(r.mobile) : null;
                      const waHref = r.mobile
                        ? whatsappHref(r.mobile, overdueWhatsAppMessage({
                          customer: r.customer, loanNo: r.loanNo, type: r.type,
                          due: r.due, days: r.days, dueSince: fmtDate(r.dueSince),
                        }))
                        : null;
                      return (
                        <tr key={r.id} className="border-b border-slate-100/70 transition-colors last:border-0 hover:bg-slate-50 dark:border-white/[.04] dark:hover:bg-white/[.03]">
                          {/* Customer + loan id stacked: they identify the same
                              record, so one cell reads as one thing. min-w-0 +
                              truncate keeps a long name from widening the table. */}
                          <td className="px-3 py-2.5">
                            {/* Avatar tinted by risk: the row's severity reads
                                from the left edge before any number is parsed. */}
                            <div className="flex items-center gap-2.5">
                              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold ${AVATAR_TINT[risk]}`}>{r.customer.split(' ').map((x) => x[0]).slice(0, 2).join('')}</span>
                              <div className="min-w-0 leading-tight">
                                <div className="truncate font-semibold text-ink" title={r.customer}>{r.customer}</div>
                                <div className="truncate font-mono text-[11px] text-muted">{r.loanNo}</div>
                              </div>
                            </div>
                          </td>
                          {/* Loan type + when the arrears began. Both were already
                              computed for the WhatsApp/PDF notice but never shown,
                              so the table had a wide empty gap where a collector
                              needs context: WHICH product, and overdue SINCE when. */}
                          <td className="hidden px-3 py-2.5 sm:table-cell">
                            <div className="min-w-0 leading-tight">
                              <div className="truncate text-[12.5px] text-ink" title={r.type}>{r.type}</div>
                              <div className="truncate text-[11px] text-muted">since {fmtDate(r.dueSince)}</div>
                            </div>
                          </td>
                          {/* Overdue Amount — what is overdue right now (red: it
                              is the number being chased). */}
                          <td className="px-3 py-2.5 text-right font-bold tabular-nums text-red-600 dark:text-red-400">{inr(r.due)}</td>
                          {/* Outstanding — total still owed. Gives the overdue
                              amount scale: 3,500 overdue on a 94,000 balance is a
                              different conversation from one on 7,000. */}
                          <td className="hidden px-3 py-2.5 text-right tabular-nums text-muted md:table-cell">{inr(r.outstanding)}</td>
                          {/* Overdue Period — days overdue + its risk band. Risk
                              is DERIVED from the day count (riskFor), so showing
                              them apart stated one fact in two columns. The pill
                              keeps the colour cue. */}
                          <td className="px-3 py-2.5 text-right">
                            <div className="font-semibold tabular-nums text-red-600 dark:text-red-400">{r.days}d</div>
                            <span className={`mt-0.5 inline-flex rounded-full px-1.5 py-px text-[10px] font-bold ${RISK_PILL[risk]}`}>{risk.replace(' Risk', '')}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            {/* ONE kebab at every size. Four inline icons need
                                ~120px and the actions column never exceeds ~99px
                                — not even on a laptop — so the row was cramped
                                everywhere, and the icons were unlabelled. A menu
                                keeps every action reachable, named, and gives a
                                comfortable touch target on tablets. */}
                            <div
                              className="flex items-center justify-end gap-1.5"
                              onKeyDown={(e) => {
                                if (e.key === 'Escape' && overdueMenu === r.id) {
                                  e.stopPropagation();
                                  setOverdueMenu(null);
                                  (e.currentTarget.querySelector('button') as HTMLElement | null)?.focus();
                                }
                              }}
                            >
                              <button
                                onClick={(e) => {
                                  if (overdueMenu === r.id) { setOverdueMenu(null); return; }
                                  // Measure the trigger so the portal can sit under
                                  // it. Flips upward when the menu would run past
                                  // the viewport bottom (last row of a long list).
                                  const b = e.currentTarget.getBoundingClientRect();
                                  const MENU_H = 200;
                                  const below = window.innerHeight - b.bottom;
                                  setMenuPos({
                                    top: below < MENU_H ? b.top - MENU_H - 4 : b.bottom + 4,
                                    right: window.innerWidth - b.right,
                                  });
                                  setOverdueMenu(r.id);
                                }}
                                title="Actions"
                                aria-label={`Actions for ${r.customer}`}
                                aria-haspopup="menu"
                                aria-expanded={overdueMenu === r.id}
                                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-slate-100 hover:text-ink dark:hover:bg-white/[.08]"
                              >
                                <MoreVertical size={16} />
                              </button>
                              {overdueMenu === r.id && createPortal(
                                <>
                                  {/* Tap-away dismissal (a phone has no Escape key). */}
                                  <div className="fixed inset-0 z-[290]" onClick={() => setOverdueMenu(null)} aria-hidden />
                                  <div role="menu" aria-label={`Actions for ${r.customer}`} style={{ top: menuPos.top, right: menuPos.right }} className="fixed z-[300] w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-[0_12px_32px_rgba(30,39,64,.18)] dark:border-white/[.12] dark:bg-slate-900">
                                    <button role="menuitem" onClick={() => { setOverdueMenu(null); navigate(`/loans?ledger=${encodeURIComponent(r.loanNo)}`); }} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-ink hover:bg-slate-50 dark:hover:bg-white/[.06]">
                                      <Eye size={15} className="shrink-0 text-muted" /> Open ledger
                                    </button>
                                    {callHref && (
                                      <a role="menuitem" href={callHref} onClick={() => setOverdueMenu(null)} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-ink hover:bg-slate-50 dark:hover:bg-white/[.06]">
                                        <Phone size={15} className="shrink-0 text-emerald-600" /> Call {r.mobile}
                                      </a>
                                    )}
                                    <button role="menuitem" onClick={() => { setOverdueMenu(null); sendOverdueNotice(r); }} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-ink hover:bg-slate-50 dark:hover:bg-white/[.06]">
                                      <FileDown size={15} className="shrink-0 text-rose-600" /> Send notice (PDF)
                                    </button>
                                    {waHref && (
                                      <a role="menuitem" href={waHref} target="_blank" rel="noopener noreferrer" onClick={() => setOverdueMenu(null)} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-ink hover:bg-slate-50 dark:hover:bg-white/[.06]">
                                        <WhatsAppIcon size={15} /> WhatsApp
                                      </a>
                                    )}
                                  </div>
                                </>,
                                document.body,
                              )}
                              {/* telHref already yields `tel:<digits>` — the old
                                  re-prefix produced href="tel:undefined" for a
                                  customer with no mobile on file. Same height as
                                  the kebab so the pair sits on one baseline; the
                                  label drops below sm where the column is
                                  narrowest and the icon alone is unambiguous. */}
                              {callHref && (
                                <a
                                  href={callHref}
                                  aria-label={`Call ${r.customer}`}
                                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border-[0.5px] border-emerald-400 bg-emerald-50 px-2.5 text-[12px] font-semibold text-emerald-600 transition-colors hover:bg-emerald-100 dark:border-emerald-500/15 dark:bg-emerald-500/15 dark:text-emerald-400 dark:hover:bg-white/[.08]"
                                >
                                  <Phone size={15} className="shrink-0" />
                                  <span className="hidden sm:inline">Call</span>
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {/* Says plainly that the card is a preview, and how much is hidden.
                (The old footer here was gated on `overdueView.length > 6`,
                which could never be true — the list was already sliced to 6 —
                so this line never rendered.) */}
            {overdueAll.length > overdueView.length && (
              <div className="mt-3 border-t border-slate-100 pt-3 text-center dark:border-white/[.06]">
                <button
                  onClick={() => setOverdueAllOpen(true)}
                  className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold transition-opacity hover:opacity-80"
                  style={{ color: C.primary }}
                >
                  Showing the {overdueView.length} most overdue · View all {overdueAll.length}
                  <ArrowRight size={14} />
                </button>
              </div>
            )}
          </div>

          {/* Collection Efficiency gauge */}
          <div className="flex flex-col rounded-2xl border-[0.5px] border-slate-200/80 bg-white p-6 shadow-[0_1px_3px_rgba(17,24,39,.04)] dark:border-white/[.08] dark:bg-surface">
            <h3 className="mb-2 text-[15px] font-bold tracking-tight text-ink">Collection Efficiency</h3>
            <EfficiencyGauge pct={efficiencyView} />
            <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 dark:bg-white/[.03]">
              <GaugeStat label="Interest" value={inrShort(periodProfit)} color="text-emerald-600 dark:text-emerald-400" />
              <GaugeStat label="Expenses" value={inrShort(periodExp)} color="text-red-500 dark:text-red-400" />
              {/* Profit is NET (interest − expenses); previously this repeated
                  the interest figure, so two of the three tiles were identical. */}
              <GaugeStat label="Profit" value={inrShort(netPeriodProfit)} color={netPeriodProfit < 0 ? 'text-red-500 dark:text-red-400' : 'text-indigo-600 dark:text-indigo-400'} />
            </div>
            {canView('Reports') && (
              <button onClick={() => navigate('/reports')} className="mt-4 inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold" style={{ color: C.primary }}>View Collection Reports <ArrowRight size={14} /></button>
            )}
          </div>
        </div>

        <p className="pb-2 text-center text-[12px] text-muted">All amounts are in INR</p>
      </div>

      {/* Full overdue book — searchable, filterable by loan type, paginated.
          Purely a view over `overdueAll`: the row actions below are the SAME
          handlers the card uses, so nothing here can diverge from it. */}
      <OverdueLoansDialog
        open={overdueAllOpen}
        onClose={() => setOverdueAllOpen(false)}
        rows={overdueAll}
        // Close first: navigating with the modal still mounted would drop the
        // user onto /loans underneath an overlay they cannot see past.
        onOpenLedger={(r) => { setOverdueAllOpen(false); navigate(`/loans?ledger=${encodeURIComponent(r.loanNo)}`); }}
        // The dialog is handed the narrow row type, so re-attach the full record
        // (it carries `loan`, which the notice needs to itemise instalments).
        onSendNotice={(r) => {
          const full = overdueAll.find((x) => x.id === r.id);
          if (full) return sendOverdueNotice(full);
        }}
        telHrefFor={(r) => (r.mobile ? telHref(r.mobile) : null)}
        waHrefFor={(r) => (r.mobile
          ? whatsappHref(r.mobile, overdueWhatsAppMessage({
            customer: r.customer, loanNo: r.loanNo, type: r.type,
            due: r.due, days: r.days, dueSince: fmtDate(r.dueSince),
          }))
          : null)}
      />
    </div>
  );
}

function Summary({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="text-[11.5px] font-medium text-muted">{label}</div>
      <div className={`font-display text-[17px] font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function GaugeStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center">
      <div className={`font-display text-[15px] font-bold tabular-nums ${color}`}>{value}</div>
      <div className="mt-0.5 text-[10.5px] text-muted">{label}</div>
    </div>
  );
}
