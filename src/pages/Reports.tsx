import { useState } from 'react';
import { useData, LOAN_LABELS } from '@/mock/DataContext';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/PageHeader';
import { CountUp } from '@/components/motion';
import { inr, inrShort, fmtDate } from '@/lib/format';
import { Download, Users, FileText, Receipt, Wallet } from 'lucide-react';

type ReportKey = 'customers' | 'loans' | 'collections' | 'expenses';

function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}
function download(name: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const d = useData();
  const toast = useToast();
  const [tab, setTab] = useState<ReportKey>('loans');

  const tabs: { key: ReportKey; label: string; icon: typeof Users }[] = [
    { key: 'customers', label: 'Customers', icon: Users },
    { key: 'loans', label: 'Loans', icon: FileText },
    { key: 'collections', label: 'Collections', icon: Receipt },
    { key: 'expenses', label: 'Expenses', icon: Wallet },
  ];

  const custName = (id: number) => d.customers.find((c) => c.id === id)?.name ?? '—';

  const exportCsv = () => {
    let rows: (string | number)[][] = [];
    if (tab === 'customers') rows = [['Code', 'Name', 'Mobile', 'City', 'Occupation', 'Monthly Income'], ...d.customers.map((c) => [c.code, c.name, c.mobile, c.city ?? '', c.occupation ?? '', c.monthlyIncome ?? ''])];
    if (tab === 'loans') rows = [['Loan #', 'Customer', 'Type', 'Principal', 'Interest', 'Outstanding', 'Status'], ...d.loans.map((l) => [l.loanNumber, custName(l.customerId), LOAN_LABELS[l.type], l.principal, l.interest, d.outstandingFor(l), l.status])];
    if (tab === 'collections') rows = [['Receipt', 'Customer', 'Amount', 'Mode', 'Date'], ...d.collections.map((c) => { const loan = d.loans.find((l) => l.id === c.loanId); return [c.receiptNo, loan ? custName(loan.customerId) : '—', c.amount, c.mode, c.date]; })];
    if (tab === 'expenses') rows = [['Date', 'Category', 'Name', 'Amount', 'Mode'], ...d.expenses.map((e) => [e.date, e.category, e.name, e.amount, e.mode])];
    download(`anush-${tab}-report.csv`, toCsv(rows));
    toast('CSV exported');
  };

  const totalOut = d.loans.filter((l) => l.status === 'ACTIVE').reduce((s, l) => s + d.outstandingFor(l), 0);
  const totalColl = d.collections.reduce((s, c) => s + c.amount, 0);
  const totalExp = d.expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-5 p-3.5 sm:p-5">
      <PageHeader title="Reports" subtitle="Summaries with CSV export"
        action={<Button onClick={exportCsv}><Download size={16} /> Export {tab}</Button>} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card tilt className="anim-pop p-5"><div className="text-[13px] text-muted">Customers</div><div className="mt-1 font-display text-2xl font-bold"><CountUp value={d.customers.length} /></div></Card>
        <Card tilt className="anim-pop p-5" style={{ animationDelay: '70ms' }}><div className="text-[13px] text-muted">Outstanding</div><div className="mt-1 font-display text-2xl font-bold"><CountUp value={totalOut} format={inrShort} /></div></Card>
        <Card tilt className="anim-pop p-5" style={{ animationDelay: '140ms' }}><div className="text-[13px] text-muted">Collected</div><div className="mt-1 font-display text-2xl font-bold"><CountUp value={totalColl} format={inrShort} /></div></Card>
        <Card tilt className="anim-pop p-5" style={{ animationDelay: '210ms' }}><div className="text-[13px] text-muted">Expenses</div><div className="mt-1 font-display text-2xl font-bold"><CountUp value={totalExp} format={inrShort} /></div></Card>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${tab === t.key ? 'bg-primary text-white' : 'border border-slate-200 dark:border-slate-700 text-muted hover:bg-slate-50 dark:hover:bg-white/[.05]'}`}>
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      <Card className="anim-pop" style={{ animationDelay: '260ms' }}>
        <CardHeader><CardTitle className="capitalize">{tab} report</CardTitle></CardHeader>
        <CardBody className="overflow-x-auto pt-0">
          <table className="w-full min-w-[600px] text-sm">
            {tab === 'customers' && (
              <>
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted"><th className="py-2 pr-3">Code</th><th className="py-2 pr-3">Name</th><th className="py-2 pr-3">Mobile</th><th className="py-2 pr-3">City</th><th className="py-2">Income</th></tr></thead>
                <tbody>{d.customers.map((c) => <tr key={c.id} className="border-t border-slate-100 dark:border-white/[.06]"><td className="py-2.5 pr-3 font-mono text-xs">{c.code}</td><td className="py-2.5 pr-3 font-medium">{c.name}</td><td className="py-2.5 pr-3">{c.mobile}</td><td className="py-2.5 pr-3 text-muted">{c.city ?? '—'}</td><td className="py-2.5">{c.monthlyIncome ? inr(c.monthlyIncome) : '—'}</td></tr>)}</tbody>
              </>
            )}
            {tab === 'loans' && (
              <>
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted"><th className="py-2 pr-3">Loan #</th><th className="py-2 pr-3">Customer</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Principal</th><th className="py-2 pr-3">Outstanding</th><th className="py-2">Status</th></tr></thead>
                <tbody>{d.loans.map((l) => <tr key={l.id} className="border-t border-slate-100 dark:border-white/[.06]"><td className="py-2.5 pr-3 font-mono text-xs">{l.loanNumber}</td><td className="py-2.5 pr-3 font-medium">{custName(l.customerId)}</td><td className="py-2.5 pr-3">{LOAN_LABELS[l.type]}</td><td className="py-2.5 pr-3">{inr(l.principal)}</td><td className="py-2.5 pr-3 font-semibold">{inr(d.outstandingFor(l))}</td><td className="py-2.5">{l.status}</td></tr>)}</tbody>
              </>
            )}
            {tab === 'collections' && (
              <>
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted"><th className="py-2 pr-3">Receipt</th><th className="py-2 pr-3">Customer</th><th className="py-2 pr-3">Amount</th><th className="py-2 pr-3">Mode</th><th className="py-2">Date</th></tr></thead>
                <tbody>{d.collections.map((c) => { const loan = d.loans.find((l) => l.id === c.loanId); return <tr key={c.id} className="border-t border-slate-100 dark:border-white/[.06]"><td className="py-2.5 pr-3 font-mono text-xs">{c.receiptNo}</td><td className="py-2.5 pr-3 font-medium">{loan ? custName(loan.customerId) : '—'}</td><td className="py-2.5 pr-3 font-semibold text-success">{inr(c.amount)}</td><td className="py-2.5 pr-3">{c.mode}</td><td className="py-2.5">{fmtDate(c.date)}</td></tr>; })}</tbody>
              </>
            )}
            {tab === 'expenses' && (
              <>
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted"><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Category</th><th className="py-2 pr-3">Name</th><th className="py-2">Amount</th></tr></thead>
                <tbody>{d.expenses.map((e) => <tr key={e.id} className="border-t border-slate-100 dark:border-white/[.06]"><td className="py-2.5 pr-3">{fmtDate(e.date)}</td><td className="py-2.5 pr-3">{e.category}</td><td className="py-2.5 pr-3 font-medium">{e.name}</td><td className="py-2.5 font-semibold text-danger">{inr(e.amount)}</td></tr>)}</tbody>
              </>
            )}
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
