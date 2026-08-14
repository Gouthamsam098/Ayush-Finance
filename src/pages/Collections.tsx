import { useMemo, useState, type ReactNode } from 'react';
import { useData, LOAN_LABELS, isDailyLoan, isMonthlyLike, isInterestOnly, behavesInterestOnly, type PayMode, type LoanType, type Loan } from '@/mock/DataContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';
import { StatCard } from '@/components/ui/stat-card';
import { PageHeader, HeaderPrimaryButton } from '@/components/layout/PageHeader';
import { usePermissions } from '@/lib/permissions';
import { LedgerDialog } from '@/components/LedgerDialog';
import { CollectionProgress } from '@/components/CollectionProgress';
import { inr, inrShort, fmtDate, todayISO, isoLocal, addDays, initials, DAILY_TERM } from '@/lib/format';
import { Plus, ScrollText, Inbox, Layers, Wallet, TrendingUp, CalendarClock, HandCoins, ChevronRight } from 'lucide-react';

const MODES: PayMode[] = ['CASH', 'UPI', 'BANK', 'CHEQUE'];

/** Days denominator for the progress bar: daily loans use their term, Flexible uses its chosen days, everything else a 30-day cycle. */
const totalDaysFor = (l: Loan) => {
  if (isDailyLoan(l.type)) return l.numDays ?? DAILY_TERM;
  if (l.type === 'FLEXIBLE') return l.numDays ?? 30;
  return 30; // Monthly Interest / Vehicle / Property
};
/** Last day of the loan's term, local-calendar based (Day 1 = loan date, so end = loan date + term - 1). */
const loanEndDateFor = (l: Loan) => {
  const [ly, lm, ld] = l.loanDate.split('-').map(Number);
  return isoLocal(new Date(ly, lm - 1, ld + totalDaysFor(l) - 1));
};
/** Day-slots actually FUNDED for a daily loan (payment pool ÷ daily amount,
 *  capped at term). The progress bar shows money collected — NEVER calendar
 *  days elapsed (a fresh loan with ₹0 paid must read 0/term). Mirrors the
 *  Ledger's paid-slot count. */
const paidDaysFor = (l: Loan, pool: number) => {
  const per = l.dailyAmount ?? 0;
  return per > 0 ? Math.min(Math.floor(pool / per), totalDaysFor(l)) : 0;
};

interface CForm { id?: number; customerId: string; loanId: string; amount: string; date: string; mode: PayMode; remarks: string; }
const blank = (): CForm => ({ customerId: '', loanId: '', amount: '', date: todayISO(), mode: 'CASH', remarks: '' });

export default function Collections() {
  const d = useData();
  const toast = useToast();
  const { canEdit } = usePermissions();
  const [form, setForm] = useState<CForm | null>(null);
  // In-flight flag for the save round-trip: disables the button (and blocks a
  // re-entrant call) so one click can never become two payments.
  const [saving, setSaving] = useState(false);
  const [typeFilter, setTypeFilter] = useState<LoanType | 'ALL'>('ALL');
  const [ledger, setLedger] = useState<Loan | null>(null);
  const [lastMode, setLastMode] = useState<PayMode>('CASH'); // remembered across entries

  const custLoans = useMemo(
    () => d.loans.filter((l) => (!form?.customerId || l.customerId === Number(form.customerId)) && l.status === 'ACTIVE'),
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

  /** Portfolio KPIs — every figure derived from real data (no fabricated trends). */
  const kpis = useMemo(() => {
    const active = d.loans.filter((l) => l.status === 'ACTIVE');
    const dueFor = (l: Loan) =>
      isDailyLoan(l.type) ? d.totalDueForDaily(l)
        : isMonthlyLike(l.type) ? d.totalDueForMonthly(l)
          : behavesInterestOnly(l) ? d.totalDueForInterestOnly(l)
            : 0;
    const collectedToday = d.collections.filter((c) => c.date === todayISO()).reduce((s, c) => s + c.amount, 0);
    return {
      activeCount: active.length,
      totalCollected: d.collections.reduce((s, c) => s + c.amount, 0),
      collectedToday,
      dueNow: active.reduce((s, l) => s + Math.max(0, dueFor(l)), 0),
      outstanding: active.reduce((s, l) => s + d.outstandingFor(l), 0),
    };
  }, [d]);

  const set = (k: keyof CForm, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const selectedLoan = form?.loanId ? d.loans.find((l) => l.id === Number(form.loanId)) : undefined;
  const overpay = !!selectedLoan && Number(form?.amount) > d.outstandingFor(selectedLoan);

  /** Smart prefill: on picking a loan, default the amount to its due instalment
   *  and the DATE to the loan's live next-due SLOT (same figure the Statement
   *  shows) — UNCLAMPED, so a daily loan advances to tomorrow once today is
   *  collected and a monthly loan selects its next 30-day cycle date. Overdue →
   *  the oldest unpaid slot (a past date). */
  const onLoanPick = (loanId: string) => {
    const loan = d.loans.find((l) => l.id === Number(loanId));
    // RECEIPT-DATE RULE: default the payment date to TODAY (when the money is
    // actually received), clamped to the loan date — never the next scheduled
    // slot, which can sit weeks ahead after a bulk/advance payment and would
    // future-date the receipt (corrupting profit-by-month). FIFO allocation
    // decides which slot the money covers; the date never drives it.
    let date = todayISO();
    if (loan && date < loan.loanDate) date = loan.loanDate;
    setForm((f) => (f ? { ...f, loanId, date, amount: f.amount || (loan?.dailyAmount ? String(loan.dailyAmount) : '') } : f));
  };

  const openAdd = () => setForm({ ...blank(), mode: lastMode });

  const save = async () => {
    if (!form) return;
    // DOUBLE-SUBMIT GUARD: recording a payment is a money write, and the dialog
    // stays open for the whole round-trip. Without this, a second click on a
    // slow connection posts a SECOND collection — two receipts for one payment,
    // which inflates collected/profit and needs manual ledger surgery to undo.
    if (saving) return;
    if (!form.loanId) { toast('Select a loan (shown by type)', 'error'); return; }
    if (!Number(form.amount)) { toast('Enter an amount', 'error'); return; }
    // Date discipline (mirrors the server + LedgerDialog rules):
    //  • never before the loan date;
    //  • never beyond the next due slot (or today+1, whichever is later);
    //  • daily loans collect one slot per day — a day already fully funded
    //    cannot be paid again (the picker pre-advances to the next open slot).
    if (selectedLoan) {
      const nd = d.nextDueFor(selectedLoan);
      if (form.date < selectedLoan.loanDate) {
        toast(`Payment date cannot be before the loan date (${fmtDate(selectedLoan.loanDate)})`, 'error'); return;
      }
      const cap = addDays(todayISO(), 1);
      const maxDate = nd && nd > cap ? nd : cap;
      if (form.date > maxDate) {
        toast(`Payment date cannot be beyond the next due (${fmtDate(maxDate)})`, 'error'); return;
      }
      // NOTE: no "date < next due" guard — payments are a FIFO pool; the date is
      // the receipt date and never drives slot allocation (see LedgerDialog).
    }
    const payload = { loanId: Number(form.loanId), date: form.date, amount: Number(form.amount), mode: form.mode, remarks: form.remarks || undefined };
    setSaving(true);
    try {
      if (form.id) { await d.updateCollection(form.id, payload); toast('Collection updated'); }
      else { await d.addCollection(payload); toast('Collection recorded · receipt generated'); }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Failed to record collection', 'error');
      return; // keep the form open so the user can fix the highlighted issue
    } finally {
      setSaving(false); // always released, so a failed save can be retried
    }
    setLastMode(form.mode); // remember for the next entry
    setForm(null);
  };

  return (
    <div className="flex min-h-full flex-col">
      {/* Dark page header — shared chrome, matches Loans */}
      <PageHeader
        icon={<HandCoins size={20} />}
        title="Collections"
        subtitle={`${d.collections.length} payments recorded · ${kpis.activeCount} active loans`}
        actions={canEdit('Collections') ? <HeaderPrimaryButton beam icon={<Plus size={14} />} onClick={openAdd}>Add Collection</HeaderPrimaryButton> : undefined}
      />

      <div className="flex flex-1 flex-col gap-5 p-3.5 sm:px-5">
      {/* KPI strip — real portfolio metrics */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard label="Active loans" value={String(kpis.activeCount)} accent="#6366f1" icon={<Layers size={16} />} />
        <StatCard label="Collected today" value={inrShort(kpis.collectedToday)} accent="#10b981" icon={<TrendingUp size={16} />} />
        {kpis.dueNow > 0 ? (
          <StatCard label="Due now" value={inrShort(kpis.dueNow)} accent="#ef4444" icon={<CalendarClock size={16} />} active />
        ) : (
          <StatCard label="Due now" value={inrShort(kpis.dueNow)} accent="#f59e0b" icon={<CalendarClock size={16} />} />
        )}
        <StatCard label="Total outstanding" value={inr(kpis.outstanding)} accent="#8b5cf6" icon={<Wallet size={16} />} countUp={kpis.outstanding} />
      </div>

      {/* Loan type filter chips */}
      <div className="flex flex-wrap gap-2">
        {([['ALL', 'All'], ...(Object.keys(LOAN_LABELS) as LoanType[]).map((t) => [t, LOAN_LABELS[t]] as const)] as [string, string][]).map(([val, label]) => {
          const on = typeFilter === val;
          return (
            <button key={val} onClick={() => setTypeFilter(val as LoanType | 'ALL')}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${
                on
                  ? 'bg-gradient-to-r from-blue-700 to-blue-500 text-white shadow-[0_4px_14px_rgba(37,99,235,.35)]'
                  : 'border border-slate-200/90 bg-white text-muted hover:border-primary/40 hover:text-primary dark:border-white/[.07] dark:bg-surface dark:hover:bg-white/[.05]'
              }`}>
              {label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${on ? 'bg-white/25' : 'bg-slate-100 text-muted dark:bg-white/[.08]'}`}>{counts[val] ?? 0}</span>
            </button>
          );
        })}
      </div>

      {/* Empty state */}
      {loansToShow.length === 0 ? (
        <EmptyState typed={typeFilter !== 'ALL'} onAdd={canEdit('Collections') ? openAdd : undefined} />
      ) : (
      <>
      {/* ── Mobile / tablet: premium card list (touch-first, CRED-style) ── */}
      <div className="flex flex-col gap-3 lg:hidden">
        {loansToShow.map((l) => (
          <CollectionCard key={l.id} loan={l} d={d} onView={() => setLedger(l)} />
        ))}
      </div>

      {/* ── Desktop: detailed per-type tables (unchanged) ── */}
      <div className="hidden lg:block">
      {typeFilter === 'DAILY_COLLECTION' ? (
        /* ── Daily Collection: expanded view with start/end date, due, and balance ── */
        <TableCard note="Total Due Amount is the cumulative shortfall from what's owed by today. Balance is Principal − Collected. Open View Report to add, edit, or delete individual payments.">
          <thead><HeaderRow cols={['Customer', 'Collection Progress', 'Loan Type', 'Loan Start', 'Loan End', 'Total Due', 'Balance', 'Amount Paid', 'Actions']} /></thead>
          <tbody>
            {loansToShow.map((l) => {
              const cust = d.customers.find((c) => c.id === l.customerId);
              const collected = d.collectedFor(l.id);
              // Progress = instalments FUNDED; shortfall from the shared helper
              // so it always matches the Ledger's "Total Due" tile.
              const paid = paidDaysFor(l, collected);
              const totalDue = d.totalDueForDaily(l);
              const balance = d.outstandingFor(l); // Principal − Collected, for Daily Collection
              return (
                <Row key={l.id}>
                  <Td className="font-medium">{cust?.name ?? '—'}</Td>
                  <Td><CollectionProgress compact paid={paid} total={totalDaysFor(l)} /></Td>
                  <Td><Badge tone="info">{LOAN_LABELS[l.type]}</Badge></Td>
                  <Td>{fmtDate(l.loanDate)}</Td>
                  <Td>{fmtDate(loanEndDateFor(l))}</Td>
                  <Td className="font-semibold text-danger">{totalDue > 0 ? inr(totalDue) : '—'}</Td>
                  <Td className="font-semibold">{inr(balance)}</Td>
                  <Td className="font-display font-semibold text-success">{inr(collected)}</Td>
                  <ActionTd onView={() => setLedger(l)} />
                </Row>
              );
            })}
          </tbody>
        </TableCard>
      ) : typeFilter !== 'ALL' && isMonthlyLike(typeFilter) ? (
        /* ── Monthly Collection / Vehicle / Property: monthly instalment repays principal ── */
        <TableCard note="Total Due Amount is the cumulative shortfall vs. the instalments owed by today (30-day cycles). Open View Report to add, edit, or delete individual payments.">
          <thead><HeaderRow cols={['Customer', 'Principal', 'Monthly Instalment', 'Total Due', 'Loan Type', 'Amount Paid', 'Loan Date', 'Actions']} /></thead>
          <tbody>
            {loansToShow.map((l) => {
              const cust = d.customers.find((c) => c.id === l.customerId);
              const totalDue = d.totalDueForMonthly(l);
              return (
                <Row key={l.id}>
                  <Td className="font-medium">{cust?.name ?? '—'}</Td>
                  <Td>{inr(l.principal)}</Td>
                  <Td>{inr(l.dailyAmount ?? 0)}</Td>
                  <Td className="font-semibold text-danger">{totalDue > 0 ? inr(totalDue) : '—'}</Td>
                  <Td><Badge tone="info">{LOAN_LABELS[l.type]}</Badge></Td>
                  <Td className="font-display font-semibold text-success">{inr(d.collectedFor(l.id))}</Td>
                  <Td>{fmtDate(l.loanDate)}</Td>
                  <ActionTd onView={() => setLedger(l)} />
                </Row>
              );
            })}
          </tbody>
        </TableCard>
      ) : typeFilter !== 'ALL' && isInterestOnly(typeFilter) ? (
        /* ── Daily / Monthly Interest: interest-only, principal fixed until settled ── */
        <TableCard note="Interest Due is the accrued, unpaid interest to date. Outstanding = Principal + Interest Due; the principal stays until separately settled.">
          <thead><HeaderRow cols={['Customer', 'Principal', `${typeFilter === 'DAILY_INTEREST' ? 'Daily' : 'Monthly'} Interest`, 'Interest Collected', 'Interest Due', 'Outstanding', 'Loan Date', 'Actions']} /></thead>
          <tbody>
            {loansToShow.map((l) => {
              const cust = d.customers.find((c) => c.id === l.customerId);
              const due = d.totalDueForInterestOnly(l);
              return (
                <Row key={l.id}>
                  <Td className="font-medium">{cust?.name ?? '—'}</Td>
                  <Td>{inr(l.principal)}</Td>
                  <Td>{inr(l.dailyAmount ?? 0)}</Td>
                  <Td className="font-display font-semibold text-success">{inr(d.collectedFor(l.id))}</Td>
                  <Td className="font-semibold text-danger">{due > 0 ? inr(due) : '—'}</Td>
                  <Td className="font-semibold">{inr(d.outstandingFor(l))}</Td>
                  <Td>{fmtDate(l.loanDate)}</Td>
                  <ActionTd onView={() => setLedger(l)} />
                </Row>
              );
            })}
          </tbody>
        </TableCard>
      ) : (
        /* ── One row per loan, for every other loan type (incl. ALL). A term
              progress bar only makes sense for fixed-term loans (Daily
              Collection); interest-only loans are OPEN-ENDED — "1/30 days" is
              meaningless there. The universal, always-truthful column for a
              collections worklist is NEXT DUE: when the next payment is
              expected, red when it's already late. Amount-based via
              d.nextDueFor, so it always matches the Ledger. ── */
        <TableCard note="Amount Paid is the total collected so far for each loan. Open View Report to add, edit, or delete individual payments.">
          <thead><HeaderRow cols={['Customer', 'Next Due', 'Loan Type', 'Amount Paid', 'Loan Date', 'Actions']} /></thead>
          <tbody>
            {loansToShow.map((l) => {
              const cust = d.customers.find((c) => c.id === l.customerId);
              const nd = d.nextDueFor(l);
              const today = todayISO();
              return (
                <Row key={l.id}>
                  <Td className="font-medium">{cust?.name ?? '—'}</Td>
                  <Td>
                    {nd ? (
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <span className={nd < today ? 'font-semibold text-danger' : nd === today ? 'font-semibold text-warning-600 dark:text-warning' : ''}>{fmtDate(nd)}</span>
                        {nd < today ? <Badge tone="err">Overdue</Badge> : nd === today ? <Badge tone="warn">Today</Badge> : null}
                      </span>
                    ) : (
                      <span className="text-muted">Fully collected</span>
                    )}
                  </Td>
                  <Td><Badge tone="info">{LOAN_LABELS[l.type]}</Badge></Td>
                  <Td className="font-display font-semibold text-success">{inr(d.collectedFor(l.id))}</Td>
                  <Td>{fmtDate(l.loanDate)}</Td>
                  <ActionTd onView={() => setLedger(l)} />
                </Row>
              );
            })}
          </tbody>
        </TableCard>
      )}
      </div>
      </>
      )}

      </div>

      {/* Add / Edit dialog */}
      <Dialog open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit collection' : 'Add collection'}
        footer={<><Button variant="ghost" onClick={() => setForm(null)} disabled={saving}>Cancel</Button><Button onClick={save} loading={saving}>{form?.id ? 'Save changes' : 'Save'}</Button></>}>
        {form && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select label="Customer" value={form.customerId} onChange={(e) => { set('customerId', e.target.value); set('loanId', ''); }}
              options={[{ value: '', label: 'All customers' }, ...d.customers.map((c) => ({ value: String(c.id), label: c.name }))]} />
            <Select label="Loan *" value={form.loanId} onChange={(e) => onLoanPick(e.target.value)}
              options={[{ value: '', label: 'Select loan…' }, ...custLoans.map((l) => ({ value: String(l.id), label: `${LOAN_LABELS[l.type]} · ${l.loanNumber}` }))]} />
            <div>
              <Input label="Amount *" type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
              {selectedLoan && (
                <p className={`mt-1 text-[11px] ${overpay ? 'font-semibold text-warning' : 'text-muted'}`}>
                  {overpay
                    ? `Exceeds outstanding (${inr(d.outstandingFor(selectedLoan))}) — recorded as advance / settlement`
                    : `Instalment ${inr(selectedLoan.dailyAmount ?? 0)} · outstanding ${inr(d.outstandingFor(selectedLoan))}`}
                </p>
              )}
            </div>
            <DatePicker label="Date" value={form.date} onChange={(e) => set('date', e.target.value)} />
            <Select label="Payment mode" value={form.mode} onChange={(e) => set('mode', e.target.value as PayMode)} options={MODES.map((m) => ({ value: m, label: m }))} />
            <div className="sm:col-span-2"><Input label="Remarks" value={form.remarks} onChange={(e) => set('remarks', e.target.value)} /></div>
          </div>
        )}
      </Dialog>

      {ledger && <LedgerDialog loan={ledger} onClose={() => setLedger(null)} />}
    </div>
  );
}

/* ── Presentational helpers (kept local — cut the 4× table duplication) ── */

/** A card wrapping a horizontally-scrollable table plus its footnote. */
function TableCard({ children, note }: { children: ReactNode; note: string }) {
  return (
    <div className="anim-pop overflow-hidden rounded-card border border-slate-200/90 bg-white shadow-card dark:border-white/[.07] dark:bg-surface" style={{ animationDelay: '80ms' }}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[650px] text-[15px]">{children}</table>
      </div>
      <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-muted dark:border-white/[.06]">{note}</p>
    </div>
  );
}

/** Full-width gradient header row matching the Loans table treatment. */
function HeaderRow({ cols }: { cols: string[] }) {
  return (
    <tr className="bg-gradient-to-r from-[#022999] via-[#0538cc] to-[#0AA8F8] text-[12px] font-bold uppercase tracking-[0.08em] text-white">
      {cols.map((c, i) => (
        <th key={c} className={`whitespace-nowrap px-5 py-3.5 ${c === 'Actions' ? 'text-center' : 'text-left'} ${i === 0 ? 'rounded-l-none' : ''}`}>{c}</th>
      ))}
    </tr>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <tr className="border-t border-slate-100 transition-colors hover:bg-primary-50/40 dark:border-white/[.06] dark:hover:bg-primary/[.06]">{children}</tr>;
}

function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`whitespace-nowrap px-5 py-4 ${className}`}>{children}</td>;
}

function ActionTd({ onView }: { onView: () => void }) {
  return (
    <td className="px-4 py-3 text-center">
      <button onClick={onView} title="View Report" aria-label="View Report"
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-primary/40 hover:text-primary dark:border-slate-700">
        <ScrollText size={14} /> View Report
      </button>
    </td>
  );
}

/** Touch-first collection card for mobile/tablet — a premium, readable summary
 *  of one loan's collection state, with a full-width "View Report" action. */
function CollectionCard({ loan, d, onView }: { loan: Loan; d: ReturnType<typeof useData>; onView: () => void }) {
  const cust = d.customers.find((c) => c.id === loan.customerId);
  const collected = d.collectedFor(loan.id);
  const outstanding = d.outstandingFor(loan);
  const hasTerm = isDailyLoan(loan.type) || loan.type === 'FLEXIBLE';
  const paid = isDailyLoan(loan.type)
    ? paidDaysFor(loan, d.collectedFor(loan.id))
    : d.collections.filter((c) => c.loanId === loan.id).length;
  const total = totalDaysFor(loan);
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  const per = loan.type === 'FLEXIBLE' ? '' : isDailyLoan(loan.type) || loan.type === 'DAILY_INTEREST' ? '/day' : '/mo';
  return (
    <div className="anim-pop overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-card dark:border-white/[.07] dark:bg-surface">
      {/* Header — customer + type */}
      <div className="flex items-center gap-3 px-4 pt-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-700 to-blue-500 text-sm font-bold text-white shadow-sm">
          {initials(cust?.name ?? '—')}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-ink">{cust?.name ?? '—'}</div>
          <div className="mt-0.5 font-mono text-xs text-muted">{loan.loanNumber}</div>
        </div>
        <Badge tone="info">{LOAN_LABELS[loan.type]}</Badge>
      </div>

      {/* Progress — only for loans with a defined term */}
      {hasTerm && (
        <div className="px-4 pt-3.5">
          <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-muted">
            <span>Progress</span>
            <span className="tabular-nums">{paid} / {total} days</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[.08]">
            <div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* Stat grid */}
      <div className="mt-3.5 grid grid-cols-2 gap-px bg-slate-100 text-sm dark:bg-white/[.06]">
        <div className="bg-white px-4 py-3 dark:bg-surface">
          <div className="text-[11px] font-medium text-muted">Collected</div>
          <div className="mt-0.5 font-display font-semibold tabular-nums text-success">{inr(collected)}</div>
        </div>
        <div className="bg-white px-4 py-3 dark:bg-surface">
          <div className="text-[11px] font-medium text-muted">Outstanding</div>
          <div className="mt-0.5 font-semibold tabular-nums text-ink">{inr(outstanding)}</div>
        </div>
        <div className="bg-white px-4 py-3 dark:bg-surface">
          <div className="text-[11px] font-medium text-muted">Instalment</div>
          <div className="mt-0.5 font-semibold tabular-nums text-ink">
            {loan.dailyAmount ? inr(loan.dailyAmount) : '—'}
            {loan.dailyAmount ? <span className="text-[11px] font-normal text-muted">{per}</span> : null}
          </div>
        </div>
        <div className="bg-white px-4 py-3 dark:bg-surface">
          <div className="text-[11px] font-medium text-muted">Loan date</div>
          <div className="mt-0.5 font-semibold tabular-nums text-ink">{fmtDate(loan.loanDate)}</div>
        </div>
      </div>

      {/* CTA — touch-friendly (48px) */}
      <button
        onClick={onView}
        className="flex w-full items-center justify-center gap-2 border-t border-slate-100 py-3.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/[.05] active:bg-primary/[.09] dark:border-white/[.06]"
      >
        <ScrollText size={16} /> View Report <ChevronRight size={15} className="opacity-60" />
      </button>
    </div>
  );
}

function EmptyState({ typed, onAdd }: { typed: boolean; onAdd?: () => void }) {
  return (
    <div className="anim-pop flex flex-col items-center gap-3 rounded-card border border-slate-200/90 bg-white px-6 py-16 text-center shadow-card dark:border-white/[.07] dark:bg-surface">
      <div className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-primary-400 to-primary text-white shadow-soft anim-float"><Inbox size={30} /></div>
      <div className="font-display text-lg font-bold">No collections yet</div>
      <p className="max-w-sm text-sm text-muted">{typed ? 'No active loans of this type yet.' : 'Record your first payment to get started.'}</p>
      {onAdd && <Button onClick={onAdd}><Plus size={16} /> Record first collection</Button>}
    </div>
  );
}
