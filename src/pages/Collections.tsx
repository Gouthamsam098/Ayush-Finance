import { useEffect, useMemo, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import type { RootState } from '@/store';
import { config } from '@/lib/config';
import { useData, LOAN_LABELS, isDailyLoan, isMonthlyLike, isInterestOnly, behavesInterestOnly, isEmiLoan, type LoanType, type Loan } from '@/mock/DataContext';
import { CollectionsAgentView } from '@/features/recovery/CollectionsAgentView';
import { RecoveryQueuePanel } from '@/features/recovery/components/RecoveryQueuePanel';
import { useRecovery } from '@/features/recovery/RecoveryContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/ui/stat-card';
import { PageHeader } from '@/components/layout/PageHeader';
import { LedgerDialog } from '@/components/LedgerDialog';
import { usePermissions } from '@/lib/permissions';
import { CollectionProgress } from '@/components/CollectionProgress';
import { inr, inrShort, fmtDate, todayISO, isoLocal, DAILY_TERM, addDays } from '@/lib/format';
import { CustomerAvatar } from '@/components/CustomerAvatar';
import { cn } from '@/lib/utils';
import { Search, X, ScrollText, Inbox, Layers, Wallet, TrendingUp, CalendarClock, HandCoins, ShieldCheck, UserCheck, ChevronDown, ImageIcon } from 'lucide-react';
import {
  countPendingPaymentProofs,
  listPaymentProofs,
  pendingProofCountByLoanId,
  PAYMENT_PROOF_SUBMITTED_EVENT,
} from '@/features/customer-portal/paymentProofStore';
import { recoveryAgentNameByLoanId } from '@/features/recovery/agentLookup';
import { hasActiveRecoveryAgents } from '@/features/recovery/recoveryAutoAssign';
import { CustomerPortalProofsPanel } from '@/features/customer-portal/components/CustomerPortalProofsPanel';


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

/** Scheduled shortfall as of today — same dispatch as ledger KPIs / Loans overdue column. */
function overdueAmountFor(d: ReturnType<typeof useData>, l: Loan): number {
  const due = isDailyLoan(l.type) ? d.totalDueForDaily(l)
    : isMonthlyLike(l.type) ? d.totalDueForMonthly(l)
      : behavesInterestOnly(l) ? d.totalDueForInterestOnly(l)
        : 0;
  return Math.max(0, due);
}

/** Loan end date label — open-ended for interest-only; mirrors Loans register. */
function endDateLabelFor(l: Loan): string {
  if (isInterestOnly(l.type)) return 'Open-ended';
  if (isEmiLoan(l.type) && l.numDays) return fmtDate(addDays(l.loanDate, l.numDays * 30));
  if (isDailyLoan(l.type)) return fmtDate(loanEndDateFor(l));
  return '—';
}


export default function Collections() {
  const authUser = useSelector((s: RootState) => s.auth.user);
  const recovery = useRecovery();
  /** Demo recovery (assignments, queue, agent login) — works with API loans when agents exist in mockUsers. */
  const recoveryDemo = !config.useApi || hasActiveRecoveryAgents();
  const d = useData();
  const { canEdit } = usePermissions();
  const canCollect = canEdit('Collections');
  const isAdmin = authUser?.role === 'ADMIN';
  const pendingRecovery = recoveryDemo
    ? recovery.submissions.filter((s) => s.type === 'COLLECTION_CLAIM' && s.status === 'PENDING').length
    : 0;
  const [staffTab, setStaffTab] = useState<'portfolio' | 'recovery' | 'portal-proofs'>('portfolio');
  const [proofTick, setProofTick] = useState(0);
  const [typeFilter, setTypeFilter] = useState<LoanType | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [ledger, setLedger] = useState<Loan | null>(null);
  const [ledgerAutoAdd, setLedgerAutoAdd] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const openLedger = (loan: Loan) => {
    setLedgerAutoAdd(false);
    setLedger(loan);
  };
  const payNow = (loan: Loan) => {
    setLedgerAutoAdd(true);
    setLedger(loan);
  };
  const closeLedger = () => {
    setLedger(null);
    setLedgerAutoAdd(false);
  };



  // Collections is a loan-centric tracker: one row per active loan, of any type, with its live progress.
  // Individual payments are added/edited/deleted inside that loan's Ledger.
  // Search is how a collector reaches ONE loan to record against. It replaces
  // the old header "Add Collection" dialog, whose loan dropdown listed every
  // active loan — labelled by type and number only, with no borrower name — so
  // the wrong row was one mis-click away and the entry carried no context.
  // Finding the loan here and paying inside its ledger shows the schedule,
  // what is due, and what was already collected before any money is written.
  const loansToShow = useMemo(() => {
    const q = search.trim().toLowerCase();
    return d.loans.filter((l) => {
      if (l.status !== 'ACTIVE') return false;
      if (typeFilter !== 'ALL' && l.type !== typeFilter) return false;
      if (!q) return true;
      const who = d.customers.find((c) => c.id === l.customerId);
      return (
        l.loanNumber.toLowerCase().includes(q)
        || (who?.name ?? '').toLowerCase().includes(q)
        || (who?.mobile ?? '').includes(q)
        || (who?.code ?? '').toLowerCase().includes(q)
        || LOAN_LABELS[l.type].toLowerCase().includes(q)
      );
    });
  }, [d.loans, d.customers, typeFilter, search]);

  // Pagination. `loansToShow` is the FULL filtered set (the chip counts and the
  // empty state must keep reading it); `pageLoans` is the slice rendered by
  // both the mobile card list and the desktop tables, so the two never disagree
  // about which loans are on screen.
  const totalPages = Math.max(1, Math.ceil(loansToShow.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageLoans = loansToShow.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  // Any change to the result set returns to page 1 — a filter that shrinks the
  // list to 4 loans must not leave the collector staring at an empty page 3.
  useEffect(() => { setPage(1); }, [search, typeFilter, pageSize]);

  const refreshRecoveryQueue = useCallback(() => {
    if (recoveryDemo) recovery.refresh();
  }, [recoveryDemo, recovery]);

  useEffect(() => {
    refreshRecoveryQueue();
  }, [refreshRecoveryQueue]);

  useEffect(() => {
    const bump = () => setProofTick((n) => n + 1);
    window.addEventListener(PAYMENT_PROOF_SUBMITTED_EVENT, bump);
    return () => window.removeEventListener(PAYMENT_PROOF_SUBMITTED_EVENT, bump);
  }, []);

  const pendingPortalProofs = useMemo(() => countPendingPaymentProofs(), [proofTick]);
  const portalProofTotal = useMemo(() => listPaymentProofs().length, [proofTick]);
  const pendingProofsByLoan = useMemo(() => pendingProofCountByLoanId(), [proofTick]);
  const showRecoveryTab = recoveryDemo && isAdmin;

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

  if (authUser?.role === 'CUSTOMER') {
    return <Navigate to="/portal" replace />;
  }

  if (authUser?.role === 'RECOVERY_AGENT') {
    return <CollectionsAgentView />;
  }

  const recoveryAgentByLoan = useMemo(
    () => (recoveryDemo ? recoveryAgentNameByLoanId() : {}),
    [recoveryDemo, recovery.assignmentVersion],
  );

  return (
    <div className="flex min-h-full min-w-0 w-full flex-col">
      {/* Dark page header — shared chrome, matches Loans */}
      <PageHeader
        icon={<HandCoins size={20} />}
        title="Collections"
        subtitle={
          staffTab === 'recovery' && showRecoveryTab
            ? `${pendingRecovery} pending agent submission${pendingRecovery === 1 ? '' : 's'}`
            : staffTab === 'portal-proofs'
              ? `${portalProofTotal} submission${portalProofTotal === 1 ? '' : 's'}${pendingPortalProofs > 0 ? ` · ${pendingPortalProofs} pending review` : ''}`
              : `${d.collections.length} payments recorded · ${kpis.activeCount} active loans`
        }
      />

      <div className="flex min-w-0 w-full flex-1 flex-col gap-5 p-3.5 sm:px-5">
      {showRecoveryTab && pendingRecovery > 0 && staffTab === 'portfolio' && (
        <button
          type="button"
          onClick={() => setStaffTab('recovery')}
          className="anim-pop flex w-full items-center justify-between gap-3 rounded-xl border border-warning/35 bg-warning-50/90 px-4 py-3 text-left transition-colors hover:bg-warning-50 dark:border-warning/30 dark:bg-warning/10"
        >
          <span className="text-[13px] font-semibold text-ink">
            <ShieldCheck size={16} className="mr-2 inline text-warning" aria-hidden />
            {pendingRecovery} recovery payment{pendingRecovery === 1 ? '' : 's'} awaiting your approval
          </span>
          <span className="shrink-0 text-[12px] font-bold text-primary">Open queue →</span>
        </button>
      )}

      {pendingPortalProofs > 0 && staffTab === 'portfolio' && (
        <button
          type="button"
          onClick={() => setStaffTab('portal-proofs')}
          className="anim-pop flex w-full items-center justify-between gap-3 rounded-xl border border-violet-300/50 bg-violet-500/[.06] px-4 py-3 text-left transition-colors hover:bg-violet-500/[.09] dark:border-violet-500/25 dark:bg-violet-500/10"
        >
          <span className="text-[13px] font-semibold text-ink">
            <ImageIcon size={16} className="mr-2 inline text-violet-600 dark:text-violet-300" aria-hidden />
            {pendingPortalProofs} customer payment proof{pendingPortalProofs === 1 ? '' : 's'} to review
          </span>
          <span className="shrink-0 text-[12px] font-bold text-primary">Open proofs →</span>
        </button>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setStaffTab('portfolio')}
          className={cn(
            'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all',
            staffTab === 'portfolio'
              ? 'bg-gradient-to-r from-blue-700 to-blue-500 text-white shadow-[0_4px_14px_rgba(37,99,235,.35)]'
              : 'border border-slate-200/90 bg-surface text-muted dark:border-white/[.07]',
          )}
        >
          <HandCoins size={14} /> Portfolio
        </button>
        {showRecoveryTab && (
          <button
            type="button"
            onClick={() => setStaffTab('recovery')}
            className={cn(
              'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all',
              staffTab === 'recovery'
                ? 'bg-gradient-to-r from-emerald-700 to-teal-600 text-white shadow-[0_4px_14px_rgba(16,185,129,.35)]'
                : 'border border-slate-200/90 bg-surface text-muted dark:border-white/[.07]',
            )}
          >
            <ShieldCheck size={14} /> Recovery queue
            {pendingRecovery > 0 && (
              <span className="rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] font-bold">{pendingRecovery}</span>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => setStaffTab('portal-proofs')}
          className={cn(
            'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all',
            staffTab === 'portal-proofs'
              ? 'bg-gradient-to-r from-violet-700 to-indigo-600 text-white shadow-[0_4px_14px_rgba(109,40,217,.35)]'
              : 'border border-slate-200/90 bg-surface text-muted dark:border-white/[.07]',
          )}
        >
          <ImageIcon size={14} /> Portal proofs
          {pendingPortalProofs > 0 && (
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                staffTab === 'portal-proofs' ? 'bg-white/25' : 'bg-violet-500/15 text-violet-700 dark:text-violet-200',
              )}
            >
              {pendingPortalProofs}
            </span>
          )}
        </button>
      </div>

      {staffTab === 'recovery' && showRecoveryTab ? (
        <RecoveryQueuePanel />
      ) : staffTab === 'portal-proofs' ? (
        <CustomerPortalProofsPanel
          canReview={canCollect}
          onOpenLoan={(loanId) => {
            const loan = d.loans.find((l) => l.id === loanId);
            if (loan) openLedger(loan);
          }}
        />
      ) : (
        <>
      {/* KPI strip — real portfolio metrics */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 [&>*]:min-w-0">
        <StatCard label="Active loans" value={String(kpis.activeCount)} accent="#6366f1" icon={<Layers size={16} />} />
        <StatCard label="Collected today" value={inrShort(kpis.collectedToday)} accent="#10b981" icon={<TrendingUp size={16} />} />
        {kpis.dueNow > 0 ? (
          <StatCard label="Due now" value={inrShort(kpis.dueNow)} accent="#ef4444" icon={<CalendarClock size={16} />} active />
        ) : (
          <StatCard label="Due now" value={inrShort(kpis.dueNow)} accent="#f59e0b" icon={<CalendarClock size={16} />} />
        )}
        <StatCard label="Total outstanding" value={inr(kpis.outstanding)} accent="#8b5cf6" icon={<Wallet size={16} />} countUp={kpis.outstanding} />
      </div>

      {/* Find the loan to collect against. Recording a payment starts HERE:
          search → open that loan's ledger → add against the day it pays. */}
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customer, loan number, mobile…"
          aria-label="Search loans to record a collection against"
          className="h-11 w-full rounded-xl border-[0.5px] border-slate-200 bg-white pl-10 pr-10 text-sm text-ink outline-none transition-all placeholder:text-muted focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-white/[.08] dark:bg-surface"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-muted transition-colors hover:bg-slate-100 hover:text-ink dark:hover:bg-white/[.06]"
          >
            <X size={15} />
          </button>
        )}
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
        <EmptyState typed={typeFilter !== 'ALL'} searched={search} onClearSearch={() => setSearch('')} />
      ) : (
        <>
          <div className="grid grid-cols-1 items-start gap-3.5 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
            {loansToShow.map((l, idx) => (
              <CollectionCard
                key={l.id}
                loan={l}
                d={d}
                delay={Math.min(idx, 8) * 40}
                canCollect={canCollect}
                recoveryAgentName={recoveryAgentByLoan[l.id]}
                portalProofPending={pendingProofsByLoan[l.id] ?? 0}
                onOpenPortalProofs={() => setStaffTab('portal-proofs')}
                onView={() => openLedger(l)}
                onPayNow={() => payNow(l)}
              />
            ))}
          </div>
        </>
      )}

        </>
      )}

      </div>

      {/* Add / Edit dialog */}

      {ledger && staffTab !== 'recovery' && (
        <LedgerDialog loan={ledger} onClose={closeLedger} autoOpenAdd={ledgerAutoAdd} />
      )}
    </div>
  );
}

/** Premium collection card — all former table columns, every breakpoint. */
function CollectionCard({
  loan,
  d,
  onView,
  onPayNow,
  canCollect,
  recoveryAgentName,
  portalProofPending = 0,
  onOpenPortalProofs,
  delay = 0,
}: {
  loan: Loan;
  d: ReturnType<typeof useData>;
  onView: () => void;
  onPayNow: () => void;
  canCollect: boolean;
  recoveryAgentName?: string;
  portalProofPending?: number;
  onOpenPortalProofs?: () => void;
  delay?: number;
}) {
  const cust = d.customers.find((c) => c.id === loan.customerId);
  const collected = d.collectedFor(loan.id);
  const outstanding = d.outstandingFor(loan);
  const overdueAmt = overdueAmountFor(d, loan);
  const endLabel = endDateLabelFor(loan);
  const nd = d.nextDueFor(loan);
  const today = todayISO();
  const scheduleOverdue = !!nd && nd < today;
  const dueToday = !!nd && nd === today;
  const hasTerm = isDailyLoan(loan.type) || loan.type === 'FLEXIBLE';
  const paid = isDailyLoan(loan.type)
    ? paidDaysFor(loan, collected)
    : d.collections.filter((c) => c.loanId === loan.id).length;
  const total = totalDaysFor(loan);
  const per = loan.type === 'FLEXIBLE' ? '' : isDailyLoan(loan.type) || loan.type === 'DAILY_INTEREST' ? '/day' : '/mo';
  const showPayNow = canCollect && loan.status === 'ACTIVE' && !!nd;
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <article
      className={cn(
        'anim-pop group relative flex w-full flex-col self-start overflow-hidden rounded-[20px] border bg-surface shadow-[0_1px_0_rgba(255,255,255,.6)_inset,0_12px_40px_-18px_rgba(15,23,42,.12)] transition-[transform,box-shadow] duration-300 dark:shadow-[0_1px_0_rgba(255,255,255,.04)_inset,0_20px_48px_-24px_rgba(0,0,0,.55)]',
        'hover:-translate-y-1 hover:shadow-[0_1px_0_rgba(255,255,255,.6)_inset,0_22px_50px_-20px_rgba(5,56,204,.22)] dark:hover:shadow-[0_1px_0_rgba(255,255,255,.04)_inset,0_24px_56px_-22px_rgba(0,0,0,.65)]',
        scheduleOverdue
          ? 'border-danger/30 dark:border-danger/25'
          : 'border-slate-200/90 dark:border-white/[.09]',
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b opacity-80',
          scheduleOverdue
            ? 'from-danger/[.06] to-transparent dark:from-danger/[.08]'
            : 'from-primary/[.05] to-transparent dark:from-primary/[.07]',
        )}
      />

      <div className="relative flex items-start gap-3 px-4 pb-2 pt-4 sm:px-5 sm:pt-5">
        <button
          type="button"
          onClick={onView}
          aria-label={`Open collection ledger for ${cust?.name ?? 'customer'} · ${loan.loanNumber}`}
          className="flex min-w-0 flex-1 touch-manipulation items-start gap-3 text-left transition-colors sm:gap-4"
        >
          <CustomerAvatar
            customerId={cust?.id}
            name={cust?.name ?? '—'}
            className="h-11 w-11 shrink-0 rounded-2xl shadow-[0_8px_20px_-8px_rgba(5,56,204,.55)] ring-2 ring-white/20 dark:ring-white/10 sm:h-12 sm:w-12"
            fallbackStyle={{
              background: 'linear-gradient(to bottom right, #022999, #0538cc, #0AA8F8)',
              color: '#fff',
            }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2 pr-1">
              <h3 className="truncate text-[15px] font-bold tracking-tight text-ink group-hover:text-primary sm:text-[16px]">
                {cust?.name ?? '—'}
              </h3>
              <Badge tone="info" className="shrink-0 shadow-sm">{LOAN_LABELS[loan.type]}</Badge>
            </div>
            <p className="mt-0.5 font-mono text-[11px] font-semibold text-muted">{loan.loanNumber}</p>
            {recoveryAgentName && (
              <p className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200 sm:mt-2 sm:px-2.5 sm:py-1 sm:text-[11px]">
                <UserCheck size={12} className="shrink-0" aria-hidden />
                <span className="truncate">Recovery · {recoveryAgentName}</span>
              </p>
            )}
            {portalProofPending > 0 && onOpenPortalProofs && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenPortalProofs();
                }}
                className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full bg-violet-500/12 px-2 py-0.5 text-[10px] font-semibold text-violet-800 ring-1 ring-violet-400/25 transition-colors hover:bg-violet-500/20 dark:text-violet-200 sm:mt-2 sm:px-2.5 sm:py-1 sm:text-[11px]"
              >
                <ImageIcon size={12} className="shrink-0" aria-hidden />
                <span className="truncate">
                  Portal proof · {portalProofPending} pending
                </span>
              </button>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
              {nd ? (
                <>
                  <span
                    className={cn(
                      'tabular-nums',
                      scheduleOverdue && 'font-semibold text-danger',
                      dueToday && 'font-semibold text-warning-600 dark:text-warning',
                    )}
                  >
                    {scheduleOverdue && (
                      <span className="mr-1 text-[10px] font-bold uppercase tracking-wide text-danger/80">Due since </span>
                    )}
                    {fmtDate(nd)}
                  </span>
                  {scheduleOverdue ? <Badge tone="err">Overdue</Badge> : dueToday ? <Badge tone="warn">Today</Badge> : null}
                </>
              ) : (
                <span className="text-muted">Fully collected</span>
              )}
            </div>
            {!detailsOpen && (
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-muted">
                <span>
                  Paid{' '}
                  <span className="font-semibold tabular-nums text-success">{inr(collected)}</span>
                </span>
                <span>
                  Outstanding{' '}
                  <span className="font-semibold tabular-nums text-ink">{inr(outstanding)}</span>
                </span>
                {overdueAmt > 0 && (
                  <span>
                    Due now{' '}
                    <span className="font-semibold tabular-nums text-danger">{inr(overdueAmt)}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </button>
        <button
          type="button"
          onClick={() => setDetailsOpen((o) => !o)}
          aria-expanded={detailsOpen}
          aria-label={detailsOpen ? 'Collapse loan details' : 'Expand loan details'}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200/80 bg-surface/90 text-muted transition-colors hover:border-primary/30 hover:bg-primary/[.04] hover:text-primary dark:border-white/[.08] dark:hover:bg-white/[.04]"
        >
          <ChevronDown
            size={18}
            className={cn('transition-transform duration-200', detailsOpen && 'rotate-180')}
            aria-hidden
          />
        </button>
      </div>

      {detailsOpen && (
        <>
          {hasTerm && (
            <div className="relative border-y border-slate-100/80 px-5 py-3 dark:border-white/[.06]">
              <CollectionProgress compact paid={paid} total={total} />
            </div>
          )}

          <div className="relative mx-4 mt-1 rounded-2xl border border-slate-200/60 bg-gradient-to-br from-slate-50/90 via-surface to-slate-50/50 px-4 py-3.5 dark:border-white/[.08] dark:from-white/[.04] dark:via-surface dark:to-white/[.02] sm:py-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">Amount paid</p>
                <p className="mt-1 font-display text-[26px] font-bold leading-none tracking-tight tabular-nums text-success sm:text-[30px]">
                  {inr(collected)}
                </p>
              </div>
              {overdueAmt > 0 && (
                <div className="rounded-xl border border-danger/20 bg-danger/[.06] px-3 py-2 text-right dark:bg-danger/[.08]">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-danger/80">Due now</p>
                  <p className="mt-0.5 text-[15px] font-bold tabular-nums text-danger">{inr(overdueAmt)}</p>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 px-4 py-3 sm:grid-cols-3 sm:gap-2.5 sm:py-4">
            <CollStatCell label="Loan date" value={fmtDate(loan.loanDate)} variant="date" />
            <CollStatCell label="End date" value={endLabel} variant="date" />
            <CollStatCell label="Next due" value={nd ? fmtDate(nd) : '—'} variant="date" emphasize={!!nd} />
            <CollStatCell label="Outstanding" value={inr(outstanding)} variant="money" emphasize={outstanding > 0} />
            <CollStatCell
              label="Instalment"
              value={loan.dailyAmount ? inr(loan.dailyAmount) : '—'}
              hint={loan.dailyAmount ? per : undefined}
              variant="money"
            />
            <CollStatCell
              label="Overdue"
              value={overdueAmt > 0 ? inr(overdueAmt) : '—'}
              variant="money"
              tone={overdueAmt > 0 ? 'danger' : undefined}
            />
          </div>
        </>
      )}

      <div
        className={cn(
          'grid min-w-0 border-t border-slate-100 dark:border-white/[.06]',
          showPayNow ? 'grid-cols-2' : 'grid-cols-1',
        )}
      >
        <button
          type="button"
          onClick={onView}
          className="flex w-full min-w-0 touch-manipulation flex-row items-center justify-center gap-1 px-1 py-3 text-[10.5px] font-semibold text-primary transition-colors hover:bg-primary/[.05] active:bg-primary/[.09] sm:text-[13px]"
        >
          <ScrollText size={15} className="shrink-0" /> <span className="truncate">View Report</span>
        </button>
        {showPayNow ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPayNow();
            }}
            className={cn(
              'flex w-full min-w-0 touch-manipulation flex-row items-center justify-center gap-1 border-l border-slate-100 px-1 py-3 text-[10.5px] font-semibold transition-colors sm:text-[13px] dark:border-white/[.06]',
              overdueAmt > 0
                ? 'bg-success/[.06] text-success hover:bg-success/[.12]'
                : 'text-success hover:bg-success/[.06]',
            )}
          >
            <HandCoins size={15} className="shrink-0" /> <span className="truncate">Pay</span>
          </button>
        ) : null}
      </div>
    </article>
  );
}

function CollStatCell({
  label,
  value,
  hint,
  tone,
  emphasize,
  variant = 'money',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'danger';
  emphasize?: boolean;
  variant?: 'date' | 'money';
}) {
  const isDate = variant === 'date';
  return (
    <div
      className={cn(
        'flex min-h-[4.75rem] flex-col justify-center rounded-xl border border-slate-200/50 bg-surface/80 px-3 py-2.5 shadow-[0_1px_0_rgba(255,255,255,.5)_inset] backdrop-blur-[2px] dark:border-white/[.08] dark:bg-white/[.03] dark:shadow-none',
        tone === 'danger' && 'border-danger/25 bg-danger/[.05] dark:border-danger/30 dark:bg-danger/[.07]',
      )}
    >
      <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-muted">{label}</span>
      <span
        className={cn(
          'mt-1.5 font-display font-bold leading-snug',
          isDate ? 'text-[11px] whitespace-normal break-words sm:text-[12px]' : 'text-[13px] tabular-nums sm:text-[14px]',
          tone === 'danger' && 'text-danger',
          emphasize && !tone && 'text-primary',
          !tone && !emphasize && 'text-ink',
        )}
      >
        {value}
      </span>
      {hint ? <span className="mt-0.5 text-[10px] font-semibold leading-none text-muted">{hint}</span> : null}
    </div>
  );
}

function EmptyState({ typed, searched, onClearSearch }: { typed: boolean; searched: string; onClearSearch: () => void }) {
  // Three distinct empty states — a search that found nothing is not the same
  // as having no loans at all, and offering "record your first collection"
  // when the book is full but the query missed would just be confusing.
  const noMatch = searched.trim().length > 0;
  return (
    <div className="anim-pop flex flex-col items-center gap-3 rounded-card border border-slate-200/90 bg-white px-6 py-16 text-center shadow-card dark:border-white/[.07] dark:bg-surface">
      <div className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-primary-400 to-primary text-white shadow-soft anim-float">
        {noMatch ? <Search size={28} /> : <Inbox size={30} />}
      </div>
      <div className="font-display text-lg font-bold">
        {noMatch ? 'No matching loans' : 'No collections yet'}
      </div>
      <p className="max-w-sm text-sm text-muted">
        {noMatch
          ? <>Nothing matches “<span className="font-medium text-ink">{searched}</span>”. Try a customer name, loan number, or mobile.</>
          : typed ? 'No active loans of this type yet.'
          : 'Open a loan below to record a payment against its ledger.'}
      </p>
      {noMatch && <Button variant="ghost" onClick={onClearSearch}>Clear search</Button>}
    </div>
  );
}
