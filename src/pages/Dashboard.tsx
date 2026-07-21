import { useNavigate } from 'react-router-dom';
import { useData, LOAN_LABELS, isDailyLoan } from '@/mock/DataContext';
import { inr, inrShort, todayISO, fmtDate, addDays } from '@/lib/format';
import { HeroHeader, type HeroKpi } from '@/components/dashboard/HeroHeader';
import { MetricRow, type Metric } from '@/components/dashboard/MetricRow';
import { OutstandingTable, type OutstandingRow } from '@/components/dashboard/OutstandingTable';
import { PortfolioMix } from '@/components/dashboard/PortfolioMix';
import { MoneyFlow } from '@/components/dashboard/MoneyFlow';
import { RecentActivity, type ActivityRow } from '@/components/dashboard/RecentActivity';
import { DailyTracker } from '@/components/dashboard/DailyTracker';
import { DuePreview } from '@/components/dashboard/DuePreview';
import {
  Users, Banknote, TrendingUp, AlertTriangle,
} from 'lucide-react';

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
  const interestEarned = d.loans.reduce((s, l) => s + l.interest, 0);
  const net = monthColl - monthExp;
  const monthDisbursed = d.loans.filter((l) => l.loanDate.slice(0, 7) === thisMonth).reduce((s, l) => s + l.principal, 0);

  const monthDue = active.reduce(
    (s, l) => s + (isDailyLoan(l.type) ? d.totalDueForDaily(l) : d.totalDueForMonthly(l)), 0,
  );
  const collectionRate = monthColl + monthDue > 0 ? Math.round((monthColl / (monthColl + monthDue)) * 100) : 100;

  const monthLabel = new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  const dateLabel = `${new Date().toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })} · Portfolio overview`;
  const rateChip = collectionRate >= 80 ? 'Healthy' : collectionRate >= 50 ? 'Watch' : 'At risk';

  const heroKpis: HeroKpi[] = [
    {
      icon: Users, value: String(d.customers.length), label: 'Customers', chip: `${active.length} active`,
      iconBg: 'bg-blue-100 dark:bg-blue-500/30', iconColor: 'text-blue-600 dark:text-blue-200',
      chipClass: 'bg-blue-100 text-blue-700 dark:bg-blue-500/25 dark:text-blue-200',
      tileTint: 'border-blue-200 bg-blue-50 dark:border-blue-400/25 dark:bg-blue-500/[.12]',
    },
    {
      icon: Banknote, value: inrShort(todayColl), label: "Today's collection",
      chip: `${todayCollList.length} receipt${todayCollList.length === 1 ? '' : 's'}`,
      iconBg: 'bg-emerald-100 dark:bg-emerald-500/25', iconColor: 'text-emerald-600 dark:text-emerald-300',
      chipClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
      tileTint: 'border-emerald-200 bg-emerald-50 dark:border-emerald-400/25 dark:bg-emerald-500/[.12]',
    },
    {
      icon: TrendingUp, value: inr(monthColl), label: 'Monthly collection', chip: monthLabel,
      iconBg: 'bg-sky-100 dark:bg-sky-500/25', iconColor: 'text-sky-600 dark:text-sky-300',
      chipClass: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
      tileTint: 'border-sky-200 bg-sky-50 dark:border-sky-400/25 dark:bg-sky-500/[.12]',
    },
    {
      icon: AlertTriangle, value: `${collectionRate}%`, label: 'Collection Rate', chip: rateChip,
      iconBg: collectionRate < 50 ? 'bg-red-100 dark:bg-red-500/30' : collectionRate >= 80 ? 'bg-emerald-100 dark:bg-emerald-500/25' : 'bg-amber-100 dark:bg-amber-500/25',
      iconColor: collectionRate < 50 ? 'text-red-600 dark:text-red-300' : collectionRate >= 80 ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300',
      chipClass: collectionRate < 50 ? 'bg-red-100 text-red-700 dark:bg-red-500/25 dark:text-red-300' : collectionRate >= 80 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
      danger: collectionRate < 50,
    },
  ];

  const metrics: Metric[] = [
    { label: 'Active loans', value: String(active.length), sub: `${d.loans.length - active.length} closed` },
    { label: 'Interest (portfolio)', value: inrShort(interestEarned), sub: 'Total booked', highlight: true, countUp: interestEarned },
    { label: 'Monthly expenses', value: inrShort(monthExp), sub: 'This month' },
    { label: 'Net this month', value: inrShort(net), sub: 'Collection − expenses', good: net >= 0, highlight: true, highlightColor: 'emerald', countUp: Math.abs(net) },
  ];

  const outstandingRows: OutstandingRow[] = active
    .map((l) => ({ loan: l, out: d.outstandingFor(l) }))
    .filter((x) => x.out > 0)
    .sort((a, b) => b.out - a.out)
    .slice(0, 15)
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

  const portfolioCounts = Object.entries(
    active.reduce<Record<string, number>>((acc, l) => { acc[l.type] = (acc[l.type] ?? 0) + 1; return acc; }, {}),
  ).map(([type, count]) => ({ type, count }));

  const activityRows: ActivityRow[] = [...d.collections].slice(0, 4).map((c) => {
    const loan = d.loans.find((l) => l.id === c.loanId);
    return { id: c.id, label: loan ? LOAN_LABELS[loan.type] : 'Collection', date: fmtDate(c.date), amount: inr(c.amount), mode: c.mode };
  });

  const expectedToday = active
    .filter((l) => isDailyLoan(l.type))
    .reduce((s, l) => s + (l.dailyAmount ?? 0), 0);

  const tomorrow = addDays(today, 1);
  const dueItems = active
    .filter((l) => l.nextDueDate && l.nextDueDate >= today && l.nextDueDate <= tomorrow)
    .sort((a, b) => (a.nextDueDate! < b.nextDueDate! ? -1 : 1))
    .slice(0, 6)
    .map((l) => {
      const cust = d.customers.find((c) => c.id === l.customerId);
      const [ty, tm, td] = today.split('-').map(Number);
      const [ly, lm, ld] = l.nextDueDate!.split('-').map(Number);
      const daysUntil = Math.round((new Date(ly, lm - 1, ld).getTime() - new Date(ty, tm - 1, td).getTime()) / 86400000);
      return {
        id: l.id,
        customer: cust?.name ?? '—',
        type: LOAN_LABELS[l.type],
        amount: l.dailyAmount ?? 0,
        dueDate: l.nextDueDate!,
        days: daysUntil,
      };
    });

  return (
    <div className="flex min-h-full flex-col">
      <HeroHeader name="Admin" dateLabel={dateLabel} kpis={heroKpis} onQuickAction={() => navigate('/collections')} />

      <div className="flex flex-1 flex-col gap-4 p-3.5 sm:px-5">
        {/* Section 1 — metric row */}
        <MetricRow metrics={metrics} />

        {/* Section 2 — 1fr / right rail (left column narrowed, rail widened) */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_348px]">
          <div className="flex flex-col gap-4">
            <OutstandingTable rows={outstandingRows} onViewAll={() => navigate('/loans')} />
            <PortfolioMix counts={portfolioCounts} />
            <DuePreview items={dueItems} onViewAll={() => navigate('/loans')} />
          </div>

          <div className="flex flex-col gap-4">
            <DailyTracker expected={expectedToday} collected={todayColl} />
            <MoneyFlow disbursed={monthDisbursed} collected={monthColl} />
            <RecentActivity rows={activityRows} onViewAll={() => navigate('/collections')} />
          </div>
        </div>
      </div>
    </div>
  );
}
