import { useNavigate } from 'react-router-dom';
import { useData, LOAN_LABELS, isDailyLoan } from '@/mock/DataContext';
import { inr, inrShort, todayISO, fmtDate } from '@/lib/format';
import { HeroHeader, type HeroKpi } from '@/components/dashboard/HeroHeader';
import { MetricRow, type Metric } from '@/components/dashboard/MetricRow';
import { OutstandingTable, type OutstandingRow } from '@/components/dashboard/OutstandingTable';
import { PortfolioMix, type MixRow } from '@/components/dashboard/PortfolioMix';
import { PortfolioSnapshot } from '@/components/dashboard/PortfolioSnapshot';
import { RecentActivity, type ActivityRow } from '@/components/dashboard/RecentActivity';
import { QuickActions, type QuickAction } from '@/components/dashboard/QuickActions';
import {
  Users, Banknote, TrendingUp, AlertTriangle,
  UserPlus, FilePlus2, Receipt, FileBarChart,
} from 'lucide-react';

const MIX_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#14b8a6', '#a855f7', '#ec4899'];

export default function Dashboard() {
  const d = useData();
  const navigate = useNavigate();

  const active = d.loans.filter((l) => l.status === 'ACTIVE');
  const today = todayISO();
  const thisMonth = today.slice(0, 7);

  const todayCollList = d.collections.filter((c) => c.date === today);
  const todayColl = todayCollList.reduce((s, c) => s + c.amount, 0);
  const monthColl = d.collections.filter((c) => c.date.slice(0, 7) === thisMonth).reduce((s, c) => s + c.amount, 0);
  const monthExp = d.expenses.filter((e) => e.date.slice(0, 7) === thisMonth).reduce((s, e) => s + e.amount, 0);
  const outstanding = active.reduce((s, l) => s + d.outstandingFor(l), 0);
  const interestEarned = d.loans.reduce((s, l) => s + l.interest, 0);
  const net = monthColl - monthExp;

  const overdueLoans = active.filter(
    (l) => l.nextDueDate && l.nextDueDate < today && d.outstandingFor(l) > 0,
  );
  const overdueTop = [...overdueLoans].sort((a, b) => d.outstandingFor(b) - d.outstandingFor(a))[0];
  const overdueCust = overdueTop ? d.customers.find((c) => c.id === overdueTop.customerId) : undefined;

  // Collection rate this cycle = collected ÷ (collected + still-due).
  const monthDue = active.reduce(
    (s, l) => s + (isDailyLoan(l.type) ? d.totalDueForDaily(l) : d.totalDueForMonthly(l)),
    0,
  );
  const collectionRate = monthColl + monthDue > 0 ? Math.round((monthColl / (monthColl + monthDue)) * 100) : 100;

  const monthLabel = new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  const dateLabel = `${new Date().toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })} · Portfolio overview`;
  const rateChip = collectionRate >= 80 ? 'Healthy' : collectionRate >= 50 ? 'Watch' : 'At risk';

  // ── Hero KPI tiles ──
  const heroKpis: HeroKpi[] = [
    {
      icon: Users, value: String(d.customers.length), label: 'Customers', chip: `${active.length} active`,
      iconBg: 'bg-indigo-500/30', iconColor: 'text-indigo-200', chipClass: 'bg-indigo-500/25 text-indigo-200',
      tileTint: 'border-indigo-400/25 bg-indigo-500/[.12]',
    },
    {
      icon: Banknote, value: inrShort(todayColl), label: "Today's collection",
      chip: `${todayCollList.length} receipt${todayCollList.length === 1 ? '' : 's'}`,
      iconBg: 'bg-emerald-500/25', iconColor: 'text-emerald-300', chipClass: 'bg-emerald-500/20 text-emerald-300',
      tileTint: 'border-emerald-400/25 bg-emerald-500/[.12]',
    },
    {
      icon: TrendingUp, value: inrShort(monthColl), label: 'Monthly collection', chip: monthLabel,
      iconBg: 'bg-amber-500/25', iconColor: 'text-amber-300', chipClass: 'bg-amber-500/20 text-amber-300',
      tileTint: 'border-amber-400/25 bg-amber-500/[.12]',
    },
    {
      icon: AlertTriangle, value: `${collectionRate}%`, label: 'Collection rate', chip: rateChip,
      iconBg: 'bg-red-500/30', iconColor: 'text-red-300', chipClass: 'bg-red-500/25 text-red-300',
      danger: collectionRate < 50,
    },
  ];

  // ── Secondary metric row ──
  const metrics: Metric[] = [
    { label: 'Active loans', value: String(active.length), sub: `${d.loans.length - active.length} closed` },
    { label: 'Interest (portfolio)', value: inrShort(interestEarned), sub: 'Total booked' },
    { label: 'Monthly expenses', value: inrShort(monthExp), sub: 'This month' },
    { label: 'Net this month', value: inrShort(net), sub: 'Collection − expenses', good: net >= 0 },
  ];

  // ── Top outstanding loans ──
  const outstandingRows: OutstandingRow[] = active
    .map((l) => ({ loan: l, out: d.outstandingFor(l) }))
    .filter((x) => x.out > 0)
    .sort((a, b) => b.out - a.out)
    .slice(0, 5)
    .map(({ loan, out }) => {
      const overdue = !!loan.nextDueDate && loan.nextDueDate < today;
      return {
        id: loan.id,
        loanLabel: LOAN_LABELS[loan.type],
        amount: inr(out),
        status: overdue ? 'Overdue' : isDailyLoan(loan.type) ? 'Daily' : 'Due',
        due: loan.nextDueDate ? fmtDate(loan.nextDueDate).slice(0, 6) : '—',
      };
    });

  // ── Portfolio mix ──
  const mixRows: MixRow[] = Object.entries(
    active.reduce<Record<string, number>>((acc, l) => {
      acc[l.type] = (acc[l.type] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .map(({ type, count }, i) => ({
      name: LOAN_LABELS[type as keyof typeof LOAN_LABELS],
      pct: Math.round((count / active.length) * 100),
      color: MIX_COLORS[i % MIX_COLORS.length],
    }));

  // ── Recent activity ──
  const activityRows: ActivityRow[] = [...d.collections].slice(0, 4).map((c) => {
    const loan = d.loans.find((l) => l.id === c.loanId);
    return {
      id: c.id,
      label: loan ? LOAN_LABELS[loan.type] : 'Collection',
      date: fmtDate(c.date),
      amount: inr(c.amount),
      mode: c.mode,
    };
  });

  const quickActions: QuickAction[] = [
    { label: 'Add customer', icon: UserPlus, to: '/customers' },
    { label: 'Create loan', icon: FilePlus2, to: '/loans' },
    { label: 'Record collection', icon: Banknote, to: '/collections' },
    { label: 'Add expense', icon: Receipt, to: '/expenses' },
    { label: 'Generate report', icon: FileBarChart, to: '/reports' },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <HeroHeader name="Admin" dateLabel={dateLabel} kpis={heroKpis} onQuickAction={() => navigate('/collections')} />

      <div className="flex flex-1 flex-col gap-3 p-3.5 sm:px-4">
        {/* Section 1 — metric row */}
        <MetricRow metrics={metrics} />

        {/* Section 2 — 1fr / right rail (left column narrowed, rail widened) */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex flex-col gap-2.5">
            <OutstandingTable rows={outstandingRows} onViewAll={() => navigate('/loans')} />
            <PortfolioMix rows={mixRows} />
          </div>

          <div className="flex flex-col gap-2.5">
            <PortfolioSnapshot
              outstanding={inrShort(outstanding)}
              activeLoans={active.length}
              collectionRate={collectionRate}
              netLabel={inrShort(net)}
              netPeriod={monthLabel}
              overdue={
                overdueTop
                  ? {
                      count: overdueLoans.length,
                      detail: `${inr(d.outstandingFor(overdueTop))} · ${overdueCust?.name ?? LOAN_LABELS[overdueTop.type]} · ${overdueTop.nextDueDate ? fmtDate(overdueTop.nextDueDate).slice(0, 6) : ''}`,
                    }
                  : undefined
              }
            />
            <RecentActivity rows={activityRows} onViewAll={() => navigate('/collections')} />
          </div>
        </div>

        {/* Section 3 — quick actions */}
        <QuickActions actions={quickActions} onAction={(to) => navigate(to)} />
      </div>
    </div>
  );
}
