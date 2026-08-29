import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  useData, LOAN_LABELS, isDailyLoan, behavesInterestOnly, type Loan,
} from '@/mock/DataContext';
import { inr, inrShort, fmtDate, todayISO, isoLocal } from '@/lib/format';
import { whatsappHref } from '@/lib/whatsapp';
import { usePermissions } from '@/lib/permissions';
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
import {
  Wallet, CalendarClock, IndianRupee, TrendingUp, Menu, Landmark, PiggyBank,
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

/** Official-style WhatsApp glyph (Lucide has no brand icons). */
function WhatsAppIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.52 3.48A11.86 11.86 0 0012.01 0C5.4 0 .04 5.36.04 11.96c0 2.11.55 4.17 1.6 5.99L0 24l6.2-1.62a11.94 11.94 0 005.8 1.48h.01c6.6 0 11.96-5.36 11.96-11.96 0-3.19-1.24-6.19-3.45-8.42zM12.01 21.8h-.01a9.9 9.9 0 01-4.99-1.36l-.36-.21-3.68.91.98-3.59-.23-.37a9.86 9.86 0 01-1.51-4.95c0-5.45 4.44-9.88 9.9-9.88 2.64 0 5.12 1.03 6.99 2.9a9.82 9.82 0 012.9 6.98c0 5.45-4.44 9.87-9.89 9.87zm5.43-7.4c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.65.08-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.87 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.7.31 1.26.49 1.69.63.71.23 1.36.19 1.87.12.57-.08 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z" />
    </svg>
  );
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

type Risk = 'High Risk' | 'Medium Risk' | 'Low Risk';
const RISK_PILL: Record<Risk, string> = {
  'High Risk': 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  'Medium Risk': 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  'Low Risk': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
};
const riskFor = (days: number): Risk => (days > 20 ? 'High Risk' : days > 10 ? 'Medium Risk' : 'Low Risk');
/** Avatar tint per risk band — softer than the pill (it sits behind initials, so
 *  it must not fight the name for attention) but in the same hue family, so the
 *  row's severity is legible from the left edge. */
const AVATAR_TINT: Record<Risk, string> = {
  'High Risk': 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300',
  'Medium Risk': 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  'Low Risk': 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
};

export default function Dashboard() {
  const d = useData();
  const navigate = useNavigate();
  const openSidebar = useOpenSidebar();
  const { canView } = usePermissions();
  const [overdueQuery, setOverdueQuery] = useState('');
  // Row whose mobile ⋮ menu is open (phones only — desktop shows the icon row).
  const [overdueMenu, setOverdueMenu] = useState<number | null>(null);
  // Screen coords for the portalled menu (see the trigger's onClick).
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const [cashRange, setCashRange] = useState<Range>('month');
  const [perfRange, setPerfRange] = useState<Range>('6m');
  // Period filter — day defaults to today; month to current calendar month;
  // 'range' scopes the KPIs to a quick-range preset AND drives both chart
  // toggles to the same window, so the whole dashboard describes one period.
  const [periodMode, setPeriodMode] = useState<PeriodMode>('day');
  const [periodDate, setPeriodDate] = useState(todayISO);
  const [periodRange, setPeriodRange] = useState<PeriodRangeKey>('month');

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
  // Cash currently out with borrowers, capped at the capital raised so the
  // "lent out" hint never exceeds the capital it describes.
  const deployedCapital = Math.min(totalOutstanding, investorCapital);

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
  const dueTodayLoans = active.filter((l) => d.nextDueFor(l) === today);
  const dueToday = dueTodayLoans.reduce((s, l) => s + dueFor(l), 0);

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
      hint: investorCapital > 0 ? `${inr(deployedCapital)} lent out` : 'No investor capital', trend: null as KpiTrend | null,
      onClick: () => navigate('/investments'), actionLabel: `Investor capital ${inr(investorCapital)} — view investors` },
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
      onClick: () => navigate('/investments'), actionLabel: `Available funds ${inr(funds.available)} — view investors` },
    { icon: Wallet, tint: 'bg-indigo-50 dark:bg-indigo-500/15', iconColor: 'text-indigo-600 dark:text-indigo-400', label: 'Total Outstanding', value: inr(totalOutstanding),
      hint: 'Across active loans', trend: null,
      onClick: () => navigate('/loans?status=ACTIVE'), actionLabel: `Total outstanding ${inr(totalOutstanding)} — view active loans` },
    // Links to the Loans page's 'today' bucket — the SAME strictly-today set
    // this card counts, so the list matches the figure exactly.
    { icon: CalendarClock, tint: 'bg-amber-50 dark:bg-amber-500/15', iconColor: 'text-amber-600 dark:text-amber-400', label: 'Due Today', value: inr(dueToday), hint: `${dueTodayLoans.length} loan${dueTodayLoans.length === 1 ? '' : 's'}`, trend: null,
      onClick: () => navigate('/loans?status=ACTIVE&urgency=today'), actionLabel: `Due today ${inr(dueToday)} — view the ${dueTodayLoans.length} loan${dueTodayLoans.length === 1 ? '' : 's'} due today` },
    { icon: IndianRupee, tint: 'bg-emerald-50 dark:bg-emerald-500/15', iconColor: 'text-emerald-600 dark:text-emerald-400', label: 'Collections', value: inr(periodColl), hint: periodMode === 'day' ? periodLabel : `${periodLabel} · all-time ${inr(totalCollected)}`, trend: null,
      onClick: () => navigate('/reports?tab=collections'), actionLabel: `Collections ${inr(periodColl)} — view the collections report` },
    // NET profit — interest earned in the period LESS the expenses paid in it.
    // Can be negative in a month with heavy costs; shown as-is (never clamped),
    // because hiding a loss would misreport the business.
    { icon: TrendingUp, tint: 'bg-emerald-50 dark:bg-emerald-500/15', iconColor: 'text-emerald-600 dark:text-emerald-400', label: 'Profit', value: inr(netPeriodProfit),
      hint: `${inr(periodProfit)} interest − ${inr(periodExp)} expenses`,
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
  const overdueRows = useMemo(() => active
    .filter(isOverdue)
    .map((l) => {
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
        // Total still owed on the loan — the arrears figure alone does not say
        // how big the exposure is (a 3,500 EMI arrear on a 94,000 balance reads
        // very differently from one on a 7,000 balance).
        outstanding: d.outstandingFor(l),
        loan: l, // carried so the notice can itemise the unpaid instalments
        mobile: (l.contact || cust?.mobile || '').trim(),
      };
    })
    .sort((a, b) => b.days - a.days)
    .slice(0, 6),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, d, today]);

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
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-7 xl:gap-3">
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
              <h3 className="text-[15px] font-bold tracking-tight text-ink">
                Overdue Loans
                {overdueView.length > 0 && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 align-middle text-[11px] font-bold text-red-600 dark:bg-red-500/15 dark:text-red-400">
                    {overdueView.length}
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-2.5">
                <div className="flex w-52 items-center gap-2 rounded-xl border-[0.5px] border-slate-200/80 bg-white px-3 py-1.5 focus-within:border-indigo-400 dark:border-white/[.08] dark:bg-surface">
                  <Search size={15} className="shrink-0 text-slate-400" />
                  <input value={overdueQuery} onChange={(e) => setOverdueQuery(e.target.value)} placeholder="Search customer, loan…" className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-muted" />
                </div>
                <button onClick={() => navigate('/loans')} className="hidden text-[13px] font-semibold sm:inline" style={{ color: C.primary }}>View all</button>
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
              <div className="overscroll-contain sm:max-h-[340px] sm:overflow-auto">
                {/* This card is 7/10 of the content width (~700px at 1280), so a
                    760px min-width guaranteed a horizontal scrollbar on every
                    screen. Four columns instead of six fixes that at the source:
                    the loan id joins the customer cell (they identify the same
                    thing) and the risk pill joins the days count (risk IS a band
                    of days, so two columns said one thing twice). */}
                <table className="w-full table-fixed text-sm sm:min-w-[700px]">
                  <colgroup>
                    <col className="w-[38%] sm:w-[26%]" />{/* Customer + loan id */}
                    <col className="hidden sm:table-column sm:w-[17%]" />{/* Loan type + since when */}
                    <col className="w-[26%] sm:w-[15%]" />{/* Arrears */}
                    <col className="hidden md:table-column md:w-[15%]" />{/* Outstanding */}
                    <col className="w-[18%] sm:w-[13%]" />{/* Overdue: days + risk */}
                    <col className="w-[18%] sm:w-[14%]" />{/* Actions */}
                  </colgroup>
                  {/* Sticky header needs its own opaque background AND a hairline
                      shadow, or scrolled rows appear to bleed through it. */}
                  <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_rgba(17,24,39,.06)] dark:bg-surface dark:shadow-[0_1px_0_rgba(255,255,255,.08)]">
                    {/* Header alignment MUST mirror the body cells below:
                        money and Days Overdue right, Status centred, Actions
                        right. Previously Due Amount/Actions were right-aligned
                        in the header only, so nothing lined up. */}
                    <tr className="border-b-2 border-slate-200 bg-gradient-to-b from-slate-50 to-slate-100/60 text-[10.5px] font-bold uppercase tracking-[0.09em] text-slate-600 dark:border-white/[.10] dark:from-white/[.05] dark:to-white/[.02] dark:text-slate-300">
                      <th className="rounded-l-lg px-3 py-2 text-left font-bold">Customer</th>
                      <th className="hidden px-3 py-2 text-left font-bold sm:table-cell">Loan</th>
                      <th className="px-3 py-2 text-right font-bold">Arrears</th>
                      <th className="hidden px-3 py-2 text-right font-bold md:table-cell">Outstanding</th>
                      <th className="px-3 py-2 text-right font-bold">Overdue</th>
                      <th className="rounded-r-lg px-3 py-2 text-right font-bold">Actions</th>
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
                          {/* Arrears — what is overdue right now (red: it is the
                              number being chased). */}
                          <td className="px-3 py-2.5 text-right font-bold tabular-nums text-red-600 dark:text-red-400">{inr(r.due)}</td>
                          {/* Outstanding — total still owed. Gives the arrears
                              figure scale: a 3,500 arrear on 94,000 outstanding is
                              a different conversation from one on 7,000. */}
                          <td className="hidden px-3 py-2.5 text-right tabular-nums text-muted md:table-cell">{inr(r.outstanding)}</td>
                          {/* Days overdue + its risk band. Risk is DERIVED from the
                              day count (riskFor), so showing them apart stated one
                              fact in two columns. The pill keeps the colour cue. */}
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
                              className="relative flex justify-end"
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
                                className="grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-slate-100 hover:text-ink dark:hover:bg-white/[.08]"
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
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {/* Only when the list is scrollable — otherwise it repeats the
                header's "View all" for no reason. */}
            {overdueView.length > 6 && (
              <div className="mt-3 border-t border-slate-100 pt-3 text-center dark:border-white/[.06]">
                <button onClick={() => navigate('/loans')} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold transition-opacity hover:opacity-80" style={{ color: C.primary }}>View all {overdueView.length} overdue loans <ArrowRight size={14} /></button>
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
