import { useMemo, useState } from 'react';
import { useData, EXPENSE_CATEGORIES, EXPENSE_SUB_CATEGORIES, type PayMode, type Expense } from '@/mock/DataContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/PageHeader';
import { CountUp } from '@/components/motion';
import { inr, inrShort, fmtDate, todayISO, isoLocal } from '@/lib/format';
import { Plus, Pencil, Trash2 } from 'lucide-react';

const MODES: PayMode[] = ['CASH', 'UPI', 'BANK', 'CHEQUE'];
const monthKey = (offset: number) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - offset); return isoLocal(d).slice(0, 7); };
const monthLabel = (key: string) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); };
/** ISO date N months/years before today, local calendar. */
const monthsAgoISO = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() - n); return isoLocal(d); };
const yearsAgoISO = (n: number) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return isoLocal(d); };

interface EForm { id?: number; date: string; category: string; subCategory: string; name: string; amount: string; mode: PayMode; remarks: string; }
const blank = (): EForm => ({ date: todayISO(), category: EXPENSE_CATEGORIES[0], subCategory: '', name: '', amount: '', mode: 'CASH', remarks: '' });

export default function Expenses() {
  const d = useData();
  const toast = useToast();
  const [form, setForm] = useState<EForm | null>(null);
  const [confirm, setConfirm] = useState<Expense | null>(null);
  const months = [monthKey(0), monthKey(1), monthKey(2)];
  const [filter, setFilter] = useState<'THIS_MONTH' | 'LAST_6M' | 'LAST_1Y' | 'ALL'>('THIS_MONTH');

  const totalFor = (key: string) => d.expenses.filter((e) => e.date.slice(0, 7) === key).reduce((s, e) => s + e.amount, 0);

  const rows = useMemo(() => {
    if (filter === 'ALL') return d.expenses;
    if (filter === 'THIS_MONTH') return d.expenses.filter((e) => e.date.slice(0, 7) === months[0]);
    if (filter === 'LAST_6M') { const since = monthsAgoISO(6); return d.expenses.filter((e) => e.date >= since); }
    const since = yearsAgoISO(1); return d.expenses.filter((e) => e.date >= since);
  }, [d.expenses, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof EForm, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const save = () => {
    if (!form) return;
    if (!form.name || !Number(form.amount)) { toast('Name and amount are required', 'error'); return; }
    const payload = { date: form.date, category: form.category, subCategory: form.subCategory || undefined, name: form.name, amount: Number(form.amount), mode: form.mode, remarks: form.remarks || undefined };
    if (form.id) { d.updateExpense(form.id, payload); toast('Expense updated'); }
    else { d.addExpense(payload); toast('Expense added'); }
    setForm(null);
  };

  const chips = [
    { key: 'THIS_MONTH', label: 'This Month' },
    { key: 'LAST_6M', label: 'Last 6 Months' },
    { key: 'LAST_1Y', label: 'Last 1 Year' },
    { key: 'ALL', label: 'All Time' },
  ];

  return (
    <div className="space-y-5 p-3.5 sm:p-5">
      <PageHeader title="Expenses" subtitle={`${d.expenses.length} entries`}
        action={<Button onClick={() => setForm(blank())}><Plus size={16} /> Add Expense</Button>} />

      {/* current + previous 2 months */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {months.map((m, i) => (
          <Card key={m} tilt className="anim-pop p-5" style={{ animationDelay: `${i * 70}ms` }}>
            <div className="text-[13px] text-muted">{monthLabel(m)}{i === 0 && ' · current'}</div>
            <div className="mt-1 font-display text-2xl font-bold"><CountUp value={totalFor(m)} format={inrShort} /></div>
            <div className="mt-1 text-xs text-muted">{d.expenses.filter((e) => e.date.slice(0, 7) === m).length} entries</div>
          </Card>
        ))}
      </div>

      <Card className="anim-pop p-4" style={{ animationDelay: '200ms' }}>
        <div className="mb-4 flex flex-wrap gap-2">
          {chips.map((c) => (
            <button key={c.key} onClick={() => setFilter(c.key as typeof filter)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${filter === c.key ? 'bg-primary text-white' : 'border border-slate-200 dark:border-slate-700 text-muted hover:bg-slate-50 dark:hover:bg-white/[.05]'}`}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[650px] text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="py-2.5 pr-3">Date</th><th className="py-2.5 pr-3">Category</th><th className="py-2.5 pr-3">Sub Category</th><th className="py-2.5 pr-3">Name</th><th className="py-2.5 pr-3">Amount</th><th className="py-2.5 pr-3">Mode</th><th className="py-2.5 text-right">Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={e.id} style={{ animationDelay: `${Math.min(i * 30, 350)}ms` }}
                  className="anim-pop border-t border-slate-100 dark:border-white/[.06] transition-colors hover:bg-primary-50/40 dark:hover:bg-primary/[.06]">
                  <td className="py-3 pr-3">{fmtDate(e.date)}</td>
                  <td className="py-3 pr-3"><Badge tone="info">{e.category}</Badge></td>
                  <td className="py-3 pr-3">{e.subCategory ? <Badge tone="neutral">{e.subCategory}</Badge> : <span className="text-muted">—</span>}</td>
                  <td className="py-3 pr-3 font-medium">{e.name}</td>
                  <td className="py-3 pr-3 font-display font-semibold text-danger">{inr(e.amount)}</td>
                  <td className="py-3 pr-3"><Badge tone="neutral">{e.mode}</Badge></td>
                  <td className="py-3">
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => setForm({ id: e.id, date: e.date, category: e.category, subCategory: e.subCategory ?? '', name: e.name, amount: String(e.amount), mode: e.mode, remarks: e.remarks ?? '' })}
                        className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-primary-50 hover:text-primary" title="Edit"><Pencil size={15} /></button>
                      <button onClick={() => setConfirm(e)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger-50 hover:text-danger" title="Delete"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-muted">No expenses in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit expense' : 'Add expense'}
        footer={<><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button onClick={save}>{form?.id ? 'Save changes' : 'Save'}</Button></>}>
        {form && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Date" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
            <Select label="Category" value={form.category} onChange={(e) => set('category', e.target.value)} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))} />
            <Select label="Sub category" value={form.subCategory} onChange={(e) => set('subCategory', e.target.value)}
              options={[{ value: '', label: '— None —' }, ...EXPENSE_SUB_CATEGORIES.map((c) => ({ value: c, label: c }))]} />
            <div className="sm:col-span-2"><Input label="Expense name" value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
            <Input label="Amount" type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
            <Select label="Payment mode" value={form.mode} onChange={(e) => set('mode', e.target.value as PayMode)} options={MODES.map((m) => ({ value: m, label: m }))} />
            <div className="sm:col-span-2"><Input label="Remarks" value={form.remarks} onChange={(e) => set('remarks', e.target.value)} /></div>
          </div>
        )}
      </Dialog>

      <Dialog open={!!confirm} onClose={() => setConfirm(null)} title="Delete expense?" subtitle={confirm ? `${confirm.name} · ${inr(confirm.amount)}` : ''}
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { if (confirm) { d.deleteExpense(confirm.id); toast('Expense deleted', 'info'); } setConfirm(null); }}>Delete</Button></>}>
        <p className="text-sm text-muted">This removes the expense from the demo dataset.</p>
      </Dialog>
    </div>
  );
}
