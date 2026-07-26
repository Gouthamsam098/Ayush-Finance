import { useMemo, useState } from 'react';
import {
  useData, LOAN_LABELS, EXPENSE_CATEGORIES, type LoanType,
  type Customer, type Loan, type Collection, type Expense,
} from '@/mock/DataContext';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { FilterCard, SegGroup, Seg, MatchPreview } from '@/components/ui/filter-kit';
import { useToast } from '@/components/ui/toast';
import { PageHeader, HeaderGhostButton } from '@/components/layout/PageHeader';
import { buildDatasetReportPDF, shareOrDownloadPDF, type ReportSummaryItem } from '@/lib/pdfReport';
import { inr, fmtDate, todayISO, isoLocal } from '@/lib/format';
import { cn } from '@/lib/utils';
import { config } from '@/lib/config';
import { loanApi } from '@/services/loanApi';
import { customerApi } from '@/services/customerApi';
import { collectionApi } from '@/services/collectionApi';
import { expenseApi } from '@/services/expenseApi';
import {
  Download, FileSpreadsheet, FileText, Users, Receipt, Wallet, Search,
  Layers, IndianRupee, TrendingUp, Loader2, SlidersHorizontal,
  CalendarRange, Activity, Tag,
} from 'lucide-react';

type ReportKey = 'loans' | 'customers' | 'collections' | 'expenses';
type Period = 'THIS_MONTH' | 'LAST_6M' | 'LAST_1Y' | 'ALL';

// ── date helpers (local-calendar, matching the app-wide convention) ──
const monthsAgoISO = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() - n); return isoLocal(d); };
const yearsAgoISO = (n: number) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return isoLocal(d); };
const thisMonthStartISO = () => { const d = new Date(); d.setDate(1); return isoLocal(d); };
/** Lower-bound ISO date for a period ('' = no bound / all time). */
const periodSince = (p: Period): string =>
  p === 'THIS_MONTH' ? thisMonthStartISO() : p === 'LAST_6M' ? monthsAgoISO(6) : p === 'LAST_1Y' ? yearsAgoISO(1) : '';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'THIS_MONTH', label: 'This Month' },
  { key: 'LAST_6M', label: 'Last 6 Months' },
  { key: 'LAST_1Y', label: 'Last 1 Year' },
  { key: 'ALL', label: 'All Time' },
];

const REPORTS: { key: ReportKey; label: string; icon: typeof Users; accent: string }[] = [
  { key: 'loans', label: 'Loans', icon: Layers, accent: '#6366f1' },
  { key: 'customers', label: 'Customers', icon: Users, accent: '#8b5cf6' },
  { key: 'collections', label: 'Collections', icon: Receipt, accent: '#10b981' },
  { key: 'expenses', label: 'Expenses', icon: Wallet, accent: '#f59e0b' },
];

// ── the applied filter state (draft is edited in the drawer, applied on button) ──
interface ReportFilters { period: Period; loanStatus: 'ALL' | 'ACTIVE' | 'CLOSED'; loanType: 'ALL' | LoanType; expenseCat: 'ALL' | string; }
const defaultFilters = (): ReportFilters => ({ period: 'ALL', loanStatus: 'ALL', loanType: 'ALL', expenseCat: 'ALL' });
/** How many non-default filter facets are active (excludes search, which lives in the toolbar). */
function countActive(tab: ReportKey, f: ReportFilters): number {
  let n = 0;
  if (f.period !== 'ALL') n++;
  if (tab === 'loans') { if (f.loanStatus !== 'ALL') n++; if (f.loanType !== 'ALL') n++; }
  if (tab === 'expenses' && f.expenseCat !== 'ALL') n++;
  return n;
}

// Complete dataset the report is built from (in-memory for preview, fetched for export).
interface Dataset { customers: Customer[]; loans: Loan[]; collections: Collection[]; expenses: Expense[]; }
interface BuildArgs { since: string; q: string; loanStatus: 'ALL' | 'ACTIVE' | 'CLOSED'; loanType: 'ALL' | LoanType; expenseCat: 'ALL' | string; }
interface BuiltReport {
  head: string[];
  body: (string | number)[][];
  rightAlignCols: number[];
  kpis: ReportSummaryItem[];
}

// ── CSV ──
function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}
function downloadCsv(name: string, csv: string) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

/** Pure report builder — single source for preview AND exports, so they never diverge. */
function buildReport(tab: ReportKey, data: Dataset, f: BuildArgs): BuiltReport {
  const nameById = new Map(data.customers.map((c) => [c.id, c.name] as const));
  const custName = (id: number) => nameById.get(id) ?? '—';
  const loanById = new Map(data.loans.map((l) => [l.id, l] as const));
  const q = f.q;

  if (tab === 'loans') {
    let rows = data.loans;
    if (f.since) rows = rows.filter((l) => l.loanDate >= f.since);
    if (f.loanStatus !== 'ALL') rows = rows.filter((l) => l.status === f.loanStatus);
    if (f.loanType !== 'ALL') rows = rows.filter((l) => l.type === f.loanType);
    if (q) rows = rows.filter((l) => l.loanNumber.toLowerCase().includes(q) || custName(l.customerId).toLowerCase().includes(q));
    const principal = rows.reduce((s, l) => s + l.principal, 0);
    return {
      head: ['Loan #', 'Customer', 'Type', 'Principal', 'Interest', 'Loan Date', 'Status'],
      body: rows.map((l) => [l.loanNumber, custName(l.customerId), LOAN_LABELS[l.type], inr(l.principal), inr(l.interest), fmtDate(l.loanDate), l.status]),
      rightAlignCols: [3, 4],
      kpis: [
        { label: 'Loans', value: String(rows.length) },
        { label: 'Total Principal', value: inr(principal) },
        { label: 'Active', value: String(rows.filter((l) => l.status === 'ACTIVE').length) },
        { label: 'Closed', value: String(rows.filter((l) => l.status === 'CLOSED').length) },
      ],
    };
  }

  if (tab === 'customers') {
    let rows = data.customers;
    if (f.since) rows = rows.filter((c) => (c.createdAt ?? '') >= f.since);
    if (q) rows = rows.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) || c.mobile.includes(q));
    const withLoans = new Set(data.loans.map((l) => l.customerId));
    return {
      head: ['Code', 'Name', 'Mobile', 'City', 'Occupation', 'Monthly Income', 'Joined'],
      body: rows.map((c) => [c.code, c.name, c.mobile, c.city ?? '—', c.occupation ?? '—', c.monthlyIncome ? inr(c.monthlyIncome) : '—', c.createdAt ? fmtDate(c.createdAt) : '—']),
      rightAlignCols: [5],
      kpis: [
        { label: 'Customers', value: String(rows.length) },
        { label: 'With Loans', value: String(rows.filter((c) => withLoans.has(c.id)).length) },
        { label: 'Avg Income', value: rows.length ? inr(Math.round(rows.reduce((s, c) => s + (c.monthlyIncome ?? 0), 0) / rows.length)) : '—' },
      ],
    };
  }

  if (tab === 'collections') {
    let rows = data.collections;
    if (f.since) rows = rows.filter((c) => c.date >= f.since);
    if (q) rows = rows.filter((c) => {
      const loan = loanById.get(c.loanId);
      return c.receiptNo.toLowerCase().includes(q) || (loan ? custName(loan.customerId).toLowerCase().includes(q) : false);
    });
    const total = rows.reduce((s, c) => s + c.amount, 0);
    return {
      head: ['Receipt', 'Customer', 'Loan #', 'Amount', 'Mode', 'Date'],
      body: rows.map((c) => {
        const loan = loanById.get(c.loanId);
        return [c.receiptNo, loan ? custName(loan.customerId) : '—', loan?.loanNumber ?? '—', inr(c.amount), c.mode, fmtDate(c.date)];
      }),
      rightAlignCols: [3],
      kpis: [
        { label: 'Payments', value: String(rows.length) },
        { label: 'Total Collected', value: inr(total) },
        { label: 'Avg Payment', value: rows.length ? inr(Math.round(total / rows.length)) : '—' },
      ],
    };
  }

  // expenses
  let rows = data.expenses;
  if (f.since) rows = rows.filter((e) => e.date >= f.since);
  if (f.expenseCat !== 'ALL') rows = rows.filter((e) => e.category === f.expenseCat);
  if (q) rows = rows.filter((e) => e.name.toLowerCase().includes(q) || e.category.toLowerCase().includes(q) || (e.subCategory ?? '').toLowerCase().includes(q));
  const total = rows.reduce((s, e) => s + e.amount, 0);
  return {
    head: ['Date', 'Category', 'Sub Category', 'Name', 'Amount', 'Mode'],
    body: rows.map((e) => [fmtDate(e.date), e.category, e.subCategory ?? '—', e.name, inr(e.amount), e.mode]),
    rightAlignCols: [4],
    kpis: [
      { label: 'Entries', value: String(rows.length) },
      { label: 'Total Spent', value: inr(total) },
      { label: 'Avg Entry', value: rows.length ? inr(Math.round(total / rows.length)) : '—' },
    ],
  };
}

export default function Reports() {
  const d = useData();
  const toast = useToast();
  const [tab, setTab] = useState<ReportKey>('loans');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters());
  const [draft, setDraft] = useState<ReportFilters>(defaultFilters());
  const [filterOpen, setFilterOpen] = useState(false);
  const [exporting, setExporting] = useState<'' | 'csv' | 'pdf'>('');

  // Portfolio KPI band — real figures, no fabricated trends.
  const portfolio = useMemo(() => {
    const active = d.loans.filter((l) => l.status === 'ACTIVE');
    return {
      customers: d.customers.length,
      outstanding: active.reduce((s, l) => s + d.outstandingFor(l), 0),
      collected: d.collections.reduce((s, c) => s + c.amount, 0),
      expenses: d.expenses.reduce((s, e) => s + e.amount, 0),
    };
  }, [d]);

  const since = periodSince(filters.period);
  const q = query.trim().toLowerCase();
  const buildArgs: BuildArgs = { since, q, loanStatus: filters.loanStatus, loanType: filters.loanType, expenseCat: filters.expenseCat };

  // Preview report — client-side over loaded lists (instant, no fetch).
  const report = useMemo(
    () => buildReport(tab, { customers: d.customers, loans: d.loans, collections: d.collections, expenses: d.expenses }, buildArgs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, filters, query, d],
  );

  const meta = REPORTS.find((r) => r.key === tab)!;
  const periodLabel = PERIODS.find((p) => p.key === filters.period)!.label;
  const activeCount = countActive(tab, filters);
  const stamp = todayISO();

  const openFilters = () => { setDraft(filters); setFilterOpen(true); };
  const applyFilters = () => { setFilters(draft); setFilterOpen(false); };
  const clearAll = () => { setFilters(defaultFilters()); setQuery(''); };

  // Live match count for the drawer's MatchPreview (reflects the DRAFT filters).
  const tabTotal = tab === 'loans' ? d.loans.length : tab === 'customers' ? d.customers.length : tab === 'collections' ? d.collections.length : d.expenses.length;
  const draftMatched = useMemo(
    () => buildReport(tab, { customers: d.customers, loans: d.loans, collections: d.collections, expenses: d.expenses },
      { since: periodSince(draft.period), q, loanStatus: draft.loanStatus, loanType: draft.loanType, expenseCat: draft.expenseCat }).body.length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, draft, query, d],
  );

  // Export from AUTHORITATIVE data: in API mode fetch the complete server-filtered
  // set (never truncated); in mock mode reuse the in-memory report.
  const buildExportReport = async (): Promise<BuiltReport> => {
    if (!config.useApi) return report;
    const to = todayISO();
    const from = since || undefined;
    if (tab === 'loans') {
      const loans = await loanApi.fetchAll({ from, to, status: filters.loanStatus === 'ALL' ? undefined : filters.loanStatus, type: filters.loanType === 'ALL' ? undefined : filters.loanType, search: q || undefined });
      return buildReport('loans', { customers: d.customers, loans, collections: [], expenses: [] }, { ...buildArgs, since: '' });
    }
    if (tab === 'customers') {
      const customers = await customerApi.fetchAll({ from, to, search: q || undefined });
      return buildReport('customers', { customers, loans: d.loans, collections: [], expenses: [] }, { ...buildArgs, since: '' });
    }
    if (tab === 'collections') {
      const collections = await collectionApi.fetchAllInRange({ from, to });
      return buildReport('collections', { customers: d.customers, loans: d.loans, collections, expenses: [] }, { ...buildArgs, since: '' });
    }
    const expenses = await expenseApi.fetchAll({ from, to, category: filters.expenseCat === 'ALL' ? undefined : filters.expenseCat, search: q || undefined });
    return buildReport('expenses', { customers: [], loans: [], collections: [], expenses }, { ...buildArgs, since: '', expenseCat: 'ALL' });
  };

  const runExport = async (kind: 'csv' | 'pdf') => {
    setExporting(kind);
    try {
      const rep = await buildExportReport();
      if (rep.body.length === 0) { toast('Nothing to export for this filter', 'error'); return; }
      if (kind === 'csv') {
        downloadCsv(`anush-${tab}-${stamp}.csv`, toCsv([rep.head, ...rep.body]));
        toast(`${meta.label} CSV exported (${rep.body.length} rows)`);
      } else {
        const doc = buildDatasetReportPDF({
          title: `${meta.label} Report`,
          subtitle: `${periodLabel} · ${rep.body.length} ${rep.body.length === 1 ? 'record' : 'records'}`,
          summary: rep.kpis, tableHead: rep.head, tableBody: rep.body, rightAlignCols: rep.rightAlignCols,
        });
        const result = await shareOrDownloadPDF(doc, `Anush-${meta.label}-Report-${stamp}.pdf`);
        toast(result === 'shared' ? 'Report shared' : 'PDF report downloaded');
      }
    } catch {
      toast('Export failed — please try again', 'error');
    } finally {
      setExporting('');
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        icon={<FileText size={20} />}
        title="Reports"
        subtitle="Export portfolio records as CSV or formatted PDF"
        actions={
          <HeaderGhostButton onClick={openFilters} icon={<SlidersHorizontal size={16} />}>
            Filters
            {activeCount > 0 && (
              <span className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1.5 text-[11px] font-bold text-white">{activeCount}</span>
            )}
          </HeaderGhostButton>
        }
      />
      <div className="flex flex-1 flex-col gap-5 p-3.5 sm:px-5">

      {/* Portfolio KPI band */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard label="Customers" value={String(portfolio.customers)} accent="#8b5cf6" icon={<Users size={16} />} />
        <StatCard label="Outstanding" value={inr(portfolio.outstanding)} accent="#6366f1" icon={<IndianRupee size={16} />} countUp={portfolio.outstanding} />
        <StatCard label="Collected" value={inr(portfolio.collected)} accent="#10b981" icon={<TrendingUp size={16} />} countUp={portfolio.collected} />
        <StatCard label="Expenses" value={inr(portfolio.expenses)} accent="#f59e0b" icon={<Wallet size={16} />} countUp={portfolio.expenses} />
      </div>

      {/* One unified panel: tabs → toolbar → chart → table */}
      <div className="overflow-hidden rounded-[18px] border-[0.5px] border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(30,39,64,.04)] dark:border-white/[.08] dark:bg-surface">
        {/* report tabs */}
        <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 pb-3.5 pt-4 dark:border-white/[.06]">
          {REPORTS.map((r) => {
            const Icon = r.icon;
            const active = tab === r.key;
            return (
              <button
                key={r.key}
                onClick={() => { setTab(r.key); setQuery(''); }}
                className={cn(
                  'inline-flex items-center gap-2 rounded-xl border-[0.5px] px-4 py-2 text-[13.5px] font-semibold transition-all',
                  active ? 'text-white shadow-sm' : 'border-slate-200/80 bg-white text-ink/75 hover:bg-slate-50 dark:border-white/[.08] dark:bg-surface dark:hover:bg-white/[.03]',
                )}
                style={active ? { background: `linear-gradient(135deg, ${r.accent}, ${r.accent}cc)`, borderColor: r.accent } : undefined}
              >
                <Icon size={15} /> {r.label}
              </button>
            );
          })}
        </div>

        {/* toolbar: summary + search + export */}
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3.5 dark:border-white/[.06] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-muted">Showing</span>
            <span className="font-semibold text-ink">{report.body.length}</span>
            <span className="text-muted">{report.body.length === 1 ? 'record' : 'records'}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-medium text-ink/70 dark:bg-white/[.06]">
              <CalendarRange size={12} /> {periodLabel}
            </span>
            {activeCount > 0 && (
              <button onClick={clearAll} className="text-[12px] font-semibold text-blue-500 hover:underline">Clear filters</button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex w-full items-center gap-2 rounded-[11px] border-[0.5px] border-slate-200/80 bg-white px-3.5 py-[9px] focus-within:border-blue-400 sm:w-52 dark:border-white/[.08] dark:bg-surface">
              <Search size={16} className="shrink-0 text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${meta.label.toLowerCase()}…`} className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-muted" />
            </div>
            <button
              onClick={() => runExport('csv')} disabled={exporting !== ''}
              className="inline-flex items-center gap-2 rounded-[11px] border-[0.5px] border-slate-200/80 bg-white px-3.5 py-[9px] text-[13.5px] font-semibold text-ink/80 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-white/[.08] dark:bg-surface dark:hover:bg-white/[.03]"
            >
              {exporting === 'csv' ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />} CSV
            </button>
            <button
              onClick={() => runExport('pdf')} disabled={exporting !== ''}
              className="inline-flex items-center gap-2 rounded-[11px] bg-gradient-to-br from-blue-500 to-violet-500 px-4 py-[9px] text-[13.5px] font-semibold text-white shadow-sm shadow-blue-500/25 transition-all hover:-translate-y-px hover:shadow-blue-500/40 disabled:translate-y-0 disabled:opacity-60"
            >
              {exporting === 'pdf' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} PDF
            </button>
          </div>
        </div>

        {/* preview table */}
        <div className="overflow-x-auto">
          {report.body.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <FileText size={30} className="text-slate-300 dark:text-white/20" />
              <p className="text-sm font-medium text-muted">No {meta.label.toLowerCase()} match this filter.</p>
              <p className="text-[12px] text-muted/70">Try a wider period or clear the filters.</p>
            </div>
          ) : (
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] uppercase tracking-wide text-muted dark:border-white/[.06] dark:bg-white/[.02]">
                  {report.head.map((h, i) => (
                    <th key={h} className={cn('px-4 py-3 font-semibold', report.rightAlignCols.includes(i) && 'text-right')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.body.slice(0, 50).map((row, ri) => (
                  <tr key={ri} className="border-t border-slate-50 transition-colors hover:bg-primary-50/40 dark:border-white/[.04] dark:hover:bg-primary/[.06]">
                    {row.map((cell, ci) => (
                      <td key={ci} className={cn('px-4 py-2.5 tabular-nums', report.rightAlignCols.includes(ci) ? 'text-right font-semibold text-ink' : 'text-ink/80', ci === 0 && 'font-mono text-xs text-ink')}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {report.body.length > 50 && (
            <div className="border-t border-slate-100 px-4 py-2.5 text-center text-[12px] text-muted dark:border-white/[.06]">
              Preview shows first 50 of {report.body.length} rows · export includes all
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Filters — premium right-side drawer (draft, applied on button) — same pattern as Loans */}
      <Drawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        width="md"
        icon={<SlidersHorizontal size={18} />}
        title={`Filter ${meta.label.toLowerCase()}`}
        subtitle="Scope the report before you export"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(defaultFilters())}>Clear all</Button>
            <Button onClick={applyFilters}>Apply filters</Button>
          </>
        }
      >
        <div className="space-y-5">
          <MatchPreview
            matched={draftMatched}
            total={tabTotal}
            activeCount={countActive(tab, draft)}
            itemLabel={meta.label.toLowerCase()}
            onClear={() => setDraft(defaultFilters())}
          />

          {/* Period */}
          <FilterCard icon={<CalendarRange size={16} />} title="Period" color="amber" active={draft.period !== 'ALL'}>
            <div className="grid grid-cols-2 gap-2">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setDraft({ ...draft, period: p.key })}
                  className={cn(
                    'rounded-lg border-[0.5px] px-3 py-2 text-[13px] font-semibold transition-all',
                    draft.period === p.key
                      ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-400/50 dark:bg-amber-500/15 dark:text-amber-300'
                      : 'border-slate-200/70 bg-white text-ink/70 hover:bg-slate-50 dark:border-white/[.08] dark:bg-surface2 dark:hover:bg-white/[.05]',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </FilterCard>

          {/* Loan-only: status + type */}
          {tab === 'loans' && (
            <>
              <FilterCard icon={<Activity size={16} />} title="Loan status" color="blue" active={draft.loanStatus !== 'ALL'}>
                <SegGroup>
                  <Seg active={draft.loanStatus === 'ALL'} onClick={() => setDraft({ ...draft, loanStatus: 'ALL' })}>All</Seg>
                  <Seg active={draft.loanStatus === 'ACTIVE'} onClick={() => setDraft({ ...draft, loanStatus: 'ACTIVE' })} tone="emerald">Active</Seg>
                  <Seg active={draft.loanStatus === 'CLOSED'} onClick={() => setDraft({ ...draft, loanStatus: 'CLOSED' })}>Closed</Seg>
                </SegGroup>
              </FilterCard>

              <FilterCard icon={<Layers size={16} />} title="Loan type" color="violet" active={draft.loanType !== 'ALL'}>
                <div className="flex flex-wrap gap-2">
                  <TypePill active={draft.loanType === 'ALL'} onClick={() => setDraft({ ...draft, loanType: 'ALL' })}>All types</TypePill>
                  {(Object.keys(LOAN_LABELS) as LoanType[]).map((t) => (
                    <TypePill key={t} active={draft.loanType === t} onClick={() => setDraft({ ...draft, loanType: t })}>{LOAN_LABELS[t]}</TypePill>
                  ))}
                </div>
              </FilterCard>
            </>
          )}

          {/* Expense-only: category */}
          {tab === 'expenses' && (
            <FilterCard icon={<Tag size={16} />} title="Category" color="emerald" active={draft.expenseCat !== 'ALL'}>
              <div className="flex flex-wrap gap-2">
                <TypePill active={draft.expenseCat === 'ALL'} onClick={() => setDraft({ ...draft, expenseCat: 'ALL' })}>All categories</TypePill>
                {EXPENSE_CATEGORIES.map((c) => (
                  <TypePill key={c} active={draft.expenseCat === c} onClick={() => setDraft({ ...draft, expenseCat: c })}>{c}</TypePill>
                ))}
              </div>
            </FilterCard>
          )}

          {(tab === 'customers' || tab === 'collections') && (
            <p className="px-1 text-[12px] text-muted">Use the search box and period to scope this report. Additional filters apply to Loans and Expenses.</p>
          )}
        </div>
      </Drawer>
    </div>
  );
}

/** A rounded selector pill for loan type / expense category. */
function TypePill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border-[0.5px] px-3.5 py-1.5 text-[13px] font-medium transition-all',
        active
          ? 'border-blue-400 bg-blue-50 text-blue-700 ring-1 ring-blue-300 dark:border-blue-400/50 dark:bg-blue-500/15 dark:text-blue-300'
          : 'border-slate-200/70 bg-white text-ink/70 hover:border-slate-300 hover:bg-slate-50 dark:border-white/[.08] dark:bg-surface2 dark:hover:bg-white/[.05]',
      )}
    >
      {children}
    </button>
  );
}
