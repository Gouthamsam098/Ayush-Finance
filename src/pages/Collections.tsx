import { useMemo, useState } from 'react';
import { useData, LOAN_LABELS, isDailyLoan, isMonthlyLike, type PayMode, type LoanType, type Loan } from '@/mock/DataContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/PageHeader';
import { LedgerDialog } from '@/components/LedgerDialog';
import { CollectionProgress } from '@/components/CollectionProgress';
import { inr, fmtDate, todayISO, isoLocal, DAILY_TERM } from '@/lib/format';
import { Plus, ScrollText, Inbox } from 'lucide-react';

const MODES: PayMode[] = ['CASH', 'UPI', 'BANK', 'CHEQUE'];
/** Days denominator for the progress bar: daily loans use their term, Flexible uses its chosen days, everything else uses a fixed 30-day cycle. */
const totalDaysFor = (l: Loan) => {
  if (isDailyLoan(l.type)) return l.numDays ?? DAILY_TERM;
  if (l.type === 'FLEXIBLE') return l.numDays ?? 30;
  return 30; // Monthly Interest / Vehicle / Property
};
/** Calendar days elapsed since the loan date (Day 1 = loan date), capped at the loan's term. Local-calendar based to match the Ledger. */
const elapsedDaysFor = (l: Loan) => {
  const [ly, lm, ld] = l.loanDate.split('-').map(Number);
  const [ty, tm, td] = todayISO().split('-').map(Number);
  const start = new Date(ly, lm - 1, ld);
  const today = new Date(ty, tm - 1, td);
  const elapsed = Math.round((today.getTime() - start.getTime()) / 86400000) + 1;
  return Math.max(0, Math.min(elapsed, totalDaysFor(l)));
};
/** Last day of the loan's term, local-calendar based (Day 1 = loan date, so end = loan date + term - 1). */
const loanEndDateFor = (l: Loan) => {
  const [ly, lm, ld] = l.loanDate.split('-').map(Number);
  return isoLocal(new Date(ly, lm - 1, ld + totalDaysFor(l) - 1));
};

interface CForm { id?: string; customerId: string; loanId: string; amount: string; date: string; mode: PayMode; remarks: string; }
const blank = (): CForm => ({ customerId: '', loanId: '', amount: '', date: todayISO(), mode: 'CASH', remarks: '' });

export default function Collections() {
  const d = useData();
  const toast = useToast();
  const [form, setForm] = useState<CForm | null>(null);
  const [typeFilter, setTypeFilter] = useState<LoanType | 'ALL'>('ALL');
  const [ledger, setLedger] = useState<Loan | null>(null);

  const custLoans = useMemo(
    () => d.loans.filter((l) => (!form?.customerId || l.customerId === form.customerId) && l.status === 'ACTIVE'),
    [d.loans, form?.customerId]
  );

  // Collections is a loan-centric tracker: one row per active loan, of any type, with its live progress.
  // Individual payments are added/edited/deleted inside that loan's Ledger.
  const loansToShow = useMemo(
    () => d.loans.filter((l) => l.status === 'ACTIVE' && (typeFilter === 'ALL' || l.type === typeFilter)),
    [d.loans, typeFilter]
  );

  const counts = useMemo(() => {
    const activeLoans = d.loans.filter((l) => l.status === 'ACTIVE');
    const m: Record<string, number> = { ALL: activeLoans.length };
    (Object.keys(LOAN_LABELS) as LoanType[]).forEach((t) => (m[t] = activeLoans.filter((l) => l.type === t).length));
    return m;
  }, [d.loans]);

  const set = (k: keyof CForm, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const save = () => {
    if (!form) return;
    if (!form.loanId) { toast('Select a loan (shown by type)', 'error'); return; }
    if (!Number(form.amount)) { toast('Enter an amount', 'error'); return; }
    const payload = { loanId: form.loanId, date: form.date, amount: Number(form.amount), mode: form.mode, remarks: form.remarks || undefined };
    if (form.id) { d.updateCollection(form.id, payload); toast('Collection updated'); }
    else { d.addCollection(payload); toast('Collection recorded · receipt generated'); }
    setForm(null);
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Collections" subtitle={`${d.collections.length} payments recorded`}
        action={<Button onClick={() => setForm(blank())}><Plus size={16} /> Add Collection</Button>} />

      {/* Loan type filter cards */}
      <div className="flex flex-wrap gap-2">
        {([['ALL', 'All'], ...(Object.keys(LOAN_LABELS) as LoanType[]).map((t) => [t, LOAN_LABELS[t]] as const)] as [string, string][]).map(([val, label]) => {
          const on = typeFilter === val;
          return (
            <button key={val} onClick={() => setTypeFilter(val as LoanType | 'ALL')}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${on ? 'bg-primary text-white shadow-md' : 'border border-slate-200 dark:border-slate-700 text-muted hover:bg-slate-50 dark:hover:bg-white/[.05]'}`}>
              {label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${on ? 'bg-white/25' : 'bg-slate-100 dark:bg-slate-800'}`}>{counts[val] ?? 0}</span>
            </button>
          );
        })}
      </div>

      {/* Empty state */}
      {loansToShow.length === 0 ? (
        <Card tilt className="anim-pop flex flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-primary-400 to-primary text-white shadow-soft anim-float"><Inbox size={30} /></div>
          <div className="font-display text-lg font-bold">No Collections Yet</div>
          <p className="max-w-sm text-sm text-muted">{typeFilter !== 'ALL' ? 'No active loans of this type yet.' : 'Record your first payment to get started.'}</p>
          <Button onClick={() => setForm(blank())}><Plus size={16} /> Record First Collection</Button>
        </Card>
      ) : typeFilter === 'DAILY_COLLECTION' ? (
        /* ── Daily Collection: expanded view with start/end date, due, and balance ── */
        <Card className="anim-pop p-4" style={{ animationDelay: '80ms' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="py-2.5 pr-3">Customer</th><th className="py-2.5 pr-3">Collection Progress</th><th className="py-2.5 pr-3">Loan Type</th>
                <th className="py-2.5 pr-3">Loan Start Date</th><th className="py-2.5 pr-3">Loan End Date</th>
                <th className="py-2.5 pr-3">Total Due Amount</th><th className="py-2.5 pr-3">Balance</th><th className="py-2.5 pr-3">Amount Paid</th>
                <th className="py-2.5 text-center">Actions</th>
              </tr></thead>
              <tbody>
                {loansToShow.map((l) => {
                  const cust = d.customers.find((c) => c.id === l.customerId);
                  const paid = elapsedDaysFor(l);
                  const collected = d.collectedFor(l.id);
                  const totalDue = Math.max(0, paid * (l.dailyAmount ?? 0) - collected);
                  const balance = d.outstandingFor(l); // Principal − Collected, for Daily Collection
                  return (
                    <tr key={l.id} className="border-t border-slate-100 dark:border-white/[.06] transition-colors hover:bg-primary-50/40 dark:hover:bg-primary/[.06]">
                      <td className="py-3 pr-3 font-medium">{cust?.name ?? '—'}</td>
                      <td className="py-3 pr-3"><CollectionProgress compact paid={paid} total={totalDaysFor(l)} /></td>
                      <td className="py-3 pr-3"><Badge tone="info">{LOAN_LABELS[l.type]}</Badge></td>
                      <td className="py-3 pr-3">{fmtDate(l.loanDate)}</td>
                      <td className="py-3 pr-3">{fmtDate(loanEndDateFor(l))}</td>
                      <td className="py-3 pr-3 font-semibold text-danger">{totalDue > 0 ? inr(totalDue) : '—'}</td>
                      <td className="py-3 pr-3 font-semibold">{inr(balance)}</td>
                      <td className="py-3 pr-3 font-display font-semibold text-success">{inr(collected)}</td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-center">
                          <button onClick={() => setLedger(l)} title="View Report" aria-label="View Report"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-muted hover:border-primary/40 hover:text-primary">
                            <ScrollText size={14} /> View Report
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted">Total Due Amount is the cumulative shortfall from what's owed by today. Balance is Principal − Collected. Open View Report to add, edit, or delete individual payments.</p>
        </Card>
      ) : typeFilter === 'DAILY_INTEREST' ? (
        /* ── Daily Interest: base columns + Total Interest Due + Outstanding ── */
        <Card className="anim-pop p-4" style={{ animationDelay: '80ms' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="py-2.5 pr-3">Customer</th><th className="py-2.5 pr-3">Collection Progress</th><th className="py-2.5 pr-3">Loan Type</th>
                <th className="py-2.5 pr-3">Amount Paid</th><th className="py-2.5 pr-3">Total Interest Due</th><th className="py-2.5 pr-3">Outstanding</th>
                <th className="py-2.5 pr-3">Loan Date</th><th className="py-2.5 text-center">Actions</th>
              </tr></thead>
              <tbody>
                {loansToShow.map((l) => {
                  const cust = d.customers.find((c) => c.id === l.customerId);
                  const paid = elapsedDaysFor(l);
                  const totalDue = d.totalDueForDaily(l);
                  return (
                    <tr key={l.id} className="border-t border-slate-100 dark:border-white/[.06] transition-colors hover:bg-primary-50/40 dark:hover:bg-primary/[.06]">
                      <td className="py-3 pr-3 font-medium">{cust?.name ?? '—'}</td>
                      <td className="py-3 pr-3"><CollectionProgress compact paid={paid} total={totalDaysFor(l)} /></td>
                      <td className="py-3 pr-3"><Badge tone="info">{LOAN_LABELS[l.type]}</Badge></td>
                      <td className="py-3 pr-3 font-display font-semibold text-success">{inr(d.collectedFor(l.id))}</td>
                      <td className="py-3 pr-3 font-semibold text-danger">{totalDue > 0 ? inr(totalDue) : '—'}</td>
                      <td className="py-3 pr-3 font-semibold">{inr(d.outstandingFor(l))}</td>
                      <td className="py-3 pr-3">{fmtDate(l.loanDate)}</td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-center">
                          <button onClick={() => setLedger(l)} title="View Report" aria-label="View Report"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-muted hover:border-primary/40 hover:text-primary">
                            <ScrollText size={14} /> View Report
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted">Total Interest Due is the cumulative shortfall vs. what's owed by today. Outstanding is Principal + Total Interest Due. Open View Report to add, edit, or delete individual payments.</p>
        </Card>
      ) : typeFilter !== 'ALL' && isMonthlyLike(typeFilter) ? (
        /* ── Monthly Interest / Vehicle / Property: same columns, same 30-day-cycle logic ── */
        <Card className="anim-pop p-4" style={{ animationDelay: '80ms' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="py-2.5 pr-3">Customer</th><th className="py-2.5 pr-3">Principal</th><th className="py-2.5 pr-3">{typeFilter === 'FLEXIBLE' ? 'Interest' : 'Monthly Interest'}</th>
                <th className="py-2.5 pr-3">Total Due Amount</th><th className="py-2.5 pr-3">Loan Type</th><th className="py-2.5 pr-3">Amount Paid</th><th className="py-2.5 pr-3">Loan Date</th>
                <th className="py-2.5 text-center">Actions</th>
              </tr></thead>
              <tbody>
                {loansToShow.map((l) => {
                  const cust = d.customers.find((c) => c.id === l.customerId);
                  const totalDue = d.totalDueForMonthly(l);
                  return (
                    <tr key={l.id} className="border-t border-slate-100 dark:border-white/[.06] transition-colors hover:bg-primary-50/40 dark:hover:bg-primary/[.06]">
                      <td className="py-3 pr-3 font-medium">{cust?.name ?? '—'}</td>
                      <td className="py-3 pr-3">{inr(l.principal)}</td>
                      <td className="py-3 pr-3">{inr(l.interest)}</td>
                      <td className="py-3 pr-3 font-semibold text-danger">{totalDue > 0 ? inr(totalDue) : '—'}</td>
                      <td className="py-3 pr-3"><Badge tone="info">{LOAN_LABELS[l.type]}</Badge></td>
                      <td className="py-3 pr-3 font-display font-semibold text-success">{inr(d.collectedFor(l.id))}</td>
                      <td className="py-3 pr-3">{fmtDate(l.loanDate)}</td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-center">
                          <button onClick={() => setLedger(l)} title="View Report" aria-label="View Report"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-muted hover:border-primary/40 hover:text-primary">
                            <ScrollText size={14} /> View Report
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted">Total Due Amount is the cumulative interest shortfall vs. what's owed by today ({typeFilter === 'FLEXIBLE' ? "the loan's own term" : '30-day cycles'}). Open View Report to add, edit, or delete individual payments.</p>
        </Card>
      ) : (
        /* ── One row per loan, for every other loan type — live progress, View Report for individual payments ── */
        <Card className="anim-pop p-4" style={{ animationDelay: '80ms' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="py-2.5 pr-3">Customer</th><th className="py-2.5 pr-3">Collection Progress</th><th className="py-2.5 pr-3">Loan Type</th><th className="py-2.5 pr-3">Amount Paid</th><th className="py-2.5 pr-3">Loan Date</th><th className="py-2.5 text-center">Actions</th>
              </tr></thead>
              <tbody>
                {loansToShow.map((l) => {
                  const cust = d.customers.find((c) => c.id === l.customerId);
                  const paid = isDailyLoan(l.type) ? elapsedDaysFor(l) : d.collections.filter((c) => c.loanId === l.id).length;
                  return (
                    <tr key={l.id} className="border-t border-slate-100 dark:border-white/[.06] transition-colors hover:bg-primary-50/40 dark:hover:bg-primary/[.06]">
                      <td className="py-3 pr-3 font-medium">{cust?.name ?? '—'}</td>
                      <td className="py-3 pr-3"><CollectionProgress compact paid={paid} total={totalDaysFor(l)} /></td>
                      <td className="py-3 pr-3"><Badge tone="info">{LOAN_LABELS[l.type]}</Badge></td>
                      <td className="py-3 pr-3 font-display font-semibold text-success">{inr(d.collectedFor(l.id))}</td>
                      <td className="py-3 pr-3">{fmtDate(l.loanDate)}</td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-center">
                          <button onClick={() => setLedger(l)} title="View Report" aria-label="View Report"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-muted hover:border-primary/40 hover:text-primary">
                            <ScrollText size={14} /> View Report
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted">Amount Paid is the total collected so far for each loan. Open View Report to add, edit, or delete individual payments.</p>
        </Card>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit collection' : 'Add collection'}
        footer={<><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button onClick={save}>{form?.id ? 'Save changes' : 'Save'}</Button></>}>
        {form && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select label="Customer" value={form.customerId} onChange={(e) => { set('customerId', e.target.value); set('loanId', ''); }}
              options={[{ value: '', label: 'All customers' }, ...d.customers.map((c) => ({ value: c.id, label: c.name }))]} />
            <Select label="Loan type *" value={form.loanId} onChange={(e) => set('loanId', e.target.value)}
              options={[{ value: '', label: 'Select loan…' }, ...custLoans.map((l) => ({ value: l.id, label: `${LOAN_LABELS[l.type]} · ${l.loanNumber}` }))]} />
            <Input label="Amount *" type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
            <Input label="Date" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
            <Select label="Payment mode" value={form.mode} onChange={(e) => set('mode', e.target.value as PayMode)} options={MODES.map((m) => ({ value: m, label: m }))} />
            <div className="sm:col-span-2"><Input label="Remarks" value={form.remarks} onChange={(e) => set('remarks', e.target.value)} /></div>
          </div>
        )}
      </Dialog>

      {ledger && <LedgerDialog loan={ledger} onClose={() => setLedger(null)} />}
    </div>
  );
}
