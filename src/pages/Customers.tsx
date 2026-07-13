import { useMemo, useState } from 'react';
import { useData, LOAN_LABELS, type Customer } from '@/mock/DataContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/PageHeader';
import { inr, fmtDate, initials } from '@/lib/format';
import { Search, Plus, Eye, Pencil, Trash2 } from 'lucide-react';

type FormState = Partial<Customer>;
const empty: FormState = { name: '', mobile: '' };

export default function Customers() {
  const d = useData();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [view, setView] = useState<Customer | null>(null);
  const [confirm, setConfirm] = useState<Customer | null>(null);

  const rows = useMemo(() => {
    const t = q.toLowerCase().trim();
    return d.customers.filter((c) => !t || c.name.toLowerCase().includes(t) || c.mobile.includes(t) || c.code.toLowerCase().includes(t));
  }, [d.customers, q]);

  const openAdd = () => { setEditId(null); setForm({ ...empty }); };
  const openEdit = (c: Customer) => { setEditId(c.id); setForm({ ...c }); };
  const set = (k: keyof Customer, v: string) => setForm((f) => ({ ...f, [k]: k === 'monthlyIncome' ? Number(v) || undefined : v }));

  const save = () => {
    if (!form?.name || !form?.mobile) { toast('Name and mobile are required', 'error'); return; }
    if (editId) { d.updateCustomer(editId, form); toast('Customer updated'); }
    else { d.addCustomer(form as Omit<Customer, 'id' | 'code' | 'createdAt'>); toast('Customer added'); }
    setForm(null);
  };

  const loansOf = (id: string) => d.loans.filter((l) => l.customerId === id);

  return (
    <div className="space-y-5">
      <PageHeader title="Customers" subtitle={`${d.customers.length} total · manage KYC and profiles`}
        action={<Button onClick={openAdd}><Plus size={16} /> Add Customer</Button>} />

      <Card className="anim-pop p-4" style={{ animationDelay: '80ms' }}>
        <div className="relative mb-4 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, mobile, or code…"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-surface py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="py-2.5 pr-3">Customer</th><th className="py-2.5 pr-3">Code</th><th className="py-2.5 pr-3">Mobile</th><th className="py-2.5 pr-3">City</th><th className="py-2.5 pr-3">Loans</th><th className="py-2.5 text-right">Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={c.id} style={{ animationDelay: `${Math.min(i * 35, 400)}ms` }}
                  className="anim-pop group border-t border-slate-100 dark:border-white/[.06] transition-colors hover:bg-primary-50/40 dark:hover:bg-primary/[.06]">
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-primary-400 to-primary text-xs font-bold text-white shadow-soft transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">{initials(c.name)}</div>
                      <div><div className="font-semibold">{c.name}</div>{c.occupation && <div className="text-[11px] text-muted">{c.occupation}</div>}</div>
                    </div>
                  </td>
                  <td className="py-3 pr-3 font-mono text-xs text-muted">{c.code}</td>
                  <td className="py-3 pr-3">{c.mobile}</td>
                  <td className="py-3 pr-3 text-muted">{c.city ?? '—'}</td>
                  <td className="py-3 pr-3"><Badge tone="info">{loansOf(c.id).length}</Badge></td>
                  <td className="py-3">
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => setView(c)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-primary-50 hover:text-primary" title="View"><Eye size={15} /></button>
                      <button onClick={() => openEdit(c)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-primary-50 hover:text-primary" title="Edit"><Pencil size={15} /></button>
                      <button onClick={() => setConfirm(c)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger-50 hover:text-danger" title="Delete"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-muted">No customers match “{q}”.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add / Edit */}
      <Dialog open={!!form} onClose={() => setForm(null)} title={editId ? 'Edit customer' : 'Add customer'}
        subtitle={editId ? undefined : `New code: ${d.nextCode()}`}
        footer={<><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button onClick={save}>{editId ? 'Save changes' : 'Add customer'}</Button></>}>
        {form && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Full name *" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} />
            <Input label="Father's name" value={form.fatherName ?? ''} onChange={(e) => set('fatherName', e.target.value)} />
            <Input label="Mobile *" value={form.mobile ?? ''} onChange={(e) => set('mobile', e.target.value)} />
            <Input label="Alternate mobile" value={form.altMobile ?? ''} onChange={(e) => set('altMobile', e.target.value)} />
            <Input label="Occupation" value={form.occupation ?? ''} onChange={(e) => set('occupation', e.target.value)} />
            <Input label="Monthly income" type="number" value={form.monthlyIncome ?? ''} onChange={(e) => set('monthlyIncome', e.target.value)} />
            <div className="sm:col-span-2"><Input label="Address" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} /></div>
            <Input label="City" value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} />
            <Input label="State" value={form.state ?? ''} onChange={(e) => set('state', e.target.value)} />
            <Input label="Pincode" value={form.pincode ?? ''} onChange={(e) => set('pincode', e.target.value)} />
            <Input label="Reference name" value={form.referenceName ?? ''} onChange={(e) => set('referenceName', e.target.value)} />
            <Input label="Reference mobile" value={form.referenceMobile ?? ''} onChange={(e) => set('referenceMobile', e.target.value)} />
          </div>
        )}
      </Dialog>

      {/* View detail */}
      <Dialog open={!!view} onClose={() => setView(null)} title={view?.name ?? ''} subtitle={view?.code} wide>
        {view && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              {([['Mobile', view.mobile], ['Alt. mobile', view.altMobile], ['Occupation', view.occupation],
                 ['Monthly income', view.monthlyIncome ? inr(view.monthlyIncome) : undefined], ['City', view.city], ['State', view.state],
                 ['Pincode', view.pincode], ['Reference', view.referenceName], ['Ref. mobile', view.referenceMobile],
                 ['Address', view.address], ['Since', fmtDate(view.createdAt)]] as [string, string | undefined][])
                .map(([k, v]) => (
                  <div key={k}><div className="text-[11px] uppercase tracking-wide text-muted">{k}</div><div className="font-medium">{v || '—'}</div></div>
                ))}
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold">Loans ({loansOf(view.id).length})</div>
              <div className="space-y-2">
                {loansOf(view.id).map((l) => (
                  <div key={l.id} className="flex items-center justify-between rounded-xl border border-slate-100 dark:border-white/[.06] px-3 py-2.5 text-sm">
                    <div className="flex items-center gap-2"><span className="font-mono text-xs text-muted">{l.loanNumber}</span><Badge tone="info">{LOAN_LABELS[l.type]}</Badge></div>
                    <div className="flex items-center gap-4"><span className="text-muted">{inr(l.principal)}</span><span className="font-semibold">Out: {inr(d.outstandingFor(l))}</span></div>
                  </div>
                ))}
                {loansOf(view.id).length === 0 && <p className="text-sm text-muted">No loans yet.</p>}
              </div>
            </div>
          </div>
        )}
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} title="Delete customer?"
        subtitle={confirm ? `${confirm.name} (${confirm.code})` : ''}
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { if (confirm) { d.deleteCustomer(confirm.id); toast('Customer and related records deleted', 'info'); } setConfirm(null); }}>Delete everything</Button></>}>
        {confirm && (() => {
          const custLoanList = d.loans.filter((l) => l.customerId === confirm.id);
          const loanIds = new Set(custLoanList.map((l) => l.id));
          const colCount = d.collections.filter((c) => loanIds.has(c.loanId)).length;
          const docCount = d.documents.filter((doc) => doc.customerId === confirm.id).length;
          const parts = [`${custLoanList.length} loan${custLoanList.length === 1 ? '' : 's'}`, `${colCount} collection${colCount === 1 ? '' : 's'}`];
          if (docCount) parts.push(`${docCount} document${docCount === 1 ? '' : 's'}`);
          return (
            <div className="space-y-2 text-sm text-muted">
              <p>This permanently removes <span className="font-semibold text-slate-700 dark:text-slate-200">{confirm.name}</span> and <span className="font-semibold text-danger">all their linked records</span> from every screen (Loans, Collections, Documents, Reports, SMS).</p>
              <p>Will also delete: <span className="font-semibold">{parts.join(', ')}</span>.</p>
              <p>This cannot be undone.</p>
            </div>
          );
        })()}
      </Dialog>
    </div>
  );
}
