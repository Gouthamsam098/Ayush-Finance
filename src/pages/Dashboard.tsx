import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useData, LOAN_LABELS, isDailyLoan } from '@/mock/DataContext';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { LiveClock } from '@/components/LiveClock';
import { Badge } from '@/components/ui/badge';
import { CountUp } from '@/components/motion';
import { inr, inrShort, todayISO, fmtDate, initials } from '@/lib/format';
import {
  Users, FileText, Wallet, CheckCircle2, CalendarDays, TrendingUp, Receipt, Scale,
  UserPlus, FilePlus2, Banknote, FileBarChart, Clock, ArrowUpRight, ArrowDownRight, Activity, PieChart,
} from 'lucide-react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function Dashboard() {
  const d = useData();
  const navigate = useNavigate();
  const [hover, setHover] = useState<number | null>(null);

  const active = d.loans.filter((l) => l.status === 'ACTIVE');
  const today = todayISO();
  const thisMonth = today.slice(0, 7);
  const todayColl = d.collections.filter((c) => c.date === today).reduce((s, c) => s + c.amount, 0);
  const monthColl = d.collections.filter((c) => c.date.slice(0, 7) === thisMonth).reduce((s, c) => s + c.amount, 0);
  const monthExp = d.expenses.filter((e) => e.date.slice(0, 7) === thisMonth).reduce((s, e) => s + e.amount, 0);
  const outstanding = active.reduce((s, l) => s + d.outstandingFor(l), 0);
  const interestEarned = d.loans.reduce((s, l) => s + l.interest, 0);

  const year = new Date().getFullYear();
  const monthly = MONTHS.map((_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`;
    return d.collections.filter((c) => c.date.slice(0, 7) === key).reduce((s, c) => s + c.amount, 0);
  });
  const maxV = Math.max(...monthly, 1);

  const num = (n: number) => Math.round(n).toLocaleString('en-IN');
  const kpis = [
    { label: 'Total Customers', value: d.customers.length, fmt: num, icon: Users, tone: 'text-primary bg-primary-50 dark:bg-primary/15', to: '/customers' },
    { label: 'Active Loans', value: active.length, fmt: num, icon: FileText, tone: 'text-success bg-success-50 dark:bg-success/15', to: '/loans' },
    { label: 'Outstanding', value: outstanding, fmt: inrShort, icon: Wallet, tone: 'text-warning bg-warning-50 dark:bg-warning/15' },
    { label: "Today's Collection", value: todayColl, fmt: inrShort, icon: CheckCircle2, tone: 'text-success bg-success-50 dark:bg-success/15', to: '/collections' },
    { label: 'Monthly Collection', value: monthColl, fmt: inrShort, icon: CalendarDays, tone: 'text-primary bg-primary-50 dark:bg-primary/15' },
    { label: 'Interest (portfolio)', value: interestEarned, fmt: inrShort, icon: TrendingUp, tone: 'text-success bg-success-50 dark:bg-success/15' },
    { label: 'Monthly Expenses', value: monthExp, fmt: inrShort, icon: Receipt, tone: 'text-danger bg-danger-50 dark:bg-danger/15', to: '/expenses' },
    { label: 'Net (month)', value: monthColl - monthExp, fmt: inrShort, icon: Scale, tone: 'text-primary bg-primary-50 dark:bg-primary/15' },
  ];

  const quick = [
    { label: 'Add Customer', icon: UserPlus, to: '/customers' },
    { label: 'Create Loan', icon: FilePlus2, to: '/loans' },
    { label: 'Record Collection', icon: Banknote, to: '/collections' },
    { label: 'Add Expense', icon: Receipt, to: '/expenses' },
    { label: 'Generate Report', icon: FileBarChart, to: '/reports' },
  ];

  const recent = [...d.collections].slice(0, 5).map((c) => {
    const loan = d.loans.find((l) => l.id === c.loanId);
    const cust = d.customers.find((x) => x.id === loan?.customerId);
    return { ...c, custName: cust?.name ?? '—', loanType: loan ? LOAN_LABELS[loan.type] : '' };
  });

  const due = active
    .map((l) => ({ loan: l, cust: d.customers.find((c) => c.id === l.customerId), out: d.outstandingFor(l) }))
    .filter((x) => x.out > 0)
    .sort((a, b) => b.out - a.out)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Welcome back, <span className="text-blue-600">Admin</span> 👋</h1>
            <p className="mt-1 text-sm text-slate-600">Here's your finance overview for today.</p>
          </div>
          <div className="text-right hidden sm:block">
            <LiveClock />
          </div>
        </div>
      </div>

      {/* KPI Cards - 4 Column Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.slice(0, 4).map((k, i) => {
          const Icon = k.icon;
          return (
            <motion.div
              key={k.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              onClick={() => k.to && navigate(k.to)}
              className={`group relative overflow-hidden rounded-xl bg-white p-5 shadow-sm border border-slate-200 transition-all duration-300 ${k.to ? 'cursor-pointer hover:shadow-md hover:border-slate-300' : ''}`}
            >
              <div className="relative">
                {/* Icon Container */}
                <div className={`mb-3 inline-flex h-12 w-12 items-center justify-center rounded-lg text-white transition-transform duration-300 group-hover:scale-110 ${i === 0 ? 'bg-purple-500' : i === 1 ? 'bg-emerald-500' : i === 2 ? 'bg-orange-500' : 'bg-green-500'}`}>
                  <Icon size={20} strokeWidth={2} />
                </div>

                {/* Label */}
                <p className="text-xs font-medium text-slate-600 mb-2">{k.label}</p>

                {/* Value */}
                <div className="text-2xl font-bold text-slate-900">
                  <CountUp value={k.value} format={k.fmt} />
                </div>

                {/* Trend */}
                <div className="mt-2 text-xs font-medium text-emerald-600">
                  ↑ +12% vs last month
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main Chart - Monthly Collection */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="lg:col-span-2 rounded-xl bg-white p-6 shadow-sm border border-slate-200"
        >
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">Monthly Collection</h3>
              <p className="mt-1 text-xs text-slate-600">Total collected per month · {year}</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 border border-blue-200">
              <span className="h-2 w-2 rounded-full bg-blue-500" /> Collection
            </div>
          </div>

          <div className="flex h-60 items-end gap-1.5">
            {monthly.map((v, i) => (
              <div key={i} className="relative flex flex-1 flex-col items-center justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                {hover === i && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: -8 }}
                    className="absolute -top-2 z-10 -translate-y-full whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-center text-white shadow-lg"
                  >
                    <div className="text-xs text-slate-400">{MONTHS[i]} {year}</div>
                    <div className="font-bold text-sm">{v ? inrShort(v) : '—'}</div>
                  </motion.div>
                )}
                <motion.div
                  className="w-full rounded-t-lg bg-blue-500 shadow-sm"
                  initial={{ height: '2%' }}
                  animate={{ height: `${Math.max((v / maxV) * 100, v > 0 ? 6 : 2)}%`, opacity: hover === null || hover === i ? 1 : 0.3 }}
                  transition={{ height: { delay: i * 0.04, duration: 0.6 }, opacity: { duration: 0.2 } }}
                />
              </div>
            ))}
          </div>

          <div className="mt-4 flex gap-1">
            {MONTHS.map((m) => <div key={m} className="flex-1 text-center text-xs font-medium text-slate-500">{m}</div>)}
          </div>
        </motion.div>

        {/* Recent Collections */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="rounded-xl bg-white p-6 shadow-sm border border-slate-200"
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900">Recent Collections</h3>
            <a href="#" className="text-xs font-semibold text-blue-600 hover:text-blue-700">View All</a>
          </div>

          <div className="space-y-3">
            {recent.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">No collections yet.</p>
            ) : (
              recent.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg p-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="h-9 w-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs flex-shrink-0">
                      {initials(c.custName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-900">{c.custName}</div>
                      <div className="text-xs text-slate-500">{c.loanType} · {fmtDate(c.date)}</div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-bold text-slate-900">{inr(c.amount)}</div>
                    <Badge tone="ok" className="text-xs">{c.mode}</Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </motion.div>
      </div>

      {/* Due Customers and Quick Actions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Due Customers Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="lg:col-span-2 rounded-xl bg-white p-6 shadow-sm border border-slate-200"
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock size={18} className="text-orange-500" />
              <h3 className="text-base font-bold text-slate-900">Due Customers</h3>
            </div>
            <a href="#" className="text-xs font-semibold text-blue-600 hover:text-blue-700">View All</a>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-600 border-b border-slate-200">
                  <th className="py-3 font-semibold">Customer</th>
                  <th className="py-3 font-semibold">Loan</th>
                  <th className="py-3 font-semibold">Outstanding</th>
                  <th className="py-3 font-semibold">Status</th>
                  <th className="py-3 font-semibold">Due Date</th>
                </tr>
              </thead>
              <tbody>
                {due.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">Nothing due 🎉</td>
                  </tr>
                ) : (
                  due.map(({ loan, cust, out }) => {
                    const overdue = loan.nextDueDate ? loan.nextDueDate < today : false;
                    return (
                      <tr key={loan.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                        <td className="py-3">
                          <div className="font-semibold text-slate-900">{cust?.name}</div>
                          <div className="text-xs text-slate-500">{initials(cust?.name || '')}</div>
                        </td>
                        <td className="py-3 text-slate-700">{LOAN_LABELS[loan.type]}</td>
                        <td className="py-3 font-bold text-slate-900">{inr(out)}</td>
                        <td className="py-3">
                          <Badge tone={overdue ? 'err' : 'warn'}>
                            {overdue ? 'Overdue' : isDailyLoan(loan.type) ? 'Daily' : 'Due'}
                          </Badge>
                        </td>
                        <td className="py-3 text-slate-700">{loan.nextDueDate ? fmtDate(loan.nextDueDate) : '—'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </motion.div>

        {/* Quick Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="rounded-xl bg-white p-6 shadow-sm border border-slate-200"
        >
          <h3 className="mb-4 text-base font-bold text-slate-900">Quick Actions</h3>
          <div className="grid grid-cols-2 gap-3">
            {quick.map((q, i) => {
              const Icon = q.icon;
              const colors = ['bg-purple-100 text-purple-600', 'bg-blue-100 text-blue-600', 'bg-emerald-100 text-emerald-600', 'bg-orange-100 text-orange-600', 'bg-pink-100 text-pink-600'];
              return (
                <motion.button
                  key={q.label}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.6 + i * 0.05 }}
                  onClick={() => navigate(q.to)}
                  className="group relative flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-white p-4 text-center transition-all duration-300 hover:shadow-md hover:border-slate-300 hover:bg-slate-50"
                >
                  <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110 ${colors[i % colors.length]}`}>
                    <Icon size={18} strokeWidth={2} />
                  </div>
                  <span className="text-xs font-semibold text-slate-700">{q.label}</span>
                </motion.button>
              );
            })}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
