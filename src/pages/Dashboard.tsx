import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useData, LOAN_LABELS, isDailyLoan, cadenceDaysForLoan, type Loan,
} from '@/mock/DataContext';
import { inr, inrShort, todayISO, isoLocal } from '@/lib/format';
import { useOpenSidebar } from '@/components/layout/AppShell';
import {
  ChartCard, PeriodPill, KpiCard, LoanPerformanceChart, CashFlowChart, EfficiencyGauge, C,
  type LoanPerfPoint, type CashFlowPoint, type KpiTrend,
} from '@/components/dashboard/Charts';
import {
  Wallet, CalendarClock, IndianRupee, Gauge, TrendingUp, Plus, Menu,
  Phone, Eye, HandCoins, ArrowRight, Calendar, Search, Receipt,
} from 'lucide-react';

/** Whole calendar days between two YYYY-MM-DD dates (a − b). */
function daysBetween(aISO: string, bISO: string): number {
  const [ay, am, ad] = aISO.split('-').map(Number);
  const [by, bm, bd] = bISO.split('-').map(Number);
  return Math.round((new Date(ay, am - 1, ad).getTime() - new Date(by, bm - 1, bd).getTime()) / 86400000);
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
  const [overdueQuery, setOverdueQuery] = useState('');

  const active = d.loans.filter((l) => l.status === 'ACTIVE');
  const today = todayISO();
  const thisMonth = today.slice(0, 7);
  const [ly, lm] = thisMonth.split('-').map(Number);
  const lastMonthKey = `${lm === 1 ? ly - 1 : ly}-${String(lm === 1 ? 12 : lm - 1).padStart(2, '0')}`;

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

  const todayColl = d.collections.filter((c) => c.date === today).reduce((s, c) => s + c.amount, 0);
  const dueTodayLoans = active.filter((l) => d.nextDueFor(l) === today);
  const dueToday = dueTodayLoans.reduce((s, l) => s + dueFor(l), 0);
  const dailyTargetPct = todayColl + dueToday > 0 ? Math.round((todayColl / (todayColl + dueToday)) * 100) : 0;

  // Collection efficiency = collected ÷ (collected + still-due) this month.
  // NULL when there's no collection activity at all — showing "100%" with zero
  // collections is misleading, so we render "—" instead.
  const hasEfficiency = monthColl + monthDue > 0;
  const efficiency = hasEfficiency ? Math.round((monthColl / (monthColl + monthDue)) * 100) : null;
  const lastEff = (() => {
    const lc = lastColl; const denom = lc + monthDue;
    return lc > 0 ? Math.round((lc / (denom || lc)) * 100) : null;
  })();

  // Cash flow = all cash in − out (used by the Cash Flow Trend chart).
  // Profit = INTEREST income earned this month (the business's real earnings).
  // Principal repayments are the customer returning our own money, so they are
  // NOT income. Interest income = collections marked INTEREST (unset kind counts
  // as interest, the app default). Expenses are tracked as a separate KPI.
  const interestInMonth = (key: string) =>
    d.collections.filter((c) => c.date.slice(0, 7) === key && c.kind !== 'PRINCIPAL').reduce((s, c) => s + c.amount, 0);
  const monthInterest = interestInMonth(thisMonth);
  const lastInterest = interestInMonth(lastMonthKey);

  // ── Section 1 KPIs ──
  const kpis = [
    { icon: Wallet, tint: 'bg-indigo-50 dark:bg-indigo-500/15', iconColor: 'text-indigo-600 dark:text-indigo-400', label: 'Total Outstanding', value: inr(totalOutstanding), hint: 'Across active loans', trend: null as KpiTrend | null },
    { icon: CalendarClock, tint: 'bg-amber-50 dark:bg-amber-500/15', iconColor: 'text-amber-600 dark:text-amber-400', label: 'Due Today', value: inr(dueToday), hint: `${dueTodayLoans.length} loan${dueTodayLoans.length === 1 ? '' : 's'}`, trend: null },
    { icon: IndianRupee, tint: 'bg-emerald-50 dark:bg-emerald-500/15', iconColor: 'text-emerald-600 dark:text-emerald-400', label: 'Collected Today', value: inr(todayColl), hint: `${dailyTargetPct}% of daily target`, trend: null },
    { icon: Gauge, tint: 'bg-blue-50 dark:bg-blue-500/15', iconColor: 'text-blue-600 dark:text-blue-400', label: 'Collection Efficiency', value: efficiency == null ? '—' : `${efficiency}%`, hint: efficiency == null ? 'No activity yet' : 'This month', trend: efficiency != null && lastEff != null ? trendOf(efficiency, lastEff) : null },
    { icon: TrendingUp, tint: 'bg-emerald-50 dark:bg-emerald-500/15', iconColor: 'text-emerald-600 dark:text-emerald-400', label: 'Profit', value: inr(monthInterest), hint: 'Interest earned this month', trend: trendOf(monthInterest, lastInterest) },
    { icon: Receipt, tint: 'bg-rose-50 dark:bg-rose-500/15', iconColor: 'text-rose-600 dark:text-rose-400', label: 'Expenses', value: inr(monthExp), hint: 'This month', trend: trendOf(monthExp, lastExp) },
  ];

  // ── Section 2a — Loan Performance: money OUT (disbursed) vs money IN
  //    (collected) per month, so you see business volume + repayment health. ──
  const loanPerf: LoanPerfPoint[] = useMemo(() => lastMonths(6).map(({ key, label }) => ({
    month: label,
    disbursed: d.loans.filter((l) => l.loanDate.slice(0, 7) === key).reduce((s, l) => s + l.principal, 0),
    collected: d.collections.filter((c) => c.date.slice(0, 7) === key).reduce((s, c) => s + c.amount, 0),
  })), [d.loans, d.collections]);

  // ── Section 2b — Cash Flow (this month, daily cumulative). "Net Profit" line =
  //    interest income − expenses (principal repayments are NOT income). ──
  const cashFlow: CashFlowPoint[] = useMemo(() => {
    const todayDay = Number(today.slice(8, 10));
    const cById: Record<number, number> = {}, iById: Record<number, number> = {}, eById: Record<number, number> = {};
    for (const c of d.collections) if (c.date.slice(0, 7) === thisMonth) {
      const dd = Number(c.date.slice(8, 10));
      cById[dd] = (cById[dd] ?? 0) + c.amount;
      if (c.kind !== 'PRINCIPAL') iById[dd] = (iById[dd] ?? 0) + c.amount; // interest income only
    }
    for (const e of d.expenses) if (e.date.slice(0, 7) === thisMonth) { const dd = Number(e.date.slice(8, 10)); eById[dd] = (eById[dd] ?? 0) + e.amount; }
    let cc = 0, ci = 0, ce = 0;
    const pts: CashFlowPoint[] = [];
    for (let day = 1; day <= Math.max(todayDay, 1); day++) {
      cc += cById[day] ?? 0; ci += iById[day] ?? 0; ce += eById[day] ?? 0;
      pts.push({ label: String(day), collections: cc, expenses: ce, net: ci - ce });
    }
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thisMonth, today, d.collections, d.expenses]);

  // ── Section 3 — Overdue loans (real, ranked by days overdue) ──
  const overdueRows = useMemo(() => active
    .filter(isOverdue)
    .map((l) => {
      const nd = d.nextDueFor(l)!;
      const cust = d.customers.find((c) => c.id === l.customerId);
      return { id: l.id, customer: cust?.name ?? '—', loanNo: l.loanNumber, due: dueFor(l), days: daysBetween(today, nd), type: LOAN_LABELS[l.type] };
    })
    .sort((a, b) => b.days - a.days)
    .slice(0, 6),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, d, today]);

  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; })();
  const dateChip = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  // Live data only — every figure derives from the real portfolio.
  const loanPerfView = loanPerf;
  const cashFlowView = cashFlow;
  const overdueView = overdueRows;
  const sumColl = monthColl;
  const sumExp = monthExp;
  const sumNet = monthInterest - monthExp; // net profit (interest − expenses)
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
              <p className="text-[13px] text-muted">Here's what's happening with your portfolio today.</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-2 rounded-xl border-[0.5px] border-slate-200/80 bg-white px-3.5 py-2 text-[13px] font-semibold text-ink/70 dark:border-white/[.08] dark:bg-surface"><Calendar size={15} className="text-muted" /> {dateChip}</span>
            <button onClick={() => navigate('/collections')} className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13.5px] font-semibold text-white shadow-sm transition-all hover:-translate-y-px hover:shadow-md" style={{ background: C.primary }}><Plus size={16} /> Record Collection</button>
          </div>
        </div>

        {/* SECTION 1 — Portfolio Summary (5 KPI cards) */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          {kpisView.map((k) => <KpiCard key={k.label} {...k} />)}
        </div>

        {/* SECTION 2 — Business Performance (2 equal charts) */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Loan Performance" subtitle="(Last 6 Months)" right={<PeriodPill>This Month</PeriodPill>}>
            <LoanPerformanceChart data={loanPerfView} />
            <div className="mt-3 grid grid-cols-3 gap-3 border-t border-slate-100 pt-3 dark:border-white/[.06]">
              <Summary label="Active" value={String(activeCount)} color="text-indigo-600 dark:text-indigo-400" />
              <Summary label="Overdue" value={String(overdueCount)} color="text-amber-600 dark:text-amber-400" />
              <Summary label="Closed" value={String(closedCount)} color="text-emerald-600 dark:text-emerald-400" />
            </div>
          </ChartCard>

          <ChartCard title="Cash Flow Trend" subtitle="(This Month)" right={<PeriodPill>This Month</PeriodPill>}>
            <CashFlowChart data={cashFlowView} />
            <div className="mt-3 grid grid-cols-3 gap-3 border-t border-slate-100 pt-3 dark:border-white/[.06]">
              <Summary label="Total Collections" value={inr(sumColl)} color="text-emerald-600 dark:text-emerald-400" />
              <Summary label="Total Expenses" value={inr(sumExp)} color="text-red-500 dark:text-red-400" />
              <Summary label="Profit" value={inr(sumNet)} color="text-indigo-600 dark:text-indigo-400" />
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
                              <button title="Call" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-500/15"><Phone size={15} /></button>
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
              <GaugeStat label="Interest" value={inrShort(monthInterest)} color="text-emerald-600 dark:text-emerald-400" />
              <GaugeStat label="Expenses" value={inrShort(sumExp)} color="text-red-500 dark:text-red-400" />
              <GaugeStat label="Profit" value={inrShort(monthInterest)} color="text-indigo-600 dark:text-indigo-400" />
            </div>
            <button onClick={() => navigate('/reports')} className="mt-4 inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold" style={{ color: C.primary }}>View Collection Reports <ArrowRight size={14} /></button>
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
