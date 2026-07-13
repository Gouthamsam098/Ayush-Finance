import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useData, LOAN_LABELS, isDailyLoan, type Loan, type LoanType } from '@/mock/DataContext';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { CountUp } from '@/components/motion';
import { inr, fmtDate, todayISO, initials } from '@/lib/format';
import {
  MessageSquare, RefreshCw, Send, Search, X, CheckCircle2, Users, Clock, AlertTriangle, MailCheck,
  Phone, FileText, Wallet, CalendarClock, Eye, Banknote, MessageSquareText,
} from 'lucide-react';

type DueCat = 'overdue' | 'today' | 'tomorrow' | 'next3' | 'next7';
interface Row {
  loan: Loan; customerId: string; name: string; mobile: string; dueDate: string;
  daysRemaining: number; outstanding: number; expectedDue: number; cat: DueCat;
}

const dayDiff = (iso: string) => Math.round((new Date(iso + 'T00:00:00').getTime() - new Date(todayISO() + 'T00:00:00').getTime()) / 86400000);
const catOf = (days: number): DueCat => (days < 0 ? 'overdue' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : days <= 3 ? 'next3' : 'next7');
const borderColor: Record<DueCat, string> = {
  overdue: 'border-l-red-800', today: 'border-l-danger', tomorrow: 'border-l-orange-500', next3: 'border-l-warning', next7: 'border-l-slate-300 dark:border-l-slate-600',
};
const daysLabel = (d: number) => (d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `in ${d} days`);

export default function Sms() {
  const d = useData();
  const toast = useToast();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loanType, setLoanType] = useState<LoanType | 'ALL'>('ALL');
  const [dueFilter, setDueFilter] = useState<'ALL' | DueCat | 'LATEST_PAID'>('ALL');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'due' | 'outstanding' | 'name'>('due');
  const [sentLog, setSentLog] = useState<Record<string, string[]>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Row | null>(null);
  const [drawer, setDrawer] = useState<Row | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);

  useEffect(() => { const t = setTimeout(() => setLoading(false), 700); return () => clearTimeout(t); }, []);
  const refresh = () => { setLoading(true); setTimeout(() => setLoading(false), 700); };

  // Derive near-due / overdue rows from the shared dataset
  const base = useMemo<Row[]>(() => {
    return d.loans.filter((l) => l.status === 'ACTIVE').map((l) => {
      const isDaily = isDailyLoan(l.type);
      const dueDate = isDaily ? todayISO() : l.nextDueDate ?? todayISO();
      const days = isDaily ? 0 : dayDiff(dueDate);
      const cust = d.customers.find((c) => c.id === l.customerId);
      return {
        loan: l, customerId: l.customerId, name: cust?.name ?? '—', mobile: l.contact || cust?.mobile || '—',
        dueDate, daysRemaining: days, outstanding: d.outstandingFor(l),
        expectedDue: isDaily ? (l.dailyAmount ?? 0) : l.interest, cat: catOf(days),
      };
    }).filter((r) => r.daysRemaining <= 7); // only customers nearing (or past) their due date
    // `d` is rebuilt whenever any slice (loans/customers/collections) changes, and base reads
    // d.outstandingFor (a closure over collections) — so the whole context is the real dependency.
  }, [d]);

  // The one customer whose collection (any loan) was most recently recorded — shown regardless of due date.
  const latestPaidRow = useMemo<Row | null>(() => {
    if (d.collections.length === 0) return null;
    const latest = d.collections.reduce((a, b) => (b.date > a.date ? b : a));
    const l = d.loans.find((x) => x.id === latest.loanId && x.status === 'ACTIVE');
    if (!l) return null;
    const isDaily = isDailyLoan(l.type);
    const dueDate = isDaily ? todayISO() : l.nextDueDate ?? todayISO();
    const days = isDaily ? 0 : dayDiff(dueDate);
    const cust = d.customers.find((c) => c.id === l.customerId);
    return {
      loan: l, customerId: l.customerId, name: cust?.name ?? '—', mobile: l.contact || cust?.mobile || '—',
      dueDate, daysRemaining: days, outstanding: d.outstandingFor(l),
      expectedDue: isDaily ? (l.dailyAmount ?? 0) : l.interest, cat: catOf(days),
    };
  }, [d]);

  const rows = useMemo(() => {
    if (dueFilter === 'LATEST_PAID') return latestPaidRow ? [latestPaidRow] : [];
    let r = [...base];
    if (loanType !== 'ALL') r = r.filter((x) => x.loan.type === loanType);
    if (dueFilter !== 'ALL') r = r.filter((x) => x.cat === dueFilter);
    const t = search.toLowerCase().trim();
    if (t) r = r.filter((x) => x.name.toLowerCase().includes(t) || x.loan.loanNumber.toLowerCase().includes(t) || x.mobile.includes(t) || String(x.outstanding).includes(t));
    r.sort((a, b) => (sort === 'due' ? a.daysRemaining - b.daysRemaining : sort === 'outstanding' ? b.outstanding - a.outstanding : a.name.localeCompare(b.name)));
    return r;
  }, [base, loanType, dueFilter, search, sort, latestPaidRow]);

  const isSent = (id: string) => (sentLog[id]?.length ?? 0) > 0;
  const totalSentCount = Object.values(sentLog).reduce((s, a) => s + a.length, 0);
  const sentTodayCount = Object.values(sentLog).reduce((s, a) => s + a.filter((ts) => ts.slice(0, 10) === todayISO()).length, 0);
  const overdueCount = base.filter((r) => r.cat === 'overdue').length;
  const nearDueCount = base.filter((r) => r.cat !== 'overdue').length;
  const pendingCount = base.filter((r) => !isSent(r.loan.id)).length;

  const doSend = (ids: string[]) => {
    const now = new Date().toISOString();
    setSentLog((s) => { const n = { ...s }; ids.forEach((id) => (n[id] = [...(n[id] ?? []), now])); return n; });
  };
  const sendOne = (r: Row) => { doSend([r.loan.id]); toast('Reminder sent successfully'); setPreview(null); };
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => setSelected(new Set(rows.map((r) => r.loan.id)));
  const clearSel = () => setSelected(new Set());
  const bulkSend = () => { doSend([...selected]); toast(`${selected.size} reminder(s) sent`); clearSel(); setBulkConfirm(false); };

  const summary = [
    { label: 'Customers Near Due', value: nearDueCount, icon: Users, tone: 'from-primary-400 to-primary' },
    { label: 'SMS Pending', value: pendingCount, icon: Clock, tone: 'from-amber-400 to-orange-500' },
    { label: 'SMS Sent Today', value: sentTodayCount, icon: MailCheck, tone: 'from-emerald-400 to-success' },
    { label: 'Total SMS Sent', value: totalSentCount, icon: Send, tone: 'from-indigo-400 to-primary' },
    { label: 'Overdue Customers', value: overdueCount, icon: AlertTriangle, tone: 'from-rose-500 to-red-700' },
  ];

  const smsText = (r: Row) =>
    `Dear ${r.name}, This is a friendly reminder that your payment of ${inr(r.expectedDue)} is due on ${fmtDate(r.dueDate)}. Outstanding Amount ${inr(r.outstanding)}. Kindly make the payment on time. Thank you. Anush Capitals`;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="sheen relative overflow-hidden rounded-card border border-white/10 bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-6 text-white shadow-xl">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/30 blur-3xl anim-glow" />
        <div className="pointer-events-none absolute -left-10 bottom-0 h-48 w-48 rounded-full bg-cyan-400/20 blur-3xl anim-glow" style={{ animationDelay: '1.5s' }} />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10 backdrop-blur"><MessageSquare size={22} /></div>
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight">SMS Communication Center</h1>
              <p className="text-sm text-white/60">Manage payment reminder messages for customers approaching their due dates.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={refresh}
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold backdrop-blur hover:bg-white/20">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
            </motion.button>
            <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={() => (selected.size ? setBulkConfirm(true) : toast('Select customers first', 'info'))}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-400 to-primary px-4 py-2.5 text-sm font-semibold shadow-lg hover:brightness-110">
              <Send size={15} /> Bulk Send SMS
            </motion.button>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {summary.map((s, i) => {
          const Icon = s.icon;
          return (
            <motion.div key={s.label} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, duration: 0.35 }}
              whileHover={{ y: -4, rotateX: 6, rotateY: -6 }} style={{ transformPerspective: 900 }}
              className="group rounded-card border border-slate-200 bg-white p-5 shadow-card transition-shadow hover:shadow-[0_24px_50px_-24px_rgba(79,70,229,.5)] dark:border-white/[.06] dark:bg-surface">
              <div className={`mb-3 grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br ${s.tone} text-white shadow transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6`}><Icon size={20} /></div>
              <div className="text-[13px] text-muted">{s.label}</div>
              {loading ? <Skeleton className="mt-1 h-8 w-12" /> : <div className="mt-1 font-display text-2xl font-bold"><CountUp value={s.value} /></div>}
            </motion.div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-card border border-slate-200 bg-white p-4 shadow-card dark:border-white/[.06] dark:bg-surface sm:grid-cols-2 lg:grid-cols-4">
        <Select label="Loan type" value={loanType} onChange={(e) => setLoanType(e.target.value as LoanType | 'ALL')}
          options={[{ value: 'ALL', label: 'All loan types' }, ...(Object.keys(LOAN_LABELS) as LoanType[]).map((t) => ({ value: t, label: LOAN_LABELS[t] }))]} />
        <Select label="Due filter" value={dueFilter} onChange={(e) => setDueFilter(e.target.value as 'ALL' | DueCat | 'LATEST_PAID')}
          options={[{ value: 'ALL', label: 'All near-due' }, { value: 'today', label: 'Today' }, { value: 'tomorrow', label: 'Tomorrow' }, { value: 'next3', label: 'Next 3 days' }, { value: 'next7', label: 'Next 7 days' }, { value: 'overdue', label: 'Overdue' }, { value: 'LATEST_PAID', label: 'Latest Paid Customer' }]} />
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">Search</span>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, loan #, mobile, amount…"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-700 dark:bg-surface" />
          </div>
        </label>
        <Select label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as 'due' | 'outstanding' | 'name')}
          options={[{ value: 'due', label: 'Due date' }, { value: 'outstanding', label: 'Outstanding' }, { value: 'name', label: 'Customer name' }]} />
      </div>

      {/* Selection action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary-50 px-4 py-3 dark:bg-primary/10">
            <div className="text-sm font-semibold text-primary">{selected.size} selected</div>
            <div className="flex gap-2">
              <Button variant="ghost" className="!py-1.5 text-xs" onClick={selectAll}>Select all ({rows.length})</Button>
              <Button variant="ghost" className="!py-1.5 text-xs" onClick={clearSel}>Clear selection</Button>
              <Button className="!py-1.5 text-xs" onClick={() => setBulkConfirm(true)}><Send size={14} /> Bulk send reminder</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      <div className="overflow-hidden rounded-card border border-slate-200 bg-white shadow-card dark:border-white/[.06] dark:bg-surface">
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800">
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-4 py-3"><input type="checkbox" aria-label="Select all" className="h-4 w-4 accent-primary" checked={rows.length > 0 && selected.size === rows.length} onChange={(e) => (e.target.checked ? selectAll() : clearSel())} /></th>
                <th className="px-3 py-3">Customer</th><th className="px-3 py-3">Loan #</th><th className="px-3 py-3">Type</th><th className="px-3 py-3">Mobile</th>
                <th className="px-3 py-3">Due date</th><th className="px-3 py-3">Days</th><th className="px-3 py-3">Outstanding</th><th className="px-3 py-3">Expected due</th><th className="px-3 py-3">SMS</th><th className="px-3 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-t border-slate-100 dark:border-white/[.06]"><td className="px-4 py-4" colSpan={11}><Skeleton className="h-8 w-full" /></td></tr>
              ))}
              {!loading && rows.map((r, i) => (
                <motion.tr key={r.loan.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }}
                  onClick={() => setDrawer(r)}
                  className={`cursor-pointer border-t border-l-4 border-slate-100 dark:border-white/[.06] ${borderColor[r.cat]} hover:bg-slate-50 dark:hover:bg-white/[.04]`}>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${r.name}`} className="h-4 w-4 accent-primary" checked={selected.has(r.loan.id)} onChange={() => toggle(r.loan.id)} />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-400 to-primary text-[11px] font-bold text-white">{initials(r.name)}</div>
                      <span className="font-semibold">{r.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs">{r.loan.loanNumber}</td>
                  <td className="px-3 py-3"><Badge tone="info">{LOAN_LABELS[r.loan.type]}</Badge></td>
                  <td className="px-3 py-3 text-muted">{r.mobile}</td>
                  <td className="px-3 py-3">{fmtDate(r.dueDate)}</td>
                  <td className="px-3 py-3">
                    <span className={`text-xs font-bold ${r.cat === 'overdue' ? 'text-red-700' : r.cat === 'today' ? 'text-danger' : r.cat === 'tomorrow' ? 'text-orange-500' : r.cat === 'next3' ? 'text-warning' : 'text-muted'}`}>{daysLabel(r.daysRemaining)}</span>
                  </td>
                  <td className="px-3 py-3 font-display font-semibold">{inr(r.outstanding)}</td>
                  <td className="px-3 py-3">{inr(r.expectedDue)}</td>
                  <td className="px-3 py-3">{isSent(r.loan.id) ? <Badge tone="ok">Sent</Badge> : <Badge tone="neutral">Pending</Badge>}</td>
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end">
                      <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} onClick={() => setPreview(r)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${isSent(r.loan.id) ? 'border border-success/40 text-success' : 'bg-primary text-white shadow'}`}>
                        {isSent(r.loan.id) ? <><CheckCircle2 size={13} /> Resend</> : <><Send size={13} /> Send Reminder</>}
                      </motion.button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && rows.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-full bg-success-50 text-success dark:bg-success/15"><CheckCircle2 size={30} /></div>
            <div className="font-display text-lg font-bold">No customers require reminders today.</div>
            <p className="max-w-sm text-sm text-muted">All customers are up to date.</p>
            <Button variant="ghost" onClick={refresh}><RefreshCw size={15} /> Refresh</Button>
          </div>
        )}
      </div>

      {/* SMS Preview Modal */}
      <AnimatePresence>
        {preview && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" onClick={() => setPreview(null)}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              onClick={(e) => e.stopPropagation()} className="relative w-full max-w-lg overflow-hidden rounded-card border border-slate-200 bg-white shadow-2xl dark:border-white/[.06] dark:bg-surface">
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-white/[.06]">
                <div className="flex items-center gap-2"><MessageSquareText size={18} className="text-primary" /><h3 className="font-display text-lg font-bold">SMS Preview</h3></div>
                <button onClick={() => setPreview(null)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-slate-100 dark:hover:bg-white/[.05]"><X size={18} /></button>
              </div>
              <div className="space-y-4 px-6 py-5">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <div><div className="text-[11px] uppercase tracking-wide text-muted">Customer</div><div className="font-medium">{preview.name}</div></div>
                  <div><div className="text-[11px] uppercase tracking-wide text-muted">Mobile</div><div className="font-medium">{preview.mobile}</div></div>
                  <div><div className="text-[11px] uppercase tracking-wide text-muted">Loan type</div><div className="font-medium">{LOAN_LABELS[preview.loan.type]}</div></div>
                  <div><div className="text-[11px] uppercase tracking-wide text-muted">Due date</div><div className="font-medium">{fmtDate(preview.dueDate)}</div></div>
                  <div><div className="text-[11px] uppercase tracking-wide text-muted">Outstanding</div><div className="font-medium">{inr(preview.outstanding)}</div></div>
                </div>
                <div>
                  <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted">Message preview</div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed dark:border-slate-700 dark:bg-slate-800">{smsText(preview)}</div>
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4 dark:border-white/[.06]">
                <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
                <Button onClick={() => sendOne(preview)}><Send size={15} /> Send Reminder</Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Customer Detail Drawer */}
      <AnimatePresence>
        {drawer && (
          <div className="fixed inset-0 z-[110]" onClick={() => setDrawer(null)}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              onClick={(e) => e.stopPropagation()} className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-surface">
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-white/[.06]">
                <h3 className="font-display text-lg font-bold">Customer Details</h3>
                <button onClick={() => setDrawer(null)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-slate-100 dark:hover:bg-white/[.05]"><X size={18} /></button>
              </div>
              <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
                <div className="flex items-center gap-3">
                  <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-blue-400 to-primary text-lg font-bold text-white">{initials(drawer.name)}</div>
                  <div>
                    <div className="font-display text-lg font-bold">{drawer.name}</div>
                    <div className="flex items-center gap-1.5 text-sm text-muted"><Phone size={13} /> {drawer.mobile}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[['Loan', drawer.loan.loanNumber, FileText], ['Type', LOAN_LABELS[drawer.loan.type], FileText], ['Outstanding', inr(drawer.outstanding), Wallet], ['Due date', fmtDate(drawer.dueDate), CalendarClock]].map(([k, v, Ic]) => {
                    const I = Ic as typeof FileText;
                    return (
                      <div key={k as string} className="rounded-xl border border-slate-100 p-3 dark:border-white/[.06]">
                        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted"><I size={12} /> {k as string}</div>
                        <div className="mt-0.5 font-semibold">{v as string}</div>
                      </div>
                    );
                  })}
                </div>

                <div>
                  <div className="mb-2 text-sm font-semibold">Collection history</div>
                  <div className="space-y-2">
                    {d.collections.filter((c) => c.loanId === drawer.loan.id).slice(0, 6).map((c) => (
                      <div key={c.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm dark:border-white/[.06]">
                        <span className="text-muted">{fmtDate(c.date)} · {c.mode}</span><span className="font-semibold text-success">{inr(c.amount)}</span>
                      </div>
                    ))}
                    {d.collections.filter((c) => c.loanId === drawer.loan.id).length === 0 && <p className="text-sm text-muted">No collections recorded.</p>}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-sm font-semibold">Previous SMS history</div>
                  <div className="space-y-2">
                    {(sentLog[drawer.loan.id] ?? []).map((ts, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm dark:border-white/[.06]">
                        <MailCheck size={14} className="text-success" /><span className="text-muted">Reminder sent · {new Date(ts).toLocaleString('en-IN')}</span>
                      </div>
                    ))}
                    {(sentLog[drawer.loan.id]?.length ?? 0) === 0 && <p className="text-sm text-muted">No reminders sent yet.</p>}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-slate-100 px-6 py-4 dark:border-white/[.06]">
                <Button onClick={() => { setPreview(drawer); }}><Send size={15} /> Send Reminder</Button>
                <Button variant="ghost" onClick={() => navigate('/loans')}><Eye size={15} /> View Loan</Button>
                <Button variant="ghost" onClick={() => navigate('/collections')}><Banknote size={15} /> Record Collection</Button>
                <Button variant="ghost" onClick={() => setDrawer(null)}>Close</Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bulk confirm */}
      <AnimatePresence>
        {bulkConfirm && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" onClick={() => setBulkConfirm(false)}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()} className="relative w-full max-w-sm rounded-card border border-slate-200 bg-white p-6 shadow-2xl dark:border-white/[.06] dark:bg-surface">
              <h3 className="font-display text-lg font-bold">Send reminders?</h3>
              <p className="mt-1 text-sm text-muted">Send reminder SMS to {selected.size || rows.length} selected customer(s)?</p>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setBulkConfirm(false)}>Cancel</Button>
                <Button onClick={() => { if (selected.size === 0) selectAll(); bulkSend(); }}>Confirm</Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
