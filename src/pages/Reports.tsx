import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useData, LOAN_LABELS, EXPENSE_CATEGORIES, behavesInterestOnly, type LoanType,
  type Customer, type Loan, type Collection, type Expense,
} from '@/mock/DataContext';
import { cashDisbursedFor } from '@/lib/funds';
import { StatCard } from '@/components/ui/stat-card';
import { ResponsiveTableFrame } from '@/components/ui/responsive-table';
import { TruncatedTapPopoverText } from '@/components/ui/tap-popover-text';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { FilterCard, SegGroup, Seg, MatchPreview } from '@/components/ui/filter-kit';
import { useToast } from '@/components/ui/toast';
import { PageHeader, HeaderGhostButton } from '@/components/layout/PageHeader';
// Only the TYPE is imported statically (types are erased at build time, so this
// pulls in no code). The jsPDF implementation is loaded on demand in runExport.
import { type ReportSummaryItem } from '@/lib/pdfReport';
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
  CalendarRange, Activity, Tag, UserCircle2, ShieldCheck, Smartphone,
} from 'lucide-react';
import {
  collectorBadgeTone,
  collectorMatchesFilter,
  resolveCollector,
  loanCollectorDisplay,
  type CollectorFilter,
} from '@/lib/collectionCollector';
import { scheduleShortfall } from '@/features/recovery/recoveryDue';
import {
  buildAgentCollectionReport,
  filterAgentCollections,
  type AgentCollectionSummary,
} from '@/lib/agentCollectionReport';
import { formatUpiReportCells, syncApprovedClaimUpiToCollections } from '@/lib/recoveryClaimUpi';
import { useRecovery } from '@/features/recovery/RecoveryContext';

type ReportKey = 'loans' | 'customers' | 'collections' | 'agents' | 'expenses';
type Period = 'THIS_MONTH' | 'LAST_6M' | 'LAST_1Y' | 'ALL';

// ── date helpers (local-calendar, matching the app-wide convention) ──
const monthsAgoISO = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() - n); return isoLocal(d); };
const yearsAgoISO = (n: number) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return isoLocal(d); };
const thisMonthStartISO = () => { const d = new Date(); d.setDate(1); return isoLocal(d); };
/** Lower-bound ISO date for a period ('' = no bound / all time). */
const periodSince = (p: Period): string =>
  p === 'THIS_MONTH' ? thisMonthStartISO() : p === 'LAST_6M' ? monthsAgoISO(6) : p === 'LAST_1Y' ? yearsAgoISO(1) : '';

const COLLECTION_KPI_VISUAL: Record<string, { accent: string; icon: typeof Receipt }> = {
  Payments: { accent: '#6366f1', icon: Receipt },
  'Total Collected': { accent: '#10b981', icon: TrendingUp },
  'Via agents': { accent: '#059669', icon: ShieldCheck },
  'Via staff': { accent: '#3b82f6', icon: UserCircle2 },
  'Via customer': { accent: '#8b5cf6', icon: Smartphone },
};

const PERIODS: { key: Period; label: string }[] = [
  { key: 'THIS_MONTH', label: 'This Month' },
  { key: 'LAST_6M', label: 'Last 6 Months' },
  { key: 'LAST_1Y', label: 'Last 1 Year' },
  { key: 'ALL', label: 'All Time' },
];

const AGENT_KPI_VISUAL: Record<string, { accent: string; icon: typeof Receipt }> = {
  Agents: { accent: '#059669', icon: ShieldCheck },
  Payments: { accent: '#6366f1', icon: Receipt },
  'Total collected': { accent: '#10b981', icon: TrendingUp },
  'Top collector': { accent: '#0d9488', icon: UserCircle2 },
};

const REPORTS: { key: ReportKey; label: string; icon: typeof Users; accent: string }[] = [
  { key: 'loans', label: 'Loans', icon: Layers, accent: '#6366f1' },
  { key: 'customers', label: 'Customers', icon: Users, accent: '#8b5cf6' },
  { key: 'collections', label: 'Collections', icon: Receipt, accent: '#10b981' },
  { key: 'agents', label: 'Agents', icon: ShieldCheck, accent: '#059669' },
  { key: 'expenses', label: 'Expenses', icon: Wallet, accent: '#f59e0b' },
];

const REPORT_CELL = 'box-border px-5 py-3.5 align-middle';
const REPORT_CELL_NAME = 'box-border py-3.5 pl-5 pr-1 align-middle text-left';
const REPORT_CELL_AMOUNT = 'box-border py-3.5 pl-1 pr-4 align-middle text-left font-display tabular-nums tracking-normal whitespace-nowrap';
/** Customers report — fixed widths so “Monthly Income” is not a wide right-aligned gap. */
const CUSTOMER_REPORT_COL_WIDTHS = ['11%', '18%', '12%', '11%', '15%', '13%', '12%'];

const EXPENSE_REPORT_COLS = [
  { width: '12%', align: 'left' as const, id: 'date' },
  { width: '13%', align: 'left' as const, id: 'category' },
  { width: '18%', align: 'left' as const, id: 'sub' },
  { width: '16%', align: 'left' as const, id: 'name' },
  { width: '14%', align: 'left' as const, id: 'amount' },
  { width: '11%', align: 'center' as const, id: 'mode' },
];
const reportAlign = (right: boolean) => (right ? 'text-right' : 'text-left');
const expenseColAlign = (a: 'left' | 'right' | 'center') => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');
const expenseReportCell = (ci: number, extra?: string) => {
  const col = EXPENSE_REPORT_COLS[ci];
  if (!col) return cn(REPORT_CELL, extra);
  if (col.id === 'amount') return cn(REPORT_CELL_AMOUNT, extra);
  if (col.id === 'name') return cn(REPORT_CELL_NAME, extra);
  return cn(REPORT_CELL, expenseColAlign(col.align), extra);
};

// ── the applied filter state (draft is edited in the drawer, applied on button) ──
interface ReportFilters {
  period: Period;
  loanStatus: 'ALL' | 'ACTIVE' | 'CLOSED';
  loanType: 'ALL' | LoanType;
  expenseCat: 'ALL' | string;
  collector: CollectorFilter;
}
const defaultFilters = (): ReportFilters => ({
  period: 'ALL', loanStatus: 'ALL', loanType: 'ALL', expenseCat: 'ALL', collector: 'ALL',
});
/** How many non-default filter facets are active (excludes search, which lives in the toolbar). */
function countActive(tab: ReportKey, f: ReportFilters): number {
  let n = 0;
  if (f.period !== 'ALL') n++;
  if (tab === 'loans') { if (f.loanStatus !== 'ALL') n++; if (f.loanType !== 'ALL') n++; }
  if (tab === 'expenses' && f.expenseCat !== 'ALL') n++;
  if (tab === 'collections' && f.collector !== 'ALL') n++;
  return n;
}

// Complete dataset the report is built from (in-memory for preview, fetched for export).
interface Dataset { customers: Customer[]; loans: Loan[]; collections: Collection[]; expenses: Expense[]; }
interface BuildArgs {
  since: string;
  q: string;
  loanStatus: 'ALL' | 'ACTIVE' | 'CLOSED';
  loanType: 'ALL' | LoanType;
  expenseCat: 'ALL' | string;
  collector: CollectorFilter;
}
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
    // Deduction = interest kept at disbursal; Given = cash the borrower
    // actually received. Only Daily Collection deducts upfront, so for every
    // other type deduction is ₹0 and Given equals Principal — the columns are
    // safe across all loan types rather than daily-only.
    const dedFor = (l: Loan) => Math.max(0, l.principal - cashDisbursedFor(l));
    const deduction = rows.reduce((s, l) => s + dedFor(l), 0);
    const given = rows.reduce((s, l) => s + cashDisbursedFor(l), 0);
    return {
      head: ['Loan #', 'Customer', 'Loan Type', 'Given to Borrower', 'Principal', 'Deduction', 'Interest', 'Loan Date', 'Status'],
      body: rows.map((l) => [
        l.loanNumber, custName(l.customerId), LOAN_LABELS[l.type],
        inr(cashDisbursedFor(l)), inr(l.principal), inr(dedFor(l)),
        inr(l.interest), fmtDate(l.loanDate), l.status,
      ]),
      rightAlignCols: [3, 4, 5, 6],
      kpis: [
        { label: 'Loans', value: String(rows.length) },
        { label: 'Total Principal', value: inr(principal) },
        { label: 'Total Deduction', value: inr(deduction) },
        { label: 'Given to Borrowers', value: inr(given) },
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
      rightAlignCols: [],
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
    if (f.collector !== 'ALL') rows = rows.filter((c) => collectorMatchesFilter(c, f.collector));
    if (q) rows = rows.filter((c) => {
      const loan = loanById.get(c.loanId);
      const who = resolveCollector(c);
      return c.receiptNo.toLowerCase().includes(q)
        || (loan ? custName(loan.customerId).toLowerCase().includes(q) : false)
        || who.name.toLowerCase().includes(q)
        || who.roleLabel.toLowerCase().includes(q);
    });
    const total = rows.reduce((s, c) => s + c.amount, 0);
    const agentTotal = rows.filter((c) => resolveCollector(c).type === 'RECOVERY_AGENT').reduce((s, c) => s + c.amount, 0);
    const staffTotal = rows.filter((c) => {
      const t = resolveCollector(c).type;
      return t === 'STAFF' || t === 'ADMIN';
    }).reduce((s, c) => s + c.amount, 0);
    const customerTotal = rows.filter((c) => resolveCollector(c).type === 'CUSTOMER').reduce((s, c) => s + c.amount, 0);
    return {
      head: ['Receipt', 'Customer', 'Loan #', 'Amount', 'Mode', 'UPI ID', 'Payee name', 'Date', 'Collected by', 'Role'],
      body: rows.map((c) => {
        const loan = loanById.get(c.loanId);
        const who = resolveCollector(c);
        const [upiId, payeeName] = formatUpiReportCells(c);
        return [
          c.receiptNo,
          loan ? custName(loan.customerId) : '—',
          loan?.loanNumber ?? '—',
          inr(c.amount),
          c.mode,
          upiId,
          payeeName,
          fmtDate(c.date),
          who.name,
          who.roleLabel,
        ];
      }),
      rightAlignCols: [3],
      kpis: [
        { label: 'Payments', value: String(rows.length) },
        { label: 'Total Collected', value: inr(total) },
        ...(agentTotal > 0 ? [{ label: 'Via agents', value: inr(agentTotal) }] : []),
        ...(staffTotal > 0 ? [{ label: 'Via staff', value: inr(staffTotal) }] : []),
        ...(customerTotal > 0 ? [{ label: 'Via customer', value: inr(customerTotal) }] : []),
      ],
    };
  }

  if (tab === 'agents') {
    const built = buildAgentCollectionReport(data.collections, data.loans, data.customers, f.since, f.q);
    return {
      head: built.head,
      body: built.body,
      rightAlignCols: built.rightAlignCols,
      kpis: built.kpis,
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

/** One row of the Collections tab's grouped PREVIEW: a loan with its collection
 *  totals. Purely a display aggregation over the same rows buildReport() emits —
 *  the CSV/PDF exports still use the flat receipt list, unchanged. */
interface LoanCollectionGroup {
  loan: Loan;
  customer: string;
  receipts: Collection[];
  collected: number;   // total money received on this loan (in range)
  interest: number;    // profit portion — see the recognition rules below
  principal: number;   // collected − interest
  lastDate: string;    // most recent receipt in range
  totalDue: number;    // schedule shortfall today (not loan outstanding)
}

/** Group the in-range receipts by loan, with the interest/principal split.
 *  Recognition mirrors Dashboard.profitByCollectionId (the single source of
 *  truth for profit) so the two screens can never disagree:
 *   • interest-only behaviour → every non-PRINCIPAL payment is interest;
 *   • upfront/EMI → profit-last: the band (disbursed, disbursed + margin]. */
function groupCollectionsByLoan(
  rows: Collection[],
  loans: Loan[],
  customers: Customer[],
  dueForLoan: (loan: Loan) => number,
): LoanCollectionGroup[] {
  const nameById = new Map(customers.map((c) => [c.id, c.name] as const));
  const loanById = new Map(loans.map((l) => [l.id, l] as const));
  const byLoan = new Map<number, Collection[]>();
  for (const c of rows) {
    const arr = byLoan.get(c.loanId) ?? [];
    arr.push(c);
    byLoan.set(c.loanId, arr);
  }
  const out: LoanCollectionGroup[] = [];
  for (const [loanId, list] of byLoan) {
    const loan = loanById.get(loanId);
    if (!loan) continue; // receipt whose loan is filtered out / deleted
    const ordered = [...list].sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
    const collected = ordered.reduce((s, c) => s + c.amount, 0);
    let interest = 0;
    if (behavesInterestOnly(loan)) {
      interest = ordered.filter((c) => c.kind !== 'PRINCIPAL').reduce((s, c) => s + c.amount, 0);
    } else {
      const disbursed = loan.disbursed ?? Math.max(0, loan.principal - (loan.deduction ?? 0));
      const margin = (loan.deduction ?? 0) > 0 ? (loan.deduction ?? 0) : loan.interest;
      let cum = 0;
      for (const c of ordered) {
        const before = cum;
        cum += c.amount;
        interest += Math.max(0, Math.min(cum, disbursed + margin) - Math.max(before, disbursed));
      }
    }
    out.push({
      loan,
      customer: nameById.get(loan.customerId) ?? '—',
      receipts: [...ordered].reverse(), // newest first for the drill-down
      collected,
      interest,
      principal: Math.max(0, collected - interest),
      lastDate: ordered[ordered.length - 1]?.date ?? '',
      totalDue: loan.status === 'CLOSED' ? 0 : dueForLoan(loan),
    });
  }
  // Most recently active loan first.
  return out.sort((a, b) => (a.lastDate === b.lastDate ? b.collected - a.collected : a.lastDate < b.lastDate ? 1 : -1));
}

export default function Reports() {
  const d = useData();
  const toast = useToast();
  // Deep link from the Dashboard KPIs (?tab=collections|expenses) — opens the
  // matching report directly. Read once as the initial tab; the user is free to
  // switch afterwards.
  const [searchParams] = useSearchParams();
  const initialTab = ((): ReportKey => {
    const t = (searchParams.get('tab') ?? '') as ReportKey;
    return REPORTS.some((r) => r.key === t) ? t : 'loans';
  })();
  const [tab, setTab] = useState<ReportKey>(initialTab);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters());
  const [draft, setDraft] = useState<ReportFilters>(defaultFilters());
  const [filterOpen, setFilterOpen] = useState(false);
  const [exporting, setExporting] = useState<'' | 'csv' | 'pdf'>('');
  // Collections drill-down: the loan whose receipts are being inspected.
  const [detail, setDetail] = useState<LoanCollectionGroup | null>(null);
  const [agentDetail, setAgentDetail] = useState<AgentCollectionSummary | null>(null);
  const recovery = useRecovery();
  const [upiLinkTick, setUpiLinkTick] = useState(0);

  useEffect(() => {
    syncApprovedClaimUpiToCollections(d.collections, recovery.submissions);
    setUpiLinkTick((t) => t + 1);
  }, [d.collections, recovery.submissions]);

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
  const buildArgs: BuildArgs = {
    since, q, loanStatus: filters.loanStatus, loanType: filters.loanType, expenseCat: filters.expenseCat, collector: filters.collector,
  };

  // Preview report — client-side over loaded lists (instant, no fetch).
  const report = useMemo(
    () => buildReport(tab, { customers: d.customers, loans: d.loans, collections: d.collections, expenses: d.expenses }, buildArgs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, filters, query, d, upiLinkTick],
  );

  // Collections tab PREVIEW is grouped by loan (319 raw receipts are unreadable);
  // clicking a row opens its receipts. Exports stay flat — see runExport.
  const collectionGroups = useMemo(() => {
    if (tab !== 'collections') return [];
    let rows = d.collections;
    if (since) rows = rows.filter((c) => c.date >= since);
    if (filters.collector !== 'ALL') rows = rows.filter((c) => collectorMatchesFilter(c, filters.collector));
    if (q) {
      const loanById = new Map(d.loans.map((l) => [l.id, l] as const));
      const nameById = new Map(d.customers.map((c) => [c.id, c.name] as const));
      rows = rows.filter((c) => {
        const loan = loanById.get(c.loanId);
        const who = resolveCollector(c);
        return c.receiptNo.toLowerCase().includes(q)
          || (loan ? (nameById.get(loan.customerId) ?? '').toLowerCase().includes(q) : false)
          || (loan?.loanNumber.toLowerCase().includes(q) ?? false)
          || who.name.toLowerCase().includes(q)
          || who.roleLabel.toLowerCase().includes(q);
      });
    }
    return groupCollectionsByLoan(rows, d.loans, d.customers, (loan) => scheduleShortfall(d, loan));
  }, [tab, since, q, filters.collector, d]);

  const agentSummaries = useMemo(() => {
    if (tab !== 'agents') return [];
    return buildAgentCollectionReport(
      d.collections, d.loans, d.customers, since, q,
    ).summaries;
  }, [tab, since, q, d]);

  const agentReceiptCount = useMemo(() => {
    if (tab !== 'agents') return 0;
    return filterAgentCollections(d.collections, d.loans, d.customers, since, q).length;
  }, [tab, since, q, d]);

  const meta = REPORTS.find((r) => r.key === tab)!;
  const periodLabel = PERIODS.find((p) => p.key === filters.period)!.label;
  const activeCount = countActive(tab, filters);
  const stamp = todayISO();

  const openFilters = () => { setDraft(filters); setFilterOpen(true); };
  const applyFilters = () => { setFilters(draft); setFilterOpen(false); };
  const clearAll = () => { setFilters(defaultFilters()); setQuery(''); };

  // Live match count for the drawer's MatchPreview (reflects the DRAFT filters).
  const tabTotal = tab === 'loans' ? d.loans.length
    : tab === 'customers' ? d.customers.length
      : tab === 'collections' ? d.collections.length
        : tab === 'agents' ? agentSummaries.length
          : d.expenses.length;
  const draftMatched = useMemo(
    () => buildReport(tab, { customers: d.customers, loans: d.loans, collections: d.collections, expenses: d.expenses },
      {
        since: periodSince(draft.period), q, loanStatus: draft.loanStatus, loanType: draft.loanType, expenseCat: draft.expenseCat, collector: draft.collector,
      }).body.length,
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
    if (tab === 'agents') {
      const collections = await collectionApi.fetchAllInRange({ from, to });
      return buildReport('agents', { customers: d.customers, loans: d.loans, collections, expenses: [] }, { ...buildArgs, since: '' });
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
        // ~415 KB of jsPDF, fetched only when a PDF is actually requested.
        const { buildDatasetReportPDF, shareOrDownloadPDF } = await import('@/lib/pdfReport');
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
    <div className="flex min-h-full min-w-0 w-full flex-col">
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
      <div className="page-content-shell">

      {/* Portfolio KPI band */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4 [&>*]:min-w-0">
        <StatCard label="Customers" value={String(portfolio.customers)} accent="#8b5cf6" icon={<Users size={16} />} />
        <StatCard label="Outstanding" value={inr(portfolio.outstanding)} accent="#6366f1" icon={<IndianRupee size={16} />} countUp={portfolio.outstanding} />
        <StatCard label="Collected" value={inr(portfolio.collected)} accent="#10b981" icon={<TrendingUp size={16} />} countUp={portfolio.collected} />
        <StatCard label="Expenses" value={inr(portfolio.expenses)} accent="#f59e0b" icon={<Wallet size={16} />} countUp={portfolio.expenses} />
      </div>

      {/* One unified panel: tabs → toolbar → chart → table */}
      <div className="overflow-hidden rounded-[18px] border-[0.5px] border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(30,39,64,.04)] dark:border-white/[.08] dark:bg-surface">
        {/* report tabs — 2×2 grid on mobile so labels of different lengths stay aligned */}
        <div className="grid min-w-0 grid-cols-2 gap-2 border-b border-slate-100 px-3.5 pb-4 pt-4 dark:border-white/[.06] sm:flex sm:flex-wrap sm:px-6 sm:pt-5">
          {REPORTS.map((r) => {
            const Icon = r.icon;
            const active = tab === r.key;
            return (
              <button
                key={r.key}
                onClick={() => { setTab(r.key); setQuery(''); setDetail(null); setAgentDetail(null); }}
                className={cn(
                  'inline-flex min-w-0 w-full items-center justify-center gap-1.5 rounded-xl border-[0.5px] px-2.5 py-2 text-[12px] font-semibold transition-all sm:w-auto sm:justify-start sm:gap-2 sm:px-4 sm:text-[13.5px]',
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
        <div className="flex min-w-0 flex-col gap-3 border-b border-slate-100 px-3.5 py-4 dark:border-white/[.06] sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="mb-0 flex min-w-0 flex-wrap items-center gap-2.5 text-[13px] lg:mb-0">
            <span className="text-muted">Showing</span>
            {tab === 'collections' ? (
              <>
                <span className="font-semibold text-ink">{collectionGroups.length}</span>
                <span className="text-muted">{collectionGroups.length === 1 ? 'loan' : 'loans'} · {report.body.length} {report.body.length === 1 ? 'payment' : 'payments'}</span>
              </>
            ) : tab === 'agents' ? (
              <>
                <span className="font-semibold text-ink">{agentSummaries.length}</span>
                <span className="text-muted">{agentSummaries.length === 1 ? 'agent' : 'agents'} · {agentReceiptCount} {agentReceiptCount === 1 ? 'payment' : 'payments'}</span>
              </>
            ) : (
              <>
                <span className="font-semibold text-ink">{report.body.length}</span>
                <span className="text-muted">{report.body.length === 1 ? 'record' : 'records'}</span>
              </>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-medium text-ink/70 dark:bg-white/[.06]">
              <CalendarRange size={12} /> {periodLabel}
            </span>
            {activeCount > 0 && (
              <button onClick={clearAll} className="text-[12px] font-semibold text-blue-500 hover:underline">Clear filters</button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex w-full items-center gap-2 rounded-[11px] border-[0.5px] border-slate-200/80 bg-white px-3.5 py-[9px] transition-shadow focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 sm:w-52 dark:border-white/[.08] dark:bg-surface">
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

        {tab === 'collections' && report.body.length > 0 && (
          <div className="px-3.5 pb-1 pt-2 sm:px-6">
            <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50/90 via-surface to-emerald-500/[.04] p-4 shadow-soft dark:border-white/[.08] dark:from-white/[.03] dark:to-emerald-500/[.06] sm:p-5">
              <div className="mb-3.5 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Collection summary</p>
                  <p className="mt-0.5 text-[12px] text-muted">Totals for the selected period and filters</p>
                </div>
                {report.kpis.some((k) => k.label.startsWith('Via ')) && (
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                    By collector
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))] [&>*]:min-w-0">
                {report.kpis.map((k) => {
                  const vis = COLLECTION_KPI_VISUAL[k.label] ?? { accent: '#6366f1', icon: Receipt };
                  const Icon = vis.icon;
                  return (
                    <StatCard
                      key={k.label}
                      label={k.label}
                      value={k.value}
                      accent={vis.accent}
                      icon={<Icon size={16} />}
                      active={k.label === 'Total Collected'}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {tab === 'agents' && report.body.length > 0 && (
          <div className="px-3.5 pb-1 pt-2 sm:px-6">
            <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50/90 via-surface to-emerald-500/[.04] p-4 shadow-soft dark:border-white/[.08] dark:from-white/[.03] dark:to-emerald-500/[.06] sm:p-5">
              <div className="mb-3.5">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Recovery agents</p>
                <p className="mt-0.5 text-[12px] text-muted">Collections credited to recovery agents in this period</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
                {report.kpis.map((k) => {
                  const vis = AGENT_KPI_VISUAL[k.label] ?? { accent: '#059669', icon: ShieldCheck };
                  const Icon = vis.icon;
                  return (
                    <StatCard
                      key={k.label}
                      label={k.label}
                      value={k.value}
                      accent={vis.accent}
                      icon={<Icon size={16} />}
                      active={k.label === 'Total collected'}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* preview table */}
        <div className={cn(
          'px-3.5 pb-6 sm:px-6',
          (tab === 'collections' || tab === 'agents') && report.body.length > 0 ? 'pt-4' : 'pt-0',
        )}>
          {report.body.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <FileText size={30} className="text-slate-300 dark:text-white/20" />
              <p className="text-sm font-medium text-muted">No {meta.label.toLowerCase()} match this filter.</p>
              <p className="text-[12px] text-muted/70">Try a wider period or clear the filters.</p>
            </div>
          ) : tab === 'agents' ? (
            <ResponsiveTableFrame>
            <table className="w-full min-w-[880px] border-collapse text-sm">
              <thead>
                <tr className="bg-gradient-to-r from-[#022999] via-[#0538cc] to-[#0AA8F8] text-left text-[12px] font-bold uppercase tracking-[0.06em] text-white">
                  <th className="h-14 whitespace-nowrap px-6 align-middle">Agent</th>
                  <th className="h-14 whitespace-nowrap px-6 align-middle">Status</th>
                  <th className="h-14 whitespace-nowrap px-6 align-middle text-right">Payments</th>
                  <th className="h-14 whitespace-nowrap px-6 align-middle text-right">Total collected</th>
                  <th className="h-14 whitespace-nowrap px-6 align-middle text-right">Loans</th>
                  <th className="h-14 whitespace-nowrap px-6 align-middle">Last collection</th>
                  <th className="h-14 whitespace-nowrap px-6 align-middle text-right">Avg receipt</th>
                </tr>
              </thead>
              <tbody>
                {agentSummaries.slice(0, 50).map((a) => (
                  <tr
                    key={a.key}
                    onClick={() => setAgentDetail(a)}
                    tabIndex={0}
                    role="button"
                    aria-label={`${a.name} — view ${a.payments} payments`}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAgentDetail(a); } }}
                    className="group cursor-pointer border-t border-[#EEF2F7] transition-colors odd:bg-slate-50/30 hover:bg-blue-50/50 focus:outline-none focus-visible:bg-blue-50/60 dark:border-white/[.05] dark:odd:bg-white/[.015] dark:hover:bg-blue-500/[.06]"
                  >
                    <td className="h-[60px] whitespace-nowrap px-6 align-middle font-semibold text-ink">{a.name}</td>
                    <td className="h-[60px] whitespace-nowrap px-6 align-middle">
                      <Badge tone={a.unattributed ? 'neutral' : a.inactive ? 'warn' : 'ok'}>
                        {a.unattributed ? 'Unattributed' : a.inactive ? 'Inactive' : 'Active'}
                      </Badge>
                    </td>
                    <td className="h-[60px] whitespace-nowrap px-6 text-right align-middle tabular-nums text-ink/80">{a.payments}</td>
                    <td className="h-[60px] whitespace-nowrap px-6 text-right align-middle font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{inr(a.totalCollected)}</td>
                    <td className="h-[60px] whitespace-nowrap px-6 text-right align-middle tabular-nums text-ink/80">{a.loansTouched}</td>
                    <td className="h-[60px] whitespace-nowrap px-6 align-middle text-[13px] font-medium tabular-nums text-ink">{a.lastDate ? fmtDate(a.lastDate) : '—'}</td>
                    <td className="h-[60px] whitespace-nowrap px-6 text-right align-middle tabular-nums text-ink/80">
                      {a.payments ? inr(Math.round(a.totalCollected / a.payments)) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </ResponsiveTableFrame>
          ) : tab === 'collections' ? (
            /* Collections preview: ONE ROW PER LOAN — click for receipts incl. collector. */
            <ResponsiveTableFrame>
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="bg-gradient-to-r from-[#022999] via-[#0538cc] to-[#0AA8F8] text-left text-[12px] font-bold uppercase tracking-[0.06em] text-white">
                  <th className="h-14 whitespace-nowrap px-6 align-middle">Customer</th>
                  <th className="h-14 whitespace-nowrap px-6 align-middle">Loan</th>
                  <th className="h-14 whitespace-nowrap px-6 align-middle text-right">Principal</th>
                  <th className="h-14 whitespace-nowrap px-6 align-middle text-right">Collected</th>
                  <th className="h-14 whitespace-nowrap px-6 align-middle text-right">
                    <span className="block">Total due</span>
                    <span className="mt-0.5 block text-[10px] font-semibold normal-case tracking-normal text-white/75">On schedule</span>
                  </th>
                  <th className="h-14 whitespace-nowrap px-6 align-middle text-right">Interest</th>
                  <th className="h-14 whitespace-nowrap px-6 align-middle text-right">Outstanding</th>
                  <th className="h-14 whitespace-nowrap px-6 align-middle">Payments</th>
                  <th className="h-14 whitespace-nowrap px-6 align-middle">Collected by</th>
                  <th className="h-14 whitespace-nowrap px-6 align-middle">
                    <span className="block">Last payment</span>
                    <span className="mt-0.5 block text-[10px] font-semibold normal-case tracking-normal text-white/75">Loan status</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {collectionGroups.slice(0, 50).map((g) => {
                  const closed = g.loan.status === 'CLOSED';
                  return (
                    <tr
                      key={g.loan.id}
                      onClick={() => setDetail(g)}
                      tabIndex={0}
                      role="button"
                      aria-label={`${g.customer}, loan ${g.loan.loanNumber} — view ${g.receipts.length} payments`}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetail(g); } }}
                      className="group cursor-pointer border-t border-[#EEF2F7] transition-colors odd:bg-slate-50/30 hover:bg-blue-50/50 focus:outline-none focus-visible:bg-blue-50/60 dark:border-white/[.05] dark:odd:bg-white/[.015] dark:hover:bg-blue-500/[.06]"
                    >
                      <td className="h-[60px] max-w-[9rem] px-6 align-middle sm:max-w-none sm:whitespace-nowrap">
                        <TruncatedTapPopoverText className="font-semibold text-ink">{g.customer}</TruncatedTapPopoverText>
                      </td>
                      <td className="h-[60px] whitespace-nowrap px-6 align-middle">
                        <div className="font-mono text-xs text-ink">{g.loan.loanNumber}</div>
                        <div className="text-[11.5px] text-muted">{LOAN_LABELS[g.loan.type]}</div>
                      </td>
                      <td className="h-[60px] whitespace-nowrap px-6 text-right align-middle tabular-nums text-ink/80">{inr(g.loan.principal)}</td>
                      <td className="h-[60px] whitespace-nowrap px-6 text-right align-middle font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{inr(g.collected)}</td>
                      <td className="h-[60px] whitespace-nowrap px-6 text-right align-middle font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                        {closed ? '—' : inr(g.totalDue)}
                      </td>
                      <td className="h-[60px] whitespace-nowrap px-6 text-right align-middle tabular-nums text-ink/80">{inr(g.interest)}</td>
                      <td className="h-[60px] whitespace-nowrap px-6 text-right align-middle font-semibold tabular-nums text-ink">{closed ? inr(0) : inr(d.outstandingFor(g.loan))}</td>
                      <td className="h-[60px] whitespace-nowrap px-6 align-middle text-ink/80">{g.receipts.length}</td>
                      <td className="h-[60px] max-w-[12rem] px-6 align-middle">
                        {(() => {
                          const col = loanCollectorDisplay(g.receipts);
                          if (!col) return <span className="text-[12px] text-muted">—</span>;
                          return (
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-semibold text-ink">{col.name}</p>
                              <p className="text-[10px] font-medium text-muted">{col.roleLine}</p>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="h-[60px] whitespace-nowrap px-6 align-middle">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                          <span className="text-[13px] font-medium tabular-nums text-ink">{g.lastDate ? fmtDate(g.lastDate) : '—'}</span>
                          <Badge tone={closed ? 'err' : 'ok'}>{closed ? 'Closed' : 'Active'}</Badge>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </ResponsiveTableFrame>
          ) : (
            <ResponsiveTableFrame>
            <table className={cn(
              'w-full border-collapse text-sm',
              tab === 'expenses' ? 'min-w-[820px] table-fixed' : 'min-w-[900px] table-fixed',
            )}>
              {tab === 'expenses' && (
                <colgroup>
                  {EXPENSE_REPORT_COLS.map((col, i) => (
                    <col key={i} style={{ width: col.width }} />
                  ))}
                </colgroup>
              )}
              {tab === 'customers' && (
                <colgroup>
                  {CUSTOMER_REPORT_COL_WIDTHS.map((width, i) => (
                    <col key={i} style={{ width }} />
                  ))}
                </colgroup>
              )}
              <thead>
                <tr className="bg-gradient-to-r from-[#022999] via-[#0538cc] to-[#0AA8F8] text-[12px] font-bold uppercase tracking-[0.06em] text-white">
                  {report.head.map((h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={cn(
                        tab === 'expenses'
                          ? expenseReportCell(i, cn('text-[12px] font-bold uppercase tracking-[0.06em]'))
                          : cn('box-border h-14 whitespace-nowrap px-5 align-middle', reportAlign(report.rightAlignCols.includes(i))),
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.body.slice(0, 50).map((row, ri) => (
                  <tr key={ri} className="border-t border-[#EEF2F7] transition-colors odd:bg-slate-50/30 hover:bg-blue-50/50 dark:border-white/[.05] dark:odd:bg-white/[.015] dark:hover:bg-blue-500/[.05]">
                    {row.map((cell, ci) => {
                      const header = report.head[ci];
                      const money = report.rightAlignCols.includes(ci);
                      const textTip =
                        (header === 'Customer' || (tab === 'customers' && header === 'Name'))
                        && cell && cell !== '—'
                          ? String(cell)
                          : undefined;
                      return (
                        <td
                          key={ci}
                          className={cn(
                          tab === 'expenses'
                            ? expenseReportCell(ci, cn(
                              'tabular-nums',
                              money ? 'text-[14.5px] font-bold text-ink' : 'overflow-hidden text-[13.5px] text-ink/75',
                            ))
                            : cn('box-border h-[54px] align-middle px-5 tabular-nums', reportAlign(money), money
                              ? 'whitespace-nowrap font-display text-[14.5px] font-bold text-ink'
                              : 'truncate text-[13.5px] text-ink/75'),
                          header === 'Loan #' && 'font-mono text-xs font-semibold text-ink',
                        )}>
                          {/* Typed cells render as coloured chips so status,
                              category and mode are scannable. Plain text
                              otherwise — and the EXPORTS are unaffected, since
                              they read report.body, not this markup. */}
                          {header === 'Status' && (cell === 'ACTIVE' || cell === 'CLOSED')
                            ? <Badge tone={cell === 'CLOSED' ? 'err' : 'ok'}>{cell === 'CLOSED' ? 'Closed' : 'Active'}</Badge>
                            : header === 'Mode'
                              ? tab === 'expenses'
                                ? <div className="flex w-full justify-center"><Badge tone="neutral" className="max-w-full truncate">{cell}</Badge></div>
                                : <Badge tone="neutral">{cell}</Badge>
                              : header === 'Category'
                                ? <span className={cn(
                                  'inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2.5 py-1 text-[11.5px] font-bold',
                                  cell === 'Investor Interest' ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                                    : cell === 'Office' ? 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
                                      : cell === 'Personal' ? 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
                                        : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
                                )}>
                                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />
                                  <span className="truncate">{cell}</span>
                                </span>
                                : header === 'Loan Type'
                                  ? <Badge tone="info">{cell}</Badge>
                                  : textTip
                                    ? <TruncatedTapPopoverText title={textTip}>{textTip}</TruncatedTapPopoverText>
                                    : cell}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {/* Column totals for the money columns — a report without totals
                  makes the reader add it up themselves. */}
              {report.body.length > 0 && report.rightAlignCols.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50/80 dark:border-white/[.1] dark:bg-white/[.03]">
                    {report.head.map((h, i) => {
                      if (i === 0) {
                        return (
                          <td key={h} className={cn(REPORT_CELL, 'text-left text-[11.5px] font-bold uppercase tracking-wide text-muted')}>
                            Total · {report.body.length} {report.body.length === 1 ? 'row' : 'rows'}
                          </td>
                        );
                      }
                      if (!report.rightAlignCols.includes(i)) return <td key={h} />;
                      // Sum only parseable money cells; a non-numeric column is
                      // left blank rather than shown as a false 0.
                      let sum = 0; let seen = false;
                      for (const row of report.body) {
                        const n = Number(String(row[i]).replace(/[₹,\s]/g, ''));
                        if (Number.isFinite(n)) { sum += n; seen = true; }
                      }
                      return (
                        <td key={h} className={cn(
                          tab === 'expenses' ? cn(REPORT_CELL_AMOUNT, 'text-[15px] font-bold text-ink') : cn(REPORT_CELL, 'whitespace-nowrap text-right font-display text-[15px] font-bold tabular-nums text-ink'),
                        )}>
                          {seen ? inr(sum) : ''}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
            </ResponsiveTableFrame>
          )}
          {tab === 'collections' ? (
            collectionGroups.length > 50 && (
              <div className="border-t border-[#EEF2F7] px-6 py-3 text-center text-[12px] text-muted dark:border-white/[.06]">
                Preview shows first 50 of {collectionGroups.length} loans · export includes all {report.body.length} payments
              </div>
            )
          ) : tab === 'agents' ? (
            agentSummaries.length > 50 && (
              <div className="border-t border-[#EEF2F7] px-6 py-3 text-center text-[12px] text-muted dark:border-white/[.06]">
                Preview shows first 50 of {agentSummaries.length} agents · export includes all {agentReceiptCount} payments
              </div>
            )
          ) : report.body.length > 50 && (
            <div className="border-t border-[#EEF2F7] px-6 py-3 text-center text-[12px] text-muted dark:border-white/[.06]">
              Preview shows first 50 of {report.body.length} rows · export includes all
            </div>
          )}
        </div>
      </div>
      </div>

      <Dialog
        wide
        open={!!agentDetail}
        onClose={() => setAgentDetail(null)}
        title={agentDetail ? agentDetail.name : ''}
        subtitle={agentDetail ? `${agentDetail.payments} ${agentDetail.payments === 1 ? 'payment' : 'payments'} · ${periodLabel}` : ''}
        footer={<Button variant="ghost" onClick={() => setAgentDetail(null)}>Close</Button>}
      >
        {agentDetail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {[
                { k: 'Total collected', v: inr(agentDetail.totalCollected), tone: 'text-emerald-600 dark:text-emerald-400' },
                { k: 'Loans touched', v: String(agentDetail.loansTouched) },
                { k: 'Last collection', v: agentDetail.lastDate ? fmtDate(agentDetail.lastDate) : '—' },
                { k: 'Avg receipt', v: agentDetail.payments ? inr(Math.round(agentDetail.totalCollected / agentDetail.payments)) : '—' },
              ].map((s) => (
                <div key={s.k} className="rounded-xl border-[0.5px] border-slate-200/80 bg-slate-50/60 px-3 py-2.5 dark:border-white/[.08] dark:bg-white/[.02]">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{s.k}</div>
                  <div className={cn('mt-0.5 font-display text-[15px] font-bold tabular-nums text-ink', s.tone)}>{s.v}</div>
                </div>
              ))}
            </div>
            <div className="max-h-80 overflow-auto rounded-xl border-[0.5px] border-slate-200/80 dark:border-white/[.08]">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-slate-100 [&>th]:px-3 [&>th]:py-2.5 dark:[&>th]:bg-slate-800">
                    <th>Receipt</th><th>Date</th><th>Customer</th><th>Loan #</th><th className="text-right">Amount</th><th>Mode</th><th>UPI ID</th><th>Payee</th>
                  </tr>
                </thead>
                <tbody>
                  {agentDetail.receipts.map((c) => {
                    const loan = d.loans.find((l) => l.id === c.loanId);
                    const customer = loan ? d.customers.find((x) => x.id === loan.customerId)?.name ?? '—' : '—';
                    const [upiId, payeeName] = formatUpiReportCells(c);
                    return (
                      <tr key={c.id} className="border-t border-slate-100 dark:border-white/[.06]">
                        <td className="px-3 py-2 font-mono text-xs text-ink">{c.receiptNo}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-ink/80">{fmtDate(c.date)}</td>
                        <td className="px-3 py-2 text-ink">{customer}</td>
                        <td className="px-3 py-2 font-mono text-xs text-ink">{loan?.loanNumber ?? '—'}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">{inr(c.amount)}</td>
                        <td className="px-3 py-2"><Badge tone="neutral">{c.mode}</Badge></td>
                        <td className="max-w-[8rem] truncate px-3 py-2 font-mono text-[11px] text-ink">{upiId}</td>
                        <td className="max-w-[7rem] truncate px-3 py-2 text-[12px] text-ink">{payeeName}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50/80 dark:border-white/[.1] dark:bg-white/[.03]">
                    <td className="px-3 py-2.5 text-[12px] font-bold uppercase tracking-wide text-muted" colSpan={4}>Total</td>
                    <td className="px-3 py-2.5 text-right font-display text-[14px] font-bold tabular-nums text-ink">{inr(agentDetail.totalCollected)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </Dialog>

      {/* Collections drill-down: the selected loan's own receipts. Read-only —
          money is edited in the loan's Collection Ledger, never from a report. */}
      <Dialog
        wide
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.customer} · ${detail.loan.loanNumber}` : ''}
        subtitle={detail ? `${LOAN_LABELS[detail.loan.type]} · ${detail.receipts.length} ${detail.receipts.length === 1 ? 'payment' : 'payments'} · ${periodLabel}` : ''}
        footer={<Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>}
      >
        {detail && (
          <div className="space-y-4">
            {/* Identity band — avatar, borrower, loan facts, status. Brand
                blue→violet gradient, matching the app's accent. */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-blue-500 to-violet-500 px-5 py-4 text-white shadow-[0_10px_30px_-14px_rgba(37,99,235,.55)]">
              {/* soft light bloom, purely decorative */}
              <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
              <div className="relative flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/20 font-display text-[16px] font-bold backdrop-blur-sm">
                    {detail.customer.trim().charAt(0).toUpperCase() || '—'}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-display text-[17px] font-bold leading-tight">{detail.customer}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-white/85">
                      <span className="font-mono">{detail.loan.loanNumber}</span>
                      <span aria-hidden>·</span>
                      <span>{LOAN_LABELS[detail.loan.type]}</span>
                      <span aria-hidden>·</span>
                      <span>{detail.loan.rate}%</span>
                    </div>
                  </div>
                </div>
                <span className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-bold backdrop-blur-sm',
                  detail.loan.status === 'CLOSED' ? 'bg-danger/30 text-red-50 ring-danger/40' : 'bg-emerald-400/25 text-emerald-50 ring-emerald-300/35',
                )}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current opacity-90" />
                  {detail.loan.status === 'CLOSED' ? 'Closed' : 'Active'}
                </span>
              </div>
              {/* Loan-date / instalment strip */}
              <div className="relative mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-white/20 pt-2.5 text-[12px] text-white/85">
                <span>Loan date <span className="font-semibold text-white">{fmtDate(detail.loan.loanDate)}</span></span>
                {detail.loan.dailyAmount ? <span>Instalment <span className="font-semibold text-white">{inr(detail.loan.dailyAmount)}</span></span> : null}
                <span>Last payment <span className="font-semibold text-white">{detail.lastDate ? fmtDate(detail.lastDate) : '—'}</span></span>
              </div>
            </div>

            {/* Money summary */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
              {[
                { k: 'Principal', v: inr(detail.loan.principal) },
                { k: 'Collected (period)', v: inr(detail.collected), tone: 'text-emerald-600 dark:text-emerald-400' },
                { k: 'Total due', v: detail.loan.status === 'CLOSED' ? '—' : inr(detail.totalDue), tone: 'text-amber-700 dark:text-amber-300' },
                { k: 'Interest', v: inr(detail.interest) },
                { k: detail.loan.status === 'CLOSED' ? 'Closed on' : 'Outstanding', v: detail.loan.status === 'CLOSED' ? fmtDate(detail.lastDate) : inr(d.outstandingFor(detail.loan)) },
              ].map((s) => (
                <div key={s.k} className="rounded-xl border-[0.5px] border-slate-200/80 bg-slate-50/60 px-3 py-2.5 dark:border-white/[.08] dark:bg-white/[.02]">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{s.k}</div>
                  <div className={cn('mt-0.5 font-display text-[15px] font-bold tabular-nums text-ink', s.tone)}>{s.v}</div>
                </div>
              ))}
            </div>
            {/* Receipts, newest first */}
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <h4 className="text-[11px] font-bold uppercase tracking-wide text-muted">Payment history</h4>
                <span className="text-[11.5px] text-muted">{detail.receipts.length} {detail.receipts.length === 1 ? 'receipt' : 'receipts'}</span>
              </div>
              <div className="max-h-80 overflow-auto rounded-xl border-[0.5px] border-slate-200/80 dark:border-white/[.08]">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-slate-100 [&>th]:px-3 [&>th]:py-2.5 dark:[&>th]:bg-slate-800">
                      <th>Receipt</th><th>Date</th><th className="text-right">Amount</th><th>Mode</th><th>UPI ID</th><th>Payee</th><th>Collected by</th><th>Role</th><th>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.receipts.map((c) => {
                      const who = resolveCollector(c);
                      const [upiId, payeeName] = formatUpiReportCells(c);
                      return (
                      <tr key={c.id} className="border-t border-slate-100 transition-colors hover:bg-slate-50/70 dark:border-white/[.06] dark:hover:bg-white/[.03]">
                        <td className="px-3 py-2 font-mono text-xs text-ink">{c.receiptNo}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-ink/80">{fmtDate(c.date)}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">{inr(c.amount)}</td>
                        <td className="px-3 py-2"><Badge tone="neutral">{c.mode}</Badge></td>
                        <td className="max-w-[8rem] truncate px-3 py-2 font-mono text-[11px] text-ink">{upiId}</td>
                        <td className="max-w-[7rem] truncate px-3 py-2 text-[12px] text-ink">{payeeName}</td>
                        <td className="px-3 py-2 text-[12px] font-medium text-ink">{who.name}</td>
                        <td className="px-3 py-2">
                          <Badge tone={collectorBadgeTone(who.type)}>{who.roleLabel}</Badge>
                        </td>
                        <td className="px-3 py-2 text-muted">{c.remarks ?? '—'}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50/80 dark:border-white/[.1] dark:bg-white/[.03]">
                      <td className="px-3 py-2.5 text-[12px] font-bold uppercase tracking-wide text-muted" colSpan={2}>Total</td>
                      <td className="px-3 py-2.5 text-right font-display text-[14px] font-bold tabular-nums text-ink">{inr(detail.collected)}</td>
                      <td colSpan={5} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}
      </Dialog>

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
          {tab === 'collections' && (
            <FilterCard icon={<UserCircle2 size={16} />} title="Collected by" color="violet" active={draft.collector !== 'ALL'}>
              <SegGroup>
                <Seg active={draft.collector === 'ALL'} onClick={() => setDraft({ ...draft, collector: 'ALL' })}>All</Seg>
                <Seg active={draft.collector === 'RECOVERY_AGENT'} onClick={() => setDraft({ ...draft, collector: 'RECOVERY_AGENT' })} tone="emerald">Recovery agent</Seg>
                <Seg active={draft.collector === 'STAFF'} onClick={() => setDraft({ ...draft, collector: 'STAFF' })}>Staff</Seg>
                <Seg active={draft.collector === 'CUSTOMER'} onClick={() => setDraft({ ...draft, collector: 'CUSTOMER' })}>Customer</Seg>
              </SegGroup>
            </FilterCard>
          )}

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

          {tab === 'customers' && (
            <p className="px-1 text-[12px] text-muted">Use the search box and period to scope this report.</p>
          )}
          {tab === 'collections' && (
            <p className="px-1 text-[12px] text-muted">
              Filter by who received the payment. Only receipts recorded with collector details (ledger or approved recovery) show a name; others appear as Unknown.
            </p>
          )}
          {tab === 'agents' && (
            <p className="px-1 text-[12px] text-muted">
              Recovery-agent totals for the selected period. Use search to find an agent, receipt, loan, or customer. Click a row to see every payment.
            </p>
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
