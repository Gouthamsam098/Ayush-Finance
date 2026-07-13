import { useMemo, useState } from 'react';
import { useData, LOAN_LABELS, isDailyLoan, isMonthlyLike, cycleDaysFor, type Loan, type PayMode } from '@/mock/DataContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { CollectionProgress } from '@/components/CollectionProgress';
import { buildLedgerReportPDF, shareOrDownloadPDF } from '@/lib/pdfReport';
import { inr, fmtDate, todayISO, initials, isoLocal, DAILY_TERM } from '@/lib/format';
import { Plus, Pencil, Trash2, Phone, FileDown } from 'lucide-react';

const MODES: PayMode[] = ['CASH', 'UPI', 'BANK', 'CHEQUE'];

/** Daily-collection ledger: 100 days, daily accrual + carry-forward, editable payments. */
export function LedgerDialog({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const d = useData();
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [amount, setAmount] = useState(String(loan.dailyAmount ?? ''));
  const [date, setDate] = useState(todayISO());
  const [mode, setMode] = useState<PayMode>('CASH');
  const [remarks, setRemarks] = useState('');

  const daily = loan.dailyAmount ?? 0;
  const totalDays = loan.numDays ?? DAILY_TERM;
  const cust = d.customers.find((c) => c.id === loan.customerId);
  const isMonthly = isMonthlyLike(loan.type); // Monthly Interest, Vehicle, Property — same 30-day-cycle model
  const isSimple = !isDailyLoan(loan.type) && !isMonthly; // Flexible only — no per-cycle model
  const progressTotal = isMonthly || isSimple ? (loan.type === 'FLEXIBLE' ? (loan.numDays ?? 30) : 30) : totalDays;

  const rows = useMemo(() => {
    if (isSimple || isMonthly) return [];
    const [ly, lm, ld] = loan.loanDate.split('-').map(Number);
    const [ty, tm, td] = todayISO().split('-').map(Number);
    const start = new Date(ly, lm - 1, ld);          // local midnight on loan date — no UTC shift
    const todayD = new Date(ty, tm - 1, td);
    const elapsed = Math.round((todayD.getTime() - start.getTime()) / 86400000) + 1; // inclusive of loan day + today
    const rowCount = Math.max(0, Math.min(elapsed, totalDays)); // only days up to today, within the term
    const out: {
      sn: number; date: string; due: number; collected: number; remaining: number;
      status: 'Paid' | 'Partial' | 'Due'; mode?: PayMode; receipt?: string; remarks?: string; id?: string;
    }[] = [];
    let cumCollected = 0;
    for (let i = 0; i < rowCount; i++) {
      const ds = isoLocal(new Date(ly, lm - 1, ld + i)); // local date arithmetic (handles month overflow)
      const dayColls = d.collections.filter((c) => c.loanId === loan.id && c.date === ds);
      const collected = dayColls.reduce((s, c) => s + c.amount, 0);
      cumCollected += collected;
      const remaining = Math.max(0, loan.principal - cumCollected); // principal still to collect
      const first = dayColls[0];
      out.push({
        sn: i + 1, date: ds, due: daily, collected, remaining,
        status: collected === 0 ? 'Due' : collected >= daily ? 'Paid' : 'Partial',
        mode: first?.mode, receipt: first?.receiptNo, remarks: first?.remarks, id: first?.id,
      });
    }
    return out;
  }, [loan, d.collections, daily, totalDays, isSimple, isMonthly]);

  // Monthly Interest: one row per 30-day cycle (current + completed), analogous to the daily rows above.
  const monthRows = useMemo(() => {
    if (!isMonthly) return [];
    const cycleLen = cycleDaysFor(loan);
    const [ly, lm, ld] = loan.loanDate.split('-').map(Number);
    const [ty, tm, td] = todayISO().split('-').map(Number);
    const start = new Date(ly, lm - 1, ld);
    const today = new Date(ty, tm - 1, td);
    const elapsedDays = Math.max(0, Math.round((today.getTime() - start.getTime()) / 86400000) + 1);
    const cycleCount = Math.max(1, Math.ceil(elapsedDays / cycleLen)); // include the current, in-progress cycle
    const out: { sn: number; start: string; end: string; collected: number; status: 'Paid' | 'Partial' | 'Due'; mode?: PayMode; date?: string; id?: string }[] = [];
    for (let i = 0; i < cycleCount; i++) {
      const cs = isoLocal(new Date(ly, lm - 1, ld + i * cycleLen));
      const ce = isoLocal(new Date(ly, lm - 1, ld + i * cycleLen + (cycleLen - 1)));
      const cycleColls = d.collections.filter((c) => c.loanId === loan.id && c.date >= cs && c.date <= ce);
      const collected = cycleColls.reduce((s, c) => s + c.amount, 0);
      const first = cycleColls[0];
      out.push({
        sn: i + 1, start: cs, end: ce, collected,
        status: collected === 0 ? 'Due' : collected >= loan.interest ? 'Paid' : 'Partial',
        mode: first?.mode, date: first?.date, id: first?.id,
      });
    }
    return out;
  }, [loan, d.collections, isMonthly]);

  const collected = d.collectedFor(loan.id);
  const todayStr = todayISO();
  const pending = Math.max(0, loan.principal - collected);
  const deduction = loan.deduction ?? loan.interest;
  const netDisbursed = Math.max(0, loan.principal - deduction);
  const paidDays = Math.min(d.collections.filter((c) => c.loanId === loan.id).length, progressTotal);
  const outstanding = d.outstandingFor(loan); // for Monthly Interest this already includes the shortfall (Principal + Total Due)
  const elapsedDays = rows.length; // for daily loans, rows already only cover elapsed days up to today
  const totalDue = isMonthly ? d.totalDueForMonthly(loan) : Math.max(0, elapsedDays * daily - collected); // cumulative shortfall vs what should've been collected by today
  const isInterestOnly = loan.type === 'DAILY_INTEREST';
  const dueDays = rows.filter((r) => r.status !== 'Paid').length; // elapsed days not yet fully paid

  const defaultAmount = () => String(loan.dailyAmount ?? (isMonthly ? loan.interest : ''));
  const openAdd = () => { setEditId(null); setAmount(defaultAmount()); setDate(todayISO()); setMode('CASH'); setRemarks(''); setAddOpen(true); };
  const openEdit = (c: { id: string; amount: number; date: string; mode: PayMode; remarks?: string }) => {
    setEditId(c.id); setAmount(String(c.amount)); setDate(c.date); setMode(c.mode); setRemarks(c.remarks ?? ''); setAddOpen(true);
  };
  const openRow = (r: { id?: string; date: string; collected: number; mode?: PayMode; remarks?: string }) => {
    if (r.id) openEdit({ id: r.id, amount: r.collected, date: r.date, mode: r.mode ?? 'CASH', remarks: r.remarks });
    else { setEditId(null); setAmount(defaultAmount()); setDate(r.date); setMode('CASH'); setRemarks(''); setAddOpen(true); }
  };
  const openMonthRow = (r: { id?: string; date?: string; end: string; collected: number; mode?: PayMode }) => {
    if (r.id && r.date) openEdit({ id: r.id, amount: r.collected, date: r.date, mode: r.mode ?? 'CASH' });
    else { setEditId(null); setAmount(String(loan.interest)); setDate(todayISO()); setMode('CASH'); setRemarks(''); setAddOpen(true); }
  };
  const addColl = () => {
    if (!Number(amount)) { toast('Enter an amount', 'error'); return; }
    if (editId) { d.updateCollection(editId, { amount: Number(amount), date, mode, remarks: remarks || undefined }); toast('Collection updated'); }
    else { d.addCollection({ loanId: loan.id, date, amount: Number(amount), mode, remarks: remarks || undefined }); toast('Collection recorded'); }
    setAddOpen(false); setEditId(null); setAmount(defaultAmount()); setRemarks('');
  };

  const summaryCards = isInterestOnly ? [
    { k: 'Principal', v: inr(loan.principal) },
    { k: 'Daily Interest (Fixed)', v: inr(daily) },
    { k: 'Interest Collected', v: inr(collected) },
    { k: 'Due Days', v: String(dueDays) },
  ] : isMonthly ? [
    { k: 'Principal', v: inr(loan.principal), sub: undefined as string | undefined },
    { k: 'Total Due Amount', v: inr(totalDue), sub: totalDue > 0 ? 'Shortfall vs. what\'s owed by today' : 'Fully up to date' },
    { k: 'Collected', v: inr(collected), sub: undefined as string | undefined },
    { k: 'Outstanding', v: inr(outstanding), sub: 'Principal + Total Due', hi: true },
  ] : isSimple ? [
    { k: 'Principal', v: inr(loan.principal), sub: undefined as string | undefined },
    { k: 'Interest', v: inr(loan.interest), sub: undefined as string | undefined },
    { k: 'Collected', v: inr(collected), sub: undefined as string | undefined },
    { k: 'Outstanding', v: inr(outstanding), sub: undefined as string | undefined, hi: true },
  ] : [
    { k: 'Principal', v: inr(loan.principal) },
    { k: 'Total Due Amount', v: inr(totalDue), sub: totalDue > 0 ? 'Shortfall vs. what\'s owed by today' : 'Fully up to date' },
    { k: 'Deduction', v: inr(deduction), sub: 'Deducted upfront' },
    { k: 'Net Disbursed', v: inr(netDisbursed), sub: 'Given to customer' },
    { k: 'Collected', v: inr(collected) },
    { k: 'Pending', v: inr(pending), sub: 'Principal − Collected', hi: true },
  ];

  const generateReport = async () => {
    let tableTitle = '', tableHead: string[] = [], tableBody: (string | number)[][] = [];
    if (isMonthly) {
      tableTitle = 'Cycle-by-Cycle Ledger';
      tableHead = ['SL No', 'Month', 'Interest Collected', 'Date', 'Payment Mode', 'Status'];
      tableBody = monthRows.map((r) => [r.sn, `Month ${r.sn} (${fmtDate(r.start)} – ${fmtDate(r.end)})`, r.collected ? inr(r.collected) : '—', r.date ? fmtDate(r.date) : '—', r.mode ?? '—', r.status]);
    } else if (isInterestOnly) {
      tableTitle = 'Day-by-Day Ledger';
      tableHead = ['Day', 'Collection Date', 'Interest Amount Collected', 'Payment Mode', 'Status'];
      tableBody = rows.map((r) => [r.sn, fmtDate(r.date), r.collected ? inr(r.collected) : '—', r.mode ?? '—', r.status]);
    } else if (!isSimple) {
      tableTitle = 'Day-by-Day Ledger';
      tableHead = ['Day', 'Collection Date', 'Daily Due', 'Amount', 'Principal Remaining', 'Payment Mode', 'Status', 'Remarks'];
      tableBody = rows.map((r) => [r.sn, fmtDate(r.date), inr(r.due), r.collected ? inr(r.collected) : '—', inr(r.remaining), r.mode ?? '—', r.status, r.remarks ?? '—']);
    } else {
      tableTitle = 'Recorded Payments';
      tableHead = ['Date', 'Amount', 'Mode'];
      tableBody = d.collections.filter((c) => c.loanId === loan.id).sort((a, b) => (a.date < b.date ? 1 : -1)).map((c) => [fmtDate(c.date), inr(c.amount), c.mode]);
    }
    const progress = !isInterestOnly ? { label: 'Collection Progress', paid: paidDays, total: progressTotal } : undefined;
    const doc = buildLedgerReportPDF({
      loanNumber: loan.loanNumber,
      loanTypeLabel: LOAN_LABELS[loan.type],
      customerName: cust?.name ?? '—',
      customerMobile: loan.contact || cust?.mobile || '—',
      loanDate: fmtDate(loan.loanDate),
      summary: summaryCards.map((c) => ({ label: c.k, value: c.v })),
      progress, tableTitle, tableHead, tableBody,
    });
    const filename = `Ledger-${loan.loanNumber}-${todayISO()}.pdf`;
    const result = await shareOrDownloadPDF(doc, filename);
    toast(result === 'shared' ? 'Report shared' : 'Report downloaded');
  };

  return (
    <Dialog open onClose={onClose} title={`Collection Ledger · ${loan.loanNumber}`} subtitle={isMonthly ? `${LOAN_LABELS[loan.type]} · 30-day cycles` : isSimple ? `${LOAN_LABELS[loan.type]} · Payment history` : `${LOAN_LABELS[loan.type]} · ${totalDays}-day term`} wide
      footer={<><Button variant="ghost" onClick={generateReport} title="Download or share a PDF of this ledger"><FileDown size={15} /> Generate Report</Button><Button onClick={onClose}>Close</Button></>}>
      {/* Customer information */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-blue-400 to-primary text-sm font-bold text-white">{initials(cust?.name ?? '—')}</div>
          <div>
            <div className="font-display text-base font-bold">{cust?.name ?? '—'}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted"><Phone size={12} /> {loan.contact || cust?.mobile || '—'} · {loan.loanNumber}</div>
          </div>
        </div>
        <div className="text-xs text-muted">Loan date: <span className="font-semibold text-slate-600 dark:text-slate-300">{fmtDate(loan.loanDate)}</span></div>
      </div>

      {/* Summary cards */}
      <div className={`mb-4 grid grid-cols-2 gap-3 ${isInterestOnly ? 'sm:grid-cols-2 lg:grid-cols-4' : isMonthly ? 'sm:grid-cols-2 lg:grid-cols-4' : isSimple ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3 lg:grid-cols-6'}`}>
        {summaryCards.map((c) => (
          <div key={c.k} title={c.sub} className={`rounded-xl border p-3 ${c.hi ? 'border-warning/30 bg-warning-50 dark:bg-warning/10' : 'border-slate-200 dark:border-slate-700'}`}>
            <div className="text-[11px] uppercase tracking-wide text-muted">{c.k}</div>
            <div className="mt-0.5 font-display text-base font-bold">{c.v}</div>
            {c.sub && <div className="text-[10px] text-muted">{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* Collection progress — not shown for Daily Interest (interest-only, no fixed repayment schedule to track) */}
      {!isInterestOnly && (
      <div className="mb-5 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">Collection Progress</div>
        <CollectionProgress paid={paidDays} total={progressTotal} showRemaining />
      </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-muted">
          {isMonthly ? 'One row per 30-day interest cycle since the loan date' : isSimple ? `Payment history for this loan · ${progressTotal}-day cycle` : `Daily ledger from ${fmtDate(loan.loanDate)} to today · ${totalDays}-day term · daily collection repays the principal`}
        </div>
        <Button variant="success" onClick={openAdd} className="!px-3 !py-1.5 text-xs transition-transform hover:scale-105" title="Add a collection"><Plus size={14} /> Add collection</Button>
      </div>

      {/* Monthly Interest: one row per 30-day cycle */}
      {isMonthly && (
        <div className="max-h-80 overflow-auto rounded-xl border border-slate-100 dark:border-white/[.06]">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-slate-100 [&>th]:px-3 [&>th]:py-2.5 [&>th]:shadow-[0_1px_0_rgba(15,23,42,0.08)] dark:[&>th]:bg-slate-800">
              <th>SL No</th><th>Month</th><th>Interest Collected</th><th>Date</th><th>Payment Mode</th><th>Status</th><th className="text-right">Edit</th>
            </tr></thead>
            <tbody>
              {monthRows.map((r) => {
                const border = r.status === 'Paid' ? 'border-l-success' : r.status === 'Partial' ? 'border-l-warning' : 'border-l-danger';
                return (
                  <tr key={r.sn} className={`border-t border-l-4 border-slate-100 dark:border-white/[.06] ${border}`}>
                    <td className="px-3 py-2 text-muted">{r.sn}</td>
                    <td className="px-3 py-2 whitespace-nowrap">Month {r.sn} · {fmtDate(r.start)} – {fmtDate(r.end)}</td>
                    <td className="px-3 py-2">{r.collected ? inr(r.collected) : '—'}</td>
                    <td className="px-3 py-2">{r.date ? fmtDate(r.date) : '—'}</td>
                    <td className="px-3 py-2">{r.mode ? <Badge tone="neutral">{r.mode}</Badge> : <span className="text-muted">—</span>}</td>
                    <td className="px-3 py-2"><Badge tone={r.status === 'Paid' ? 'ok' : r.status === 'Partial' ? 'warn' : 'err'}>{r.status}</Badge></td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => openMonthRow(r)} title={r.id ? 'Edit this payment' : 'Record payment for this cycle'} aria-label="Edit"
                        className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-primary-50 hover:text-primary"><Pencil size={14} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Day-by-day ledger with sticky header — daily loans only */}
      {!isSimple && !isMonthly && (
      <div className="max-h-80 overflow-auto rounded-xl border border-slate-100 dark:border-white/[.06]">
        <table className={`w-full text-sm ${isInterestOnly ? '' : 'min-w-[760px]'}`}>
          {isInterestOnly ? (
            <>
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-slate-100 [&>th]:px-3 [&>th]:py-2.5 [&>th]:shadow-[0_1px_0_rgba(15,23,42,0.08)] dark:[&>th]:bg-slate-800">
                <th>Day</th><th>Collection Date</th><th>Interest Amount Collected</th><th>Payment Mode</th><th>Status</th><th className="text-right">Edit</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const border = r.status === 'Paid' ? 'border-l-success' : r.status === 'Partial' ? 'border-l-warning' : 'border-l-danger';
                  return (
                    <tr key={r.sn} className={`border-t border-l-4 border-slate-100 dark:border-white/[.06] ${border}`}>
                      <td className="px-3 py-2 text-muted">{r.sn}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.date)}{r.date === todayStr && <span className="ml-1 text-[10px] font-bold text-primary">• today</span>}</td>
                      <td className="px-3 py-2">{r.collected ? inr(r.collected) : '—'}</td>
                      <td className="px-3 py-2">{r.mode ? <Badge tone="neutral">{r.mode}</Badge> : <span className="text-muted">—</span>}</td>
                      <td className="px-3 py-2"><Badge tone={r.status === 'Paid' ? 'ok' : r.status === 'Partial' ? 'warn' : 'err'}>{r.status}</Badge></td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => openRow(r)} title={r.id ? 'Edit this payment' : 'Record payment for this day'} aria-label="Edit"
                          className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-primary-50 hover:text-primary"><Pencil size={14} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </>
          ) : (
            <>
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-slate-100 [&>th]:px-3 [&>th]:py-2.5 [&>th]:shadow-[0_1px_0_rgba(15,23,42,0.08)] dark:[&>th]:bg-slate-800">
                <th>Day</th><th>Collection Date</th><th>Daily Due</th><th>Amount</th><th>Principal Remaining</th><th>Payment Mode</th><th>Status</th><th className="text-right">Edit</th><th>Remarks</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const border = r.status === 'Paid' ? 'border-l-success' : r.status === 'Partial' ? 'border-l-warning' : 'border-l-danger';
                  return (
                    <tr key={r.sn} className={`border-t border-l-4 border-slate-100 dark:border-white/[.06] ${border}`}>
                      <td className="px-3 py-2 text-muted">{r.sn}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.date)}{r.date === todayStr && <span className="ml-1 text-[10px] font-bold text-primary">• today</span>}</td>
                      <td className="px-3 py-2">{inr(r.due)}</td>
                      <td className="px-3 py-2">{r.collected ? inr(r.collected) : '—'}</td>
                      <td className="px-3 py-2 font-medium">{inr(r.remaining)}</td>
                      <td className="px-3 py-2">{r.mode ? <Badge tone="neutral">{r.mode}</Badge> : <span className="text-muted">—</span>}</td>
                      <td className="px-3 py-2"><Badge tone={r.status === 'Paid' ? 'ok' : r.status === 'Partial' ? 'warn' : 'err'}>{r.status}</Badge></td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => openRow(r)} title={r.id ? 'Edit this payment' : 'Record payment for this day'} aria-label="Edit"
                          className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-primary-50 hover:text-primary"><Pencil size={14} /></button>
                      </td>
                      <td className="px-3 py-2 text-muted">{r.remarks ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </>
          )}
        </table>
      </div>
      )}

      {/* Recorded payments — editable; for non-daily loans this IS the payment history list */}
      <div className="mt-5">
        <div className="mb-2 text-sm font-semibold">Recorded payments ({d.collections.filter((c) => c.loanId === loan.id).length})</div>
        <div className="space-y-2">
          {d.collections.filter((c) => c.loanId === loan.id).sort((a, b) => (a.date < b.date ? 1 : -1)).map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-xl border border-slate-100 dark:border-white/[.06] px-3 py-2.5 text-sm">
              <div className="flex items-center gap-3">
                <span>{fmtDate(c.date)}</span>
                <Badge tone="neutral">{c.mode}</Badge>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-display font-semibold text-success">{inr(c.amount)}</span>
                <button onClick={() => openEdit(c)} title="Edit payment" aria-label="Edit payment" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-primary-50 hover:text-primary"><Pencil size={14} /></button>
                <button onClick={() => { d.deleteCollection(c.id); toast('Payment deleted', 'info'); }} title="Delete payment" aria-label="Delete payment" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger-50 hover:text-danger"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
          {d.collections.filter((c) => c.loanId === loan.id).length === 0 && <p className="text-sm text-muted">No payments recorded yet.</p>}
        </div>
      </div>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title={editId ? 'Edit collection' : 'Add collection'} subtitle={loan.loanNumber}
        footer={<><Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button><Button onClick={addColl}>{editId ? 'Save changes' : 'Save'}</Button></>}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Select label="Payment mode" value={mode} onChange={(e) => setMode(e.target.value as PayMode)} options={MODES.map((m) => ({ value: m, label: m }))} />
          <Input label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
      </Dialog>
    </Dialog>
  );
}
