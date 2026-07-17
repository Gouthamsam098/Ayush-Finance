import { useMemo, useState } from 'react';
import { useData, LOAN_LABELS, isDailyLoan, type Loan, type LoanType } from '@/mock/DataContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { Drawer } from '@/components/ui/drawer';
import { PageHeader, HeaderPrimaryButton } from '@/components/layout/PageHeader';
import { inr, inrShort, fmtDate, todayISO, addDays, DAILY_TERM } from '@/lib/format';
import { emptyNum, matchNum, numActive, type NumFilter } from '@/lib/customerFilters';
import { FilterCard, SegGroup, Seg, NumFilterRow, MatchPreview } from '@/components/ui/filter-kit';
import {
  Search, Plus, FileText, Pencil, Trash2, CheckCircle2, SlidersHorizontal,
  Wallet, AlertTriangle, CalendarClock, Layers, Lock, RotateCcw, ArrowUpDown, Activity, IndianRupee,
} from 'lucide-react';
import { LedgerDialog } from '@/components/LedgerDialog';

const TYPE_OPTS = (Object.keys(LOAN_LABELS) as LoanType[]).map((v) => ({ value: v, label: LOAN_LABELS[v] }));

// Type chip colors — tuned for a light canvas (from the approved design).
const TYPE_META: Record<LoanType, { bg: string; fg: string; bd: string; dot: string }> = {
  DAILY_COLLECTION: { bg: '#e7f6ef', fg: '#15803d', bd: '#c3ead6', dot: '#22c55e' },
  MONTHLY_INTEREST: { bg: '#e8f0fe', fg: '#1d4ed8', bd: '#cadffb', dot: '#3b82f6' },
  DAILY_INTEREST:   { bg: '#f3ebfd', fg: '#7c3aed', bd: '#e0cffb', dot: '#a855f7' },
  VEHICLE:          { bg: '#fdf3e0', fg: '#b45309', bd: '#f5e0b8', dot: '#f59e0b' },
  FLEXIBLE:         { bg: '#eceefe', fg: '#4f46e5', bd: '#d5d9fb', dot: '#818cf8' },
  PROPERTY:         { bg: '#fdece2', fg: '#c2410c', bd: '#f7d5c1', dot: '#f97316' },
};

/** Signed calendar days from today to a YYYY-MM-DD date (negative = past). */
const daysUntil = (iso: string) => {
  const [y, m, dd] = iso.split('-').map(Number);
  const [ty, tm, td] = todayISO().split('-').map(Number);
  return Math.round((new Date(y, m - 1, dd).getTime() - new Date(ty, tm - 1, td).getTime()) / 86400000);
};

interface LoanForm {
  id?: string; customerId: string; type: LoanType; principal: string; rate: string; loanDate: string;
  contact: string; remarks: string; dailyAmount: string; numDays: string;
  vehicleNumber: string; vehicleBrand: string; vehicleName: string;
}
const blank = (): LoanForm => ({
  customerId: '', type: 'DAILY_COLLECTION', principal: '', rate: '', loanDate: todayISO(),
  contact: '', remarks: '', dailyAmount: '', numDays: '30', vehicleNumber: '', vehicleBrand: '', vehicleName: '',
});

type Urgency = 'all' | 'overdue' | 'soon';
type SortMode = 'urgency' | 'amount';

/** Drawer-managed loan filters (draft is edited in the drawer, applied on button). */
interface LoanFilters {
  status: '' | 'ACTIVE' | 'CLOSED';
  types: LoanType[];        // loan is one of these (empty = any)
  outstanding: NumFilter;   // rupees
  principal: NumFilter;     // rupees
  sort: SortMode;
}
const defaultLoanFilters = (): LoanFilters => ({
  status: '', types: [], outstanding: emptyNum(), principal: emptyNum(), sort: 'urgency',
});
/** How many drawer dimensions are constraining the list (sort excluded). */
const countLoanFilters = (f: LoanFilters) =>
  (f.status ? 1 : 0) + (f.types.length ? 1 : 0) + (numActive(f.outstanding) ? 1 : 0) + (numActive(f.principal) ? 1 : 0);

export default function Loans() {
  const d = useData();
  const toast = useToast();
  const [form, setForm] = useState<LoanForm | null>(null);
  const [ledger, setLedger] = useState<Loan | null>(null);
  const [confirm, setConfirm] = useState<Loan | null>(null);
  const [closeTarget, setCloseTarget] = useState<Loan | null>(null);
  const [urgency, setUrgency] = useState<Urgency>('all');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<LoanFilters>(defaultLoanFilters);
  const [draft, setDraft] = useState<LoanFilters>(defaultLoanFilters);
  const [filterOpen, setFilterOpen] = useState(false);

  const custName = (id: string) => d.customers.find((c) => c.id === id)?.name ?? '—';
  const interest = form ? Math.round(((Number(form.principal) || 0) * (Number(form.rate) || 0)) / 100) : 0;
  const deduction = interest;
  const netDisbursed = Math.max(0, (form ? Number(form.principal) || 0 : 0) - deduction);
  const set = <K extends keyof LoanForm>(k: K, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  /** Effective next-due date for a loan (daily loans derive it from collections). */
  const nextDueOf = (l: Loan): string | null =>
    isDailyLoan(l.type) ? d.nextDueForDaily(l) : l.nextDueDate ?? null;

  /** Signed days until due; null when there is no upcoming due (completed/closed). */
  const dueInDaysOf = (l: Loan): number | null => {
    if (l.status !== 'ACTIVE') return null;
    const nd = nextDueOf(l);
    return nd ? daysUntil(nd) : null;
  };

  const stats = useMemo(() => ({
    count: d.loans.length,
    outstanding: d.loans.reduce((s, l) => s + d.outstandingFor(l), 0),
    overdue: d.loans.filter((l) => { const dd = dueInDaysOf(l); return dd != null && dd < 0; }).length,
    soon: d.loans.filter((l) => { const dd = dueInDaysOf(l); return dd != null && dd >= 0 && dd <= 3; }).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [d.loans, d.collections]);

  /** Does a loan pass the toolbar state (urgency, query) plus a filter set? */
  const loanPasses = (l: Loan, f: LoanFilters): boolean => {
    if (urgency === 'overdue') { const dd = dueInDaysOf(l); if (dd == null || dd >= 0) return false; }
    if (urgency === 'soon') { const dd = dueInDaysOf(l); if (dd == null || dd < 0 || dd > 3) return false; }
    if (query.trim()) {
      const q = query.toLowerCase();
      if (!custName(l.customerId).toLowerCase().includes(q)
        && !l.loanNumber.toLowerCase().includes(q)
        && !LOAN_LABELS[l.type].toLowerCase().includes(q)) return false;
    }
    if (f.status && l.status !== f.status) return false;
    if (f.types.length && !f.types.includes(l.type)) return false;
    if (!matchNum(d.outstandingFor(l), f.outstanding)) return false;
    if (!matchNum(l.principal, f.principal)) return false;
    return true;
  };

  const rows = useMemo(() => {
    const r = d.loans.filter((l) => loanPasses(l, filters));
    if (filters.sort === 'urgency') r.sort((a, b) => (dueInDaysOf(a) ?? 9999) - (dueInDaysOf(b) ?? 9999));
    if (filters.sort === 'amount') r.sort((a, b) => d.outstandingFor(b) - d.outstandingFor(a));
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.loans, d.collections, d.customers, filters, urgency, query]);

  // Live count of what the drawer draft would match (respects urgency + search).
  const draftMatchCount = useMemo(
    () => d.loans.filter((l) => loanPasses(l, draft)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d.loans, d.collections, d.customers, draft, urgency, query],
  );

  const activeFilterCount = countLoanFilters(filters);
  const filtersOn = activeFilterCount > 0 || urgency !== 'all' || !!query;
  const activeLabel = urgency === 'overdue' ? 'overdue' : urgency === 'soon' ? 'due soon' : 'loans';
  const openFilters = () => { setDraft(filters); setFilterOpen(true); };
  const applyDraft = () => { setFilters(draft); setFilterOpen(false); };

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

  const dailyEnd = form && isDailyLoan(form.type) ? addDays(form.loanDate, DAILY_TERM) : null;
  const GRID = 'grid grid-cols-[1.4fr_1.3fr_1fr_0.9fr_1.1fr_1.2fr_150px] items-center gap-4';

  return (
    <div className="flex min-h-full flex-col">
      {/* Dark page header */}
      <PageHeader
        icon={<Layers size={20} />}
        title="Loans"
        subtitle={`${stats.count} loans across ${TYPE_OPTS.length} types · automatic interest`}
        actions={<HeaderPrimaryButton icon={<Plus size={14} />} onClick={() => setForm(blank())}>Create Loan</HeaderPrimaryButton>}
      />

      <div className="flex flex-1 flex-col gap-4 p-3.5 sm:px-5">
        {/* Stat cards / triage filters */}
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <StatCard label="Total loans" value={String(stats.count)} accent="#6366f1" icon={<Layers size={16} />}
            active={urgency === 'all'} onClick={() => setUrgency('all')} />
          <StatCard label="Total outstanding" value={inrShort(stats.outstanding)} accent="#8b5cf6" icon={<Wallet size={16} />} />
          <StatCard label="Overdue" value={String(stats.overdue)} accent="#ef4444" icon={<AlertTriangle size={16} />}
            active={urgency === 'overdue'} onClick={() => setUrgency('overdue')} />
          <StatCard label="Due within 3 days" value={String(stats.soon)} accent="#f59e0b" icon={<CalendarClock size={16} />}
            active={urgency === 'soon'} onClick={() => setUrgency('soon')} />
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[14px]">
            <span className="text-muted">Showing</span>
            <span className="font-bold text-ink">{rows.length}</span>
            <span className="text-muted">{activeLabel}</span>
            {filtersOn && (
              <button
                onClick={() => { setFilters(defaultLoanFilters()); setDraft(defaultLoanFilters()); setUrgency('all'); setQuery(''); }}
                className="ml-1 text-[13px] font-semibold text-indigo-500 hover:underline"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search */}
            <div className="flex w-60 items-center gap-2 rounded-[11px] border-[0.5px] border-slate-200/80 bg-white px-3.5 py-[9px] focus-within:border-indigo-400 dark:border-white/[.08] dark:bg-surface">
              <Search size={16} className="shrink-0 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search loan, borrower…"
                className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-muted"
              />
            </div>

            {/* Filters — opens the premium drawer (same pattern as Customers) */}
            <button
              onClick={openFilters}
              className={`relative inline-flex items-center gap-2 rounded-[11px] border-[0.5px] px-4 py-[9px] text-[14px] font-semibold transition-colors ${
                activeFilterCount > 0
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-400/40 dark:bg-indigo-500/15 dark:text-indigo-300'
                  : 'border-slate-200/80 bg-white text-ink/80 hover:bg-slate-50 dark:border-white/[.08] dark:bg-surface dark:hover:bg-white/[.03]'
              }`}
            >
              <SlidersHorizontal size={16} /> Filters
              {activeFilterCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-500 px-1.5 text-[11px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Column header — solid full-color band */}
        <div className={`${GRID} hidden rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-3.5 text-[12px] font-bold uppercase tracking-[0.08em] text-white shadow-[0_4px_14px_rgba(99,102,241,.3)] lg:grid`}>
          <div>Borrower</div>
          <div>Loan</div>
          <div>Principal</div>
          <div>Interest</div>
          <div>Outstanding</div>
          <div>Next due</div>
          <div className="text-right">Actions</div>
        </div>

        {/* Rows */}
        <div className="flex flex-col gap-2">
          {rows.map((l) => {
            const t = TYPE_META[l.type];
            const dd = dueInDaysOf(l);
            const nd = nextDueOf(l);
            const closed = l.status !== 'ACTIVE';
            return (
              <div
                key={l.id}
                className={`${GRID} group rounded-[14px] border-[0.5px] border-slate-200/90 bg-white px-5 py-4 transition-all hover:-translate-y-px hover:border-slate-300 hover:shadow-[0_6px_20px_rgba(30,39,64,.08)] dark:border-white/[.07] dark:bg-surface dark:hover:border-white/[.14] ${closed ? 'opacity-70' : ''}`}
              >
                {/* Borrower */}
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl border"
                    style={{ background: t.bg, borderColor: t.bd }}
                  >
                    <span className="h-3 w-3 rounded-full" style={{ background: t.dot }} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold text-ink">{custName(l.customerId)}</div>
                    {closed && (
                      <span className="mt-[3px] inline-block rounded-full border-[0.5px] border-slate-200 bg-slate-100 px-2 py-px text-[10.5px] font-semibold text-slate-500 dark:border-white/10 dark:bg-white/10 dark:text-slate-300">
                        Closed
                      </span>
                    )}
                  </div>
                </div>

                {/* Loan number + type */}
                <div className="min-w-0">
                  <div className="text-[14.5px] font-semibold tabular-nums text-ink">{l.loanNumber}</div>
                  <div className="mt-[3px] truncate text-[12.5px] font-semibold" style={{ color: t.fg }}>{LOAN_LABELS[l.type]}</div>
                </div>

                {/* Principal */}
                <div className="text-[14.5px] tabular-nums text-ink/75">{inr(l.principal)}</div>

                {/* Interest */}
                <div className="text-[14.5px] font-semibold tabular-nums text-[#15803d] dark:text-emerald-400">{inr(l.interest)}</div>

                {/* Outstanding */}
                <div className="text-[15.5px] font-bold tabular-nums text-ink">{inr(d.outstandingFor(l))}</div>

                {/* Next due + urgency */}
                <div>
                  <div className="text-[14px] tabular-nums text-ink/75">
                    {nd ? fmtDate(nd) : closed ? '—' : <span className="font-semibold text-success">Completed</span>}
                  </div>
                  {dd != null && <DueBadge days={dd} />}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => setLedger(l)}
                    title="View report"
                    className="flex items-center gap-1.5 whitespace-nowrap rounded-[9px] border-[0.5px] border-slate-200/80 bg-slate-50 px-[11px] py-[7px] text-[12.5px] font-semibold text-ink/70 transition-colors hover:bg-slate-100 hover:text-indigo-600 dark:border-white/[.08] dark:bg-white/[.04] dark:hover:bg-white/[.08]"
                  >
                    <FileText size={14} /> Report
                  </button>
                  {l.status === 'ACTIVE' ? (
                    <IconBtn
                      title="Close loan"
                      onClick={() => {
                        const outstanding = d.outstandingFor(l);
                        if (outstanding > 0) { toast(`Cannot close — outstanding balance of ${inr(outstanding)} remains`, 'error'); return; }
                        setCloseTarget(l);
                      }}
                    >
                      <CheckCircle2 size={16} />
                    </IconBtn>
                  ) : (
                    <IconBtn title="Reopen loan" onClick={() => { d.updateLoan(l.id, { status: 'ACTIVE' }); toast('Loan reopened'); }}>
                      <RotateCcw size={16} />
                    </IconBtn>
                  )}
                  <IconBtn title="Edit" onClick={() => editLoan(l)}><Pencil size={16} /></IconBtn>
                  <IconBtn danger title="Delete" onClick={() => setConfirm(l)}><Trash2 size={16} /></IconBtn>
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="rounded-[14px] border-[0.5px] border-slate-200/80 bg-white p-12 text-center text-slate-400 dark:border-white/[.08] dark:bg-surface">
              No loans match that. Try a different search or clear the filter.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-[14px] text-muted">
          <span>Showing 1–{rows.length} of {stats.count} loans</span>
        </div>
      </div>

      {/* Filters — premium right-side drawer (draft, applied on button) */}
      <Drawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        width="md"
        icon={<SlidersHorizontal size={18} />}
        title="Filter loans"
        subtitle="Combine type, portfolio and status criteria"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(defaultLoanFilters())}>Clear all</Button>
            <Button onClick={applyDraft}>Apply filters</Button>
          </>
        }
      >
        <div className="space-y-5">
          <MatchPreview
            matched={draftMatchCount}
            total={d.loans.length}
            activeCount={countLoanFilters(draft)}
            itemLabel="loans"
            onClear={() => setDraft(defaultLoanFilters())}
          />

          {/* Sort */}
          <FilterCard icon={<ArrowUpDown size={16} />} title="Sort by" color="amber" active={draft.sort !== 'urgency'}>
            <SegGroup>
              <Seg active={draft.sort === 'urgency'} onClick={() => setDraft({ ...draft, sort: 'urgency' })} tone="amber">Due next</Seg>
              <Seg active={draft.sort === 'amount'} onClick={() => setDraft({ ...draft, sort: 'amount' })} tone="amber">Largest first</Seg>
            </SegGroup>
          </FilterCard>

          {/* Loan type — exact palette pills */}
          <FilterCard icon={<Layers size={16} />} title="Loan type" color="violet" active={draft.types.length > 0}>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(LOAN_LABELS) as LoanType[]).map((t) => {
                const meta = TYPE_META[t];
                const on = draft.types.includes(t);
                return (
                  <button
                    key={t}
                    onClick={() =>
                      setDraft({ ...draft, types: on ? draft.types.filter((x) => x !== t) : [...draft.types, t] })
                    }
                    className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-all ${
                      on ? '' : 'border-slate-200/70 bg-white text-ink/70 hover:bg-slate-50 dark:border-white/[.08] dark:bg-surface2 dark:text-slate-300 dark:hover:bg-white/[.05]'
                    }`}
                    style={on ? { background: meta.bg, color: meta.fg, borderColor: meta.bd } : undefined}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: meta.dot }} />
                    {LOAN_LABELS[t]}
                  </button>
                );
              })}
            </div>
            {draft.types.length > 0 && (
              <p className="mt-2.5 text-[11px] text-muted">Showing loans of the selected type{draft.types.length > 1 ? 's' : ''}.</p>
            )}
          </FilterCard>

          {/* Portfolio */}
          <FilterCard icon={<IndianRupee size={16} />} title="Amounts" color="emerald" active={numActive(draft.outstanding) || numActive(draft.principal)}>
            <div className="space-y-3">
              <NumFilterRow label="Outstanding" unit="₹" value={draft.outstanding} onChange={(outstanding) => setDraft({ ...draft, outstanding })} />
              <NumFilterRow label="Principal" unit="₹" value={draft.principal} onChange={(principal) => setDraft({ ...draft, principal })} />
            </div>
          </FilterCard>

          {/* Status */}
          <FilterCard icon={<Activity size={16} />} title="Loan status" color="blue" active={!!draft.status}>
            <SegGroup>
              <Seg active={draft.status === ''} onClick={() => setDraft({ ...draft, status: '' })}>All</Seg>
              <Seg active={draft.status === 'ACTIVE'} onClick={() => setDraft({ ...draft, status: 'ACTIVE' })} tone="emerald">Active</Seg>
              <Seg active={draft.status === 'CLOSED'} onClick={() => setDraft({ ...draft, status: 'CLOSED' })}>Closed</Seg>
            </SegGroup>
          </FilterCard>
        </div>
      </Drawer>

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

/** Due-date urgency badge — exact tones from the approved design. */
function DueBadge({ days }: { days: number }) {
  let tone: { bg: string; fg: string; bd: string; dot: string };
  let label: string;
  if (days < 0) { tone = { bg: '#fdeaea', fg: '#dc2626', bd: '#f7cfcf', dot: '#ef4444' }; label = `${Math.abs(days)}d overdue`; }
  else if (days === 0) { tone = { bg: '#fdf3e0', fg: '#b45309', bd: '#f5e0b8', dot: '#f59e0b' }; label = 'Due today'; }
  else if (days <= 3) { tone = { bg: '#fdf3e0', fg: '#b45309', bd: '#f5e0b8', dot: '#f59e0b' }; label = `Due in ${days}d`; }
  else { tone = { bg: '#f1f3f8', fg: '#6b7591', bd: '#e2e6ef', dot: '#94a3b8' }; label = `In ${days}d`; }
  return (
    <span
      className="mt-[5px] inline-flex items-center gap-1.5 rounded-full border px-[9px] py-[3px] text-[11.5px] font-semibold"
      style={{ background: tone.bg, color: tone.fg, borderColor: tone.bd }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.dot }} />
      {label}
    </span>
  );
}

/** Compact stat card that doubles as an urgency filter (Total / Overdue / Due soon). */
function StatCard({
  label, value, active, onClick, accent, icon,
}: {
  label: string; value: string; sub?: string; active?: boolean; onClick?: () => void;
  accent: string; icon: React.ReactNode; isText?: boolean;
}) {
  const clickable = !!onClick;
  return (
    <button
      onClick={onClick}
      disabled={!clickable}
      className={`group relative flex items-center gap-3 overflow-hidden rounded-xl border bg-white px-3.5 py-3 text-left transition-all dark:bg-surface ${
        active ? '' : 'border-slate-200/90 dark:border-white/[.07]'
      } ${clickable ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-10px_rgba(30,39,64,.2)]' : 'cursor-default'}`}
      style={{
        borderColor: active ? accent : undefined,
        boxShadow: active ? `0 0 0 2px ${accent}26` : '0 1px 2px rgba(30,39,64,.04)',
      }}
    >
      {active && (
        <span className="pointer-events-none absolute inset-0" style={{ background: `linear-gradient(135deg, ${accent}14, transparent 60%)` }} />
      )}
      {/* icon chip */}
      <span
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white transition-transform duration-200 group-hover:scale-105"
        style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}
      >
        {icon}
      </span>
      <div className="relative min-w-0">
        <div className="font-display text-xl font-bold leading-none text-ink">{value}</div>
        <div className="mt-1 truncate text-[12px] font-medium text-muted">{label}</div>
      </div>
    </button>
  );
}

/** Borderless icon action button used on each loan row. */
function IconBtn({ children, danger, title, onClick }: { children: React.ReactNode; danger?: boolean; title: string; onClick: () => void }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`grid h-[34px] w-[34px] place-items-center rounded-[9px] transition-colors hover:bg-slate-100 dark:hover:bg-white/[.08] ${
        danger ? 'text-red-500 hover:text-red-600' : 'text-muted hover:text-indigo-600 dark:hover:text-indigo-400'
      }`}
    >
      {children}
    </button>
  );
}
