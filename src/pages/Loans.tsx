import { useMemo, useState } from 'react';
import { useData, LOAN_LABELS, isDailyLoan, type Loan, type LoanType } from '@/mock/DataContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/PageHeader';
import { inr, fmtDate, todayISO, addDays, DAILY_TERM } from '@/lib/format';
import { Plus, ScrollText, Lock, Pencil, Trash2, CheckCircle2, RotateCcw } from 'lucide-react';
import { LedgerDialog } from '@/components/LedgerDialog';

const TYPE_OPTS = (Object.keys(LOAN_LABELS) as LoanType[]).map((v) => ({ value: v, label: LOAN_LABELS[v] }));

interface LoanForm {
  id?: string; customerId: string; type: LoanType; principal: string; rate: string; loanDate: string;
  contact: string; remarks: string; dailyAmount: string; numDays: string;
  vehicleNumber: string; vehicleBrand: string; vehicleName: string;
}
const blank = (): LoanForm => ({
  customerId: '', type: 'DAILY_COLLECTION', principal: '', rate: '', loanDate: todayISO(),
  contact: '', remarks: '', dailyAmount: '', numDays: '30', vehicleNumber: '', vehicleBrand: '', vehicleName: '',
});

export default function Loans() {
  const d = useData();
  const toast = useToast();
  const [form, setForm] = useState<LoanForm | null>(null);
  const [ledger, setLedger] = useState<Loan | null>(null);
  const [confirm, setConfirm] = useState<Loan | null>(null);
  const [closeTarget, setCloseTarget] = useState<Loan | null>(null);
  const [typeFilter, setTypeFilter] = useState<LoanType | 'ALL'>('ALL');

  const custName = (id: string) => d.customers.find((c) => c.id === id)?.name ?? '—';
  const interest = form ? Math.round(((Number(form.principal) || 0) * (Number(form.rate) || 0)) / 100) : 0;
  const deduction = interest;
  const netDisbursed = Math.max(0, (form ? Number(form.principal) || 0 : 0) - deduction);
  const set = <K extends keyof LoanForm>(k: K, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const filtered = useMemo(() => (typeFilter === 'ALL' ? d.loans : d.loans.filter((l) => l.type === typeFilter)), [d.loans, typeFilter]);
  const counts = useMemo(() => {
    const m: Record<string, number> = { ALL: d.loans.length };
    (Object.keys(LOAN_LABELS) as LoanType[]).forEach((t) => (m[t] = d.loans.filter((l) => l.type === t).length));
    return m;
  }, [d.loans]);

  const save = () => {
    if (!form) return;
    if (!form.customerId) { toast('Select a customer', 'error'); return; }
    if (!Number(form.principal) || (form.type !== 'DAILY_INTEREST' && !form.rate)) { toast('Principal and interest rate are required', 'error'); return; }
    if (isDailyLoan(form.type) && !Number(form.dailyAmount)) { toast('Enter the daily collection amount', 'error'); return; }
    if (form.type === 'FLEXIBLE' && !(Number(form.numDays) > 0)) { toast('Enter a valid number of days', 'error'); return; }
    const monthly = form.type === 'MONTHLY_INTEREST' || form.type === 'VEHICLE' || form.type === 'PROPERTY';
    const payload = {
      customerId: form.customerId, type: form.type, principal: Number(form.principal), rate: form.type === 'DAILY_INTEREST' ? 0 : Number(form.rate),
      loanDate: form.loanDate, contact: form.contact || undefined, remarks: form.remarks || undefined,
      dailyAmount: isDailyLoan(form.type) ? Number(form.dailyAmount) : undefined,
      numDays: form.type === 'FLEXIBLE' ? Number(form.numDays) : isDailyLoan(form.type) ? DAILY_TERM : undefined,
      nextDueDate: form.type === 'FLEXIBLE' ? addDays(form.loanDate, Number(form.numDays))
        : isDailyLoan(form.type) ? addDays(form.loanDate, 1)
        : monthly ? addDays(form.loanDate, 30) : undefined,
      vehicleNumber: form.type === 'VEHICLE' ? form.vehicleNumber : undefined,
      vehicleBrand: form.type === 'VEHICLE' ? form.vehicleBrand : undefined,
      vehicleName: form.type === 'VEHICLE' ? form.vehicleName : undefined,
    };
    if (form.id) { d.updateLoan(form.id, payload); toast('Loan updated'); }
    else { d.addLoan(payload); toast('Loan created'); }
    setForm(null);
  };

  const editLoan = (l: Loan) => setForm({
    id: l.id, customerId: l.customerId, type: l.type, principal: String(l.principal), rate: String(l.rate), loanDate: l.loanDate,
    contact: l.contact ?? '', remarks: l.remarks ?? '', dailyAmount: String(l.dailyAmount ?? ''), numDays: String(l.numDays ?? 30),
    vehicleNumber: l.vehicleNumber ?? '', vehicleBrand: l.vehicleBrand ?? '', vehicleName: l.vehicleName ?? '',
  });

  const badgeTone = (t: LoanType) => (isDailyLoan(t) ? 'ok' : t === 'VEHICLE' || t === 'PROPERTY' ? 'warn' : 'info');
  const dailyEnd = form && isDailyLoan(form.type) ? addDays(form.loanDate, DAILY_TERM) : null;

  return (
    <div className="space-y-5">
      <PageHeader title="Loans" subtitle={`${d.loans.length} loans · 5 types with automatic interest`}
        action={<Button onClick={() => setForm(blank())}><Plus size={16} /> Create Loan</Button>} />

      {/* Loan type filter chips */}
      <div className="flex flex-wrap gap-2">
        {([['ALL', 'All'], ...TYPE_OPTS.map((o) => [o.value, o.label] as const)] as [string, string][]).map(([val, label]) => {
          const activeChip = typeFilter === val;
          return (
            <button key={val} onClick={() => setTypeFilter(val as LoanType | 'ALL')}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${activeChip ? 'bg-primary text-white shadow-md' : 'border border-slate-200 dark:border-slate-700 text-muted hover:bg-slate-50 dark:hover:bg-white/[.05]'}`}>
              {label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${activeChip ? 'bg-white/25' : 'bg-slate-100 dark:bg-slate-800'}`}>{counts[val] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <Card className="anim-pop p-4" style={{ animationDelay: '80ms' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="py-2.5 pr-3">Loan #</th><th className="py-2.5 pr-3">Customer</th><th className="py-2.5 pr-3">Type</th><th className="py-2.5 pr-3">Principal</th>
              <th className="py-2.5 pr-3">Interest</th><th className="py-2.5 pr-3">Outstanding</th><th className="py-2.5 pr-3">Loan date</th><th className="py-2.5 pr-3">Next due</th><th className="py-2.5 pr-3">Status</th><th className="py-2.5 text-center">Actions</th>
            </tr></thead>
            <tbody>
              {filtered.map((l, i) => (
                <tr key={l.id} style={{ animationDelay: `${Math.min(i * 35, 400)}ms` }}
                  className="anim-pop border-t border-slate-100 dark:border-white/[.06] transition-colors hover:bg-primary-50/40 dark:hover:bg-primary/[.06]">
                  <td className="py-3 pr-3 font-mono text-xs">{l.loanNumber}</td>
                  <td className="py-3 pr-3 font-medium">{custName(l.customerId)}</td>
                  <td className="py-3 pr-3"><Badge tone={badgeTone(l.type)}>{LOAN_LABELS[l.type]}</Badge></td>
                  <td className="py-3 pr-3">{inr(l.principal)}</td>
                  <td className="py-3 pr-3 text-muted">{inr(l.interest)}</td>
                  <td className="py-3 pr-3 font-display font-semibold">{inr(d.outstandingFor(l))}</td>
                  <td className="py-3 pr-3 text-muted">{fmtDate(l.loanDate)}</td>
                  <td className="py-3 pr-3 text-muted">
                    {isDailyLoan(l.type)
                      ? (() => { const nd = d.nextDueForDaily(l); return nd ? fmtDate(nd) : <span className="font-semibold text-success">Completed</span>; })()
                      : l.nextDueDate ? fmtDate(l.nextDueDate) : '—'}
                  </td>
                  <td className="py-3 pr-3"><Badge tone={l.status === 'ACTIVE' ? 'ok' : 'neutral'}>{l.status}</Badge></td>
                  <td className="py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <button onClick={() => setLedger(l)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-muted hover:border-primary/40 hover:text-primary" title="View Report"><ScrollText size={14} /> View Report</button>
                      {l.status === 'ACTIVE' ? (
                        <button
                          onClick={() => {
                            const outstanding = d.outstandingFor(l);
                            if (outstanding > 0) { toast(`Cannot close — outstanding balance of ${inr(outstanding)} remains`, 'error'); return; }
                            setCloseTarget(l);
                          }}
                          className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-success-50 hover:text-success" title="Close loan"><CheckCircle2 size={15} /></button>
                      ) : (
                        <button
                          onClick={() => { d.updateLoan(l.id, { status: 'ACTIVE' }); toast('Loan reopened'); }}
                          className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-primary-50 hover:text-primary" title="Reopen loan"><RotateCcw size={15} /></button>
                      )}
                      <button onClick={() => editLoan(l)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-primary-50 hover:text-primary" title="Edit"><Pencil size={15} /></button>
                      <button onClick={() => setConfirm(l)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger-50 hover:text-danger" title="Delete"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={10} className="py-10 text-center text-muted">No loans of this type.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Create / Edit loan */}
      <Dialog open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit loan' : 'Create loan'} subtitle={form && !form.id ? `New number: ${d.nextLoanNo()}` : undefined} wide
        footer={<><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button onClick={save}>{form?.id ? 'Save changes' : 'Create loan'}</Button></>}>
        {form && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select label="Customer *" value={form.customerId} onChange={(e) => set('customerId', e.target.value)}
              options={[{ value: '', label: 'Select customer…' }, ...d.customers.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))]} />
            <Select label="Loan type *" value={form.type} onChange={(e) => set('type', e.target.value)} options={TYPE_OPTS} />
            <Input label="Principal amount *" type="number" value={form.principal} onChange={(e) => set('principal', e.target.value)} />
            {form.type !== 'DAILY_INTEREST' && (
              <>
                <Input label="Interest rate (%) *" type="number" step="0.01" value={form.rate} onChange={(e) => set('rate', e.target.value)} />
                <div>
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">Interest amount (auto)</span>
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm font-display font-bold">
                    <Lock size={13} className="text-muted" /> {inr(interest)}
                  </div>
                </div>
              </>
            )}
            {form.type === 'DAILY_COLLECTION' && (
              <>
                <div>
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">Deduction (auto)</span>
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm font-display font-bold">
                    <Lock size={13} className="text-muted" /> {inr(deduction)}
                  </div>
                  <div className="mt-1 text-[10px] text-muted">Interest deducted upfront</div>
                </div>
                <div>
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">Net disbursed (auto)</span>
                  <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success-50 dark:bg-success/10 px-3.5 py-2.5 text-sm font-display font-bold text-success">
                    <Lock size={13} /> {inr(netDisbursed)}
                  </div>
                  <div className="mt-1 text-[10px] text-muted">Principal − Deduction (given to customer)</div>
                </div>
              </>
            )}
            <Input label="Loan date" type="date" value={form.loanDate} onChange={(e) => set('loanDate', e.target.value)} />

            {isDailyLoan(form.type) && (
              <Input label={form.type === 'DAILY_INTEREST' ? 'Daily interest amount *' : 'Daily collection amount *'} type="number" value={form.dailyAmount} onChange={(e) => set('dailyAmount', e.target.value)} />
            )}
            {form.type === 'DAILY_COLLECTION' && (
              <>
                <div>
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">Loan period (fixed)</span>
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm font-semibold">
                    <Lock size={13} className="text-muted" /> 100 days
                  </div>
                </div>
                <p className="sm:col-span-2 text-xs text-muted">{inr(deduction)} interest is deducted upfront; the customer receives {inr(netDisbursed)}. Daily collection repays the full principal ({inr(form ? Number(form.principal) || 0 : 0)}) over 100 days{dailyEnd ? ` — ends ${fmtDate(dailyEnd)}` : ''}.</p>
              </>
            )}
            {form.type === 'FLEXIBLE' && (
              <Input label="Number of days *" type="number" min="1" placeholder="e.g. 10" value={form.numDays} onChange={(e) => set('numDays', e.target.value)} />
            )}
            {form.type === 'VEHICLE' && (
              <>
                <Input label="Vehicle number *" value={form.vehicleNumber} onChange={(e) => set('vehicleNumber', e.target.value)} />
                <Input label="Vehicle brand" value={form.vehicleBrand} onChange={(e) => set('vehicleBrand', e.target.value)} />
                <Input label="Vehicle name" value={form.vehicleName} onChange={(e) => set('vehicleName', e.target.value)} />
              </>
            )}
            <Input label="Contact number" value={form.contact} onChange={(e) => set('contact', e.target.value)} />
            <div className="sm:col-span-2"><Input label="Remarks" value={form.remarks} onChange={(e) => set('remarks', e.target.value)} /></div>
          </div>
        )}
      </Dialog>

      {ledger && <LedgerDialog loan={ledger} onClose={() => setLedger(null)} />}

      <Dialog open={!!confirm} onClose={() => setConfirm(null)} title="Delete loan?" subtitle={confirm ? `${confirm.loanNumber} · ${custName(confirm.customerId)}` : ''}
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { if (confirm) { d.deleteLoan(confirm.id); toast('Loan deleted', 'info'); } setConfirm(null); }}>Delete</Button></>}>
        <p className="text-sm text-muted">This removes the loan from the demo dataset. Its collections remain in history.</p>
      </Dialog>

      <Dialog open={!!closeTarget} onClose={() => setCloseTarget(null)} title="Close this loan?" subtitle={closeTarget ? `${closeTarget.loanNumber} · ${custName(closeTarget.customerId)}` : ''}
        footer={<><Button variant="ghost" onClick={() => setCloseTarget(null)}>Cancel</Button>
          <Button variant="success" onClick={() => { if (closeTarget) { d.closeLoan(closeTarget.id); toast('Loan closed'); } setCloseTarget(null); }}>Close Loan</Button></>}>
        {closeTarget && (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted">Customer</span><span className="font-semibold">{custName(closeTarget.customerId)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Loan Number</span><span className="font-mono font-semibold">{closeTarget.loanNumber}</span></div>
            <div className="flex justify-between"><span className="text-muted">Principal</span><span className="font-semibold">{inr(closeTarget.principal)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Outstanding</span><span className="font-semibold text-success">{inr(d.outstandingFor(closeTarget))}</span></div>
            <p className="pt-2 text-xs text-muted">This loan will be marked as Closed and hidden from active collections. You can reopen it later if needed.</p>
          </div>
        )}
      </Dialog>
    </div>
  );
}
