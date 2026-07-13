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
  UserPlus, FilePlus2, Banknote, FileBarChart, Clock,
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Welcome back, <span className="text-gradient">Admin</span> 👋</h1>
          <p className="text-sm text-muted">Here's your finance overview for today.</p>
        </div>
        <LiveClock />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k, i) => {
          const Icon = k.icon;
          return (
            <Card key={k.label} tilt onClick={() => k.to && navigate(k.to)}
              className={`anim-pop group p-5 ${k.to ? 'cursor-pointer' : ''}`}
              style={{ animationDelay: `${i * 60}ms` }}>
              <div className={`mb-4 grid h-11 w-11 place-items-center rounded-xl transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6 ${k.tone}`}><Icon size={20} /></div>
              <div className="text-[13px] text-muted">{k.label}</div>
              <div className="mt-1 font-display text-2xl font-bold tracking-tight">
                <CountUp value={k.value} format={k.fmt} />
              </div>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.9fr_1fr]">
        <Card tilt tiltMax={4} className="anim-pop" style={{ animationDelay: '160ms' }}>
          <CardHeader>
            <div>
              <CardTitle>Monthly Collection</CardTitle>
              <p className="mt-0.5 text-xs text-muted">Total collected per month · {year}</p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-muted">
              <span className="h-2.5 w-2.5 rounded bg-gradient-to-b from-primary-400 to-primary" /> Collection
            </span>
          </CardHeader>
          <CardBody>
            <div className="flex h-64 items-end gap-2">
              {monthly.map((v, i) => (
                <div key={i} className="relative flex flex-1 flex-col items-center justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  {hover === i && (
                    <div className="absolute -top-2 z-10 -translate-y-full whitespace-nowrap rounded-xl bg-slate-900 px-3 py-2 text-center text-white shadow-[0_12px_32px_-8px_rgba(0,0,0,.5)]">
                      <div className="text-[10px] text-slate-400">{MONTHS[i]} {year}</div>
                      <div className="font-display text-sm font-bold">{v ? inrShort(v) : '—'}</div>
                    </div>
                  )}
                  <motion.div className="w-3/5 max-w-[30px] rounded-t-lg bg-gradient-to-b from-primary-400 to-primary shadow-[0_0_16px_-2px_rgba(79,70,229,.6)]"
                    initial={{ height: '2%' }}
                    animate={{ height: `${Math.max((v / maxV) * 100, v > 0 ? 6 : 2)}%`, opacity: hover === null || hover === i ? 1 : 0.5 }}
                    transition={{ height: { delay: i * 0.05, duration: 0.7, ease: [0.16, 1, 0.3, 1] }, opacity: { duration: 0.2 } }} />
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              {MONTHS.map((m) => <div key={m} className="flex-1 text-center text-[11px] font-medium text-muted">{m}</div>)}
            </div>
          </CardBody>
        </Card>

        <Card tilt tiltMax={4} className="anim-pop" style={{ animationDelay: '220ms' }}>
          <CardHeader><CardTitle>Recent Collections</CardTitle></CardHeader>
          <CardBody className="pt-0">
            {recent.length === 0 && <p className="py-6 text-center text-sm text-muted">No collections yet.</p>}
            {recent.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-white/[.05]">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-50 font-display text-xs font-bold text-primary dark:bg-primary/15">{initials(c.custName)}</div>
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{c.custName}</div><div className="text-xs text-muted">{c.loanType} · {fmtDate(c.date)}</div></div>
                <div className="text-right"><div className="font-display text-sm font-bold">{inr(c.amount)}</div><Badge tone="ok">{c.mode}</Badge></div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.9fr_1fr]">
        <Card tilt tiltMax={3} className="anim-pop" style={{ animationDelay: '120ms' }}>
          <CardHeader><CardTitle className="flex items-center gap-2"><Clock size={17} className="text-warning" /> Due Customers</CardTitle></CardHeader>
          <CardBody className="pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3">Customer</th><th className="py-2 pr-3">Loan</th><th className="py-2 pr-3">Outstanding</th><th className="py-2">Status</th>
                </tr></thead>
                <tbody>
                  {due.map(({ loan, cust, out }) => {
                    const overdue = loan.nextDueDate ? loan.nextDueDate < today : false;
                    return (
                      <tr key={loan.id} className="border-t border-slate-100 dark:border-white/[.06]">
                        <td className="py-3 pr-3 font-medium">{cust?.name}</td>
                        <td className="py-3 pr-3 text-muted">{LOAN_LABELS[loan.type]}</td>
                        <td className="py-3 pr-3 font-display font-semibold">{inr(out)}</td>
                        <td className="py-3"><Badge tone={overdue ? 'err' : 'warn'}>{overdue ? 'Overdue' : isDailyLoan(loan.type) ? 'Daily' : loan.nextDueDate ? 'Due ' + fmtDate(loan.nextDueDate) : 'Pending'}</Badge></td>
                      </tr>
                    );
                  })}
                  {due.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted">Nothing due 🎉</td></tr>}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>

        <Card tilt tiltMax={4} className="anim-pop" style={{ animationDelay: '180ms' }}>
          <CardHeader><CardTitle>Quick Actions</CardTitle></CardHeader>
          <CardBody className="grid grid-cols-2 gap-3">
            {quick.map((q) => {
              const Icon = q.icon;
              return (
                <button key={q.label} onClick={() => navigate(q.to)}
                  className="group flex flex-col items-start gap-2.5 rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-left transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_16px_32px_-16px_rgba(79,70,229,.5)]">
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary-50 text-primary transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6 dark:bg-primary/15"><Icon size={18} /></span>
                  <span className="text-[13px] font-semibold">{q.label}</span>
                </button>
              );
            })}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
