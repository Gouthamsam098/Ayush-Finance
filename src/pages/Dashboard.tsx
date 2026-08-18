import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useData, LOAN_LABELS, isDailyLoan, behavesInterestOnly, type Loan,
} from '@/mock/DataContext';
import { inr, inrShort, todayISO, isoLocal } from '@/lib/format';
import { usePermissions } from '@/lib/permissions';
import { useOpenSidebar } from '@/components/layout/AppShell';
import {
  ChartCard, KpiCard, LoanPerformanceChart, CashFlowChart, EfficiencyGauge, RangeToggle, C,
  type LoanPerfPoint, type CashFlowPoint, type KpiTrend, type Range,
} from '@/components/dashboard/Charts';
import {
  PeriodFilter, type PeriodMode, periodDisplayLabel, isPeriodDefault,
} from '@/components/dashboard/PeriodFilter';
import {
  Wallet, CalendarClock, IndianRupee, Gauge, TrendingUp, Menu,
  Phone, Eye, HandCoins, ArrowRight, Search, Receipt,
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
 * Normalise an Indian mobile to E.164 digits without '+' for WhatsApp (wa.me).
 * Works on phone/tablet (opens WhatsApp app) and desktop (app or WhatsApp Web).
 */
function whatsappDigits(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits;
}

function whatsappHref(raw: string, message: string): string | null {
  const digits = whatsappDigits(raw);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function overdueWhatsAppMessage(customerName: string, dueAmount: number): string {
  return `Hi *${customerName}*, this is a reminder from Anush Finserv regarding your overdue loan. Your total due amount till date is *${inr(dueAmount)}*. Please clear the dues at the earliest. Thank you.`;
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

export default function Dashboard() {
  const d = useData();
  const navigate = useNavigate();
  const openSidebar = useOpenSidebar();
  const { canView } = usePermissions();
  const [overdueQuery, setOverdueQuery] = useState('');
  const [cashRange, setCashRange] = useState<Range>('month');
  const [perfRange, setPerfRange] = useState<Range>('6m');
  // Period filter — day defaults to today; month to current calendar month.
  const [periodMode, setPeriodMode] = useState<PeriodMode>('day');
  const [periodDate, setPeriodDate] = useState(todayISO);

  const active = d.loans.filter((l) => l.status === 'ACTIVE');
  const today = todayISO();
  const thisMonth = today.slice(0, 7);
  const periodKey = periodDate.slice(0, 7);
  const [ly, lm] = thisMonth.split('-').map(Number);
  const lastMonthKey = `${lm === 1 ? ly - 1 : ly}-${String(lm === 1 ? 12 : lm - 1).padStart(2, '0')}`;

  const resetPeriod = () => {
    setPeriodMode('day');
    setPeriodDate(todayISO());
  };

  const dueFor = (l: Loan) => (isDailyLoan(l.type) ? d.totalDueForDaily(l) : d.totalDueForMonthly(l));
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
  const totalOutstanding = active.reduce((s, l) => s + d.outstandingFor(l), 0);

  // Selected period (day or month) — drives Collections / Profit / Expenses KPIs.
  const periodColl = periodMode === 'day'
    ? d.collections.filter((c) => c.date === periodDate).reduce((s, c) => s + c.amount, 0)
    : collInMonth(periodKey);
  const periodExp = periodMode === 'day'
    ? d.expenses.filter((e) => e.date === periodDate).reduce((s, e) => s + e.amount, 0)
    : expInMonth(periodKey);

  const totalCollected = d.collections.reduce((s, c) => s + c.amount, 0); // all-time collections
  const dueTodayLoans = active.filter((l) => d.nextDueFor(l) === today);
  const dueToday = dueTodayLoans.reduce((s, l) => s + dueFor(l), 0);

  // Collection efficiency = collected ÷ (collected + still-due) this month.
  // NULL when there's no collection activity at all — showing "100%" with zero
  // collections is misleading, so we render "—" instead.
  const hasEfficiency = monthColl + monthDue > 0;
  const efficiency = hasEfficiency ? Math.round((monthColl / (monthColl + monthDue)) * 100) : null;
  const lastEff = (() => {
    const lc = lastColl; const denom = lc + monthDue;
    return lc > 0 ? Math.round((lc / (denom || lc)) * 100) : null;
  })();

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
  const periodProfit = periodMode === 'day'
    ? d.collections.reduce((s, c) => (c.date === periodDate ? s + (profitByCollectionId.get(c.id) ?? 0) : s), 0)
    : profitInMonth(periodKey);
  const monthInterest = profitInMonth(thisMonth);   // "Profit" this month (name kept for downstream use)
  const lastInterest = profitInMonth(lastMonthKey);
  const periodLabel = periodDisplayLabel(periodMode, periodDate);
  const periodIsDefault = isPeriodDefault(periodMode, periodDate, today);

  // ── Section 1 KPIs ──
  const kpis = [
    { icon: Wallet, tint: 'bg-indigo-50 dark:bg-indigo-500/15', iconColor: 'text-indigo-600 dark:text-indigo-400', label: 'Total Outstanding', value: inr(totalOutstanding), hint: 'Across active loans', trend: null as KpiTrend | null },
    { icon: CalendarClock, tint: 'bg-amber-50 dark:bg-amber-500/15', iconColor: 'text-amber-600 dark:text-amber-400', label: 'Due Today', value: inr(dueToday), hint: `${dueTodayLoans.length} loan${dueTodayLoans.length === 1 ? '' : 's'}`, trend: null },
    { icon: IndianRupee, tint: 'bg-emerald-50 dark:bg-emerald-500/15', iconColor: 'text-emerald-600 dark:text-emerald-400', label: 'Collections', value: inr(periodColl), hint: periodMode === 'day' ? periodLabel : `${periodLabel} · all-time ${inr(totalCollected)}`, trend: null },
    { icon: Gauge, tint: 'bg-blue-50 dark:bg-blue-500/15', iconColor: 'text-blue-600 dark:text-blue-400', label: 'Collection Efficiency', value: efficiency == null ? '—' : `${efficiency}%`, hint: efficiency == null ? 'No activity yet' : 'This month', trend: efficiency != null && lastEff != null ? trendOf(efficiency, lastEff) : null },
    { icon: TrendingUp, tint: 'bg-emerald-50 dark:bg-emerald-500/15', iconColor: 'text-emerald-600 dark:text-emerald-400', label: 'Profit', value: inr(periodProfit), hint: periodMode === 'day' ? `Realised on ${periodLabel}` : `Interest earned · ${periodLabel}`, trend: periodIsDefault ? trendOf(monthInterest, lastInterest) : null },
    { icon: Receipt, tint: 'bg-rose-50 dark:bg-rose-500/15', iconColor: 'text-rose-600 dark:text-rose-400', label: 'Expenses', value: inr(periodExp), hint: periodLabel, trend: periodIsDefault && periodMode === 'month' ? trendOf(monthExp, lastExp) : null },
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
        type: LOAN_LABELS[l.type],
        mobile: (l.contact || cust?.mobile || '').trim(),
      };
    })
    .sort((a, b) => b.days - a.days)
    .slice(0, 6),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, d, today]);

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
              onModeChange={setPeriodMode}
              onDateChange={setPeriodDate}
              onReset={resetPeriod}
            />
          </div>
        </div>

        {/* SECTION 1 — Portfolio Summary (5 KPI cards) */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
          {/* Overdue Loans table — fixed height, internal scroll, searchable */}
          <div className="flex flex-col rounded-2xl border-[0.5px] border-slate-200/80 bg-white p-6 shadow-[0_1px_3px_rgba(17,24,39,.04)] dark:border-white/[.08] dark:bg-surface">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-[15px] font-bold tracking-tight text-ink">Overdue Loans</h3>
              <div className="flex items-center gap-2.5">
                <div className="flex w-52 items-center gap-2 rounded-xl border-[0.5px] border-slate-200/80 bg-white px-3 py-1.5 focus-within:border-indigo-400 dark:border-white/[.08] dark:bg-surface">
                  <Search size={15} className="shrink-0 text-slate-400" />
                  <input value={overdueQuery} onChange={(e) => setOverdueQuery(e.target.value)} placeholder="Search customer, loan…" className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-muted" />
                </div>
                <button onClick={() => navigate('/loans')} className="hidden text-[13px] font-semibold sm:inline" style={{ color: C.primary }}>View all</button>
              </div>
            </div>

            {overdueView.length === 0 ? (
              <div className="grid h-[340px] place-items-center text-center">
                <div>
                  <div className="mx-auto mb-2 grid h-11 w-11 place-items-center rounded-full bg-emerald-50 text-emerald-500 dark:bg-emerald-500/15"><HandCoins size={20} /></div>
                  <p className="text-[13.5px] font-medium text-ink">No overdue loans 🎉</p>
                  <p className="text-[12px] text-muted">Every active loan is on schedule.</p>
                </div>
              </div>
            ) : (
              <div className="h-[340px] overflow-auto rounded-xl border-[0.5px] border-slate-100 dark:border-white/[.05]">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="sticky top-0 z-10 bg-white dark:bg-surface">
                    <tr className="border-b border-slate-100 text-left text-[12px] font-medium uppercase tracking-wide text-muted dark:border-white/[.06]">
                      <th className="px-3 py-2.5">Customer</th><th className="px-3 py-2.5">Loan ID</th><th className="px-3 py-2.5 text-right">Due Amount</th><th className="px-3 py-2.5">Days Overdue</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdueFiltered.length === 0 ? (
                      <tr><td colSpan={6} className="py-16 text-center text-[13px] text-muted">No loans match "{overdueQuery}".</td></tr>
                    ) : overdueFiltered.map((r) => {
                      const risk = riskFor(r.days);
                      const callHref = r.mobile ? telHref(r.mobile) : null;
                      const waHref = r.mobile
                        ? whatsappHref(r.mobile, overdueWhatsAppMessage(r.customer, r.due))
                        : null;
                      return (
                        <tr key={r.id} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50/60 dark:border-white/[.04] dark:hover:bg-white/[.02]">
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2.5">
                              <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500 dark:bg-white/[.06] dark:text-slate-300">{r.customer.split(' ').map((x) => x[0]).slice(0, 2).join('')}</span>
                              <span className="font-medium text-ink">{r.customer}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 font-mono text-[12.5px] text-muted">{r.loanNo}</td>
                          <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">{inr(r.due)}</td>
                          <td className="px-3 py-3 font-semibold tabular-nums text-red-500">{r.days} days</td>
                          <td className="px-3 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-[11.5px] font-bold ${RISK_PILL[risk]}`}>{risk}</span></td>
                          <td className="px-3 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              <button onClick={() => navigate('/loans')} title="View" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-500/15"><Eye size={15} /></button>
                              <button onClick={() => navigate('/collections')} title="Collect" className="rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-white" style={{ background: C.primary }}>Collect</button>
                              {callHref ? (
                                <a
                                  href={callHref}
                                  title={`Call ${r.mobile}`}
                                  aria-label={`Call ${r.customer} at ${r.mobile}`}
                                  className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-500/15"
                                >
                                  <Phone size={15} />
                                </a>
                              ) : (
                                <button
                                  type="button"
                                  disabled
                                  title="No mobile on file"
                                  className="grid h-8 w-8 place-items-center rounded-lg text-muted/40 cursor-not-allowed"
                                >
                                  <Phone size={15} />
                                </button>
                              )}
                              {waHref ? (
                                <a
                                  href={waHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={`WhatsApp ${r.mobile}`}
                                  aria-label={`WhatsApp ${r.customer} at ${r.mobile}`}
                                  className="grid h-8 w-8 place-items-center rounded-lg text-[#25D366] hover:bg-[#25D366]/15 dark:hover:bg-[#25D366]/20"
                                >
                                  <WhatsAppIcon size={15} />
                                </a>
                              ) : (
                                <button
                                  type="button"
                                  disabled
                                  title="No mobile on file"
                                  className="grid h-8 w-8 place-items-center rounded-lg text-muted/40 cursor-not-allowed"
                                >
                                  <WhatsAppIcon size={15} />
                                </button>
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
            <div className="mt-4 text-center">
              <button onClick={() => navigate('/loans')} className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: C.primary }}>View all overdue loans <ArrowRight size={14} /></button>
            </div>
          </div>

          {/* Collection Efficiency gauge */}
          <div className="flex flex-col rounded-2xl border-[0.5px] border-slate-200/80 bg-white p-6 shadow-[0_1px_3px_rgba(17,24,39,.04)] dark:border-white/[.08] dark:bg-surface">
            <h3 className="mb-2 text-[15px] font-bold tracking-tight text-ink">Collection Efficiency</h3>
            <EfficiencyGauge pct={efficiencyView} />
            <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 dark:bg-white/[.03]">
              <GaugeStat label="Interest" value={inrShort(periodProfit)} color="text-emerald-600 dark:text-emerald-400" />
              <GaugeStat label="Expenses" value={inrShort(periodExp)} color="text-red-500 dark:text-red-400" />
              <GaugeStat label="Profit" value={inrShort(periodProfit)} color="text-indigo-600 dark:text-indigo-400" />
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
