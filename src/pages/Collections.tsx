import { useMemo, useState, type ReactNode } from 'react';
import { useData, LOAN_LABELS, isDailyLoan, isMonthlyLike, isInterestOnly, behavesInterestOnly, type LoanType, type Loan } from '@/mock/DataContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/ui/stat-card';
import { PageHeader } from '@/components/layout/PageHeader';
import { LedgerDialog } from '@/components/LedgerDialog';
import { CollectionProgress } from '@/components/CollectionProgress';
import { inr, inrShort, fmtDate, todayISO, isoLocal, initials, DAILY_TERM } from '@/lib/format';
import { Search, X, ScrollText, Inbox, Layers, Wallet, TrendingUp, CalendarClock, HandCoins, ChevronRight } from 'lucide-react';


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


export default function Collections() {
  const d = useData();
  const [typeFilter, setTypeFilter] = useState<LoanType | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [ledger, setLedger] = useState<Loan | null>(null);



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







  return (
    <div className="flex min-h-full flex-col">
      {/* Dark page header — shared chrome, matches Loans */}
      <PageHeader
        icon={<HandCoins size={20} />}
        title="Collections"
        subtitle={`${d.collections.length} payments recorded · ${kpis.activeCount} active loans`}
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
        <TableCard note="Total Due Amount is the cumulative shortfall from what's owed by today. Balance is Principal − Collected. Click a row to add, edit, or delete individual payments.">
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
                <Row key={l.id} onOpen={() => setLedger(l)} label={`Open collection ledger for ${cust?.name ?? 'customer'} · ${l.loanNumber}`}>
                  <NameTd name={cust?.name ?? '—'} onOpen={() => setLedger(l)} />
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
        <TableCard note="Total Due Amount is the cumulative shortfall vs. the instalments owed by today (30-day cycles). Click a row to add, edit, or delete individual payments.">
          <thead><HeaderRow cols={['Customer', 'Principal', 'Monthly Instalment', 'Total Due', 'Loan Type', 'Amount Paid', 'Loan Date', 'Actions']} /></thead>
          <tbody>
            {loansToShow.map((l) => {
              const cust = d.customers.find((c) => c.id === l.customerId);
              const totalDue = d.totalDueForMonthly(l);
              return (
                <Row key={l.id} onOpen={() => setLedger(l)} label={`Open collection ledger for ${cust?.name ?? 'customer'} · ${l.loanNumber}`}>
                  <NameTd name={cust?.name ?? '—'} onOpen={() => setLedger(l)} />
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
                <Row key={l.id} onOpen={() => setLedger(l)} label={`Open collection ledger for ${cust?.name ?? 'customer'} · ${l.loanNumber}`}>
                  <NameTd name={cust?.name ?? '—'} onOpen={() => setLedger(l)} />
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
              collections worklist is NEXT DUE: oldest unpaid slot via
              d.nextDueFor (matches Ledger). When that date is past we label
              it "Due since" so it isn't read as an upcoming due. ── */
        <TableCard note="Amount Paid is the total collected so far for each loan. Click a row to add, edit, or delete individual payments.">
          <thead><HeaderRow cols={['Customer', 'Next Due', 'Loan Type', 'Amount Paid', 'Loan Date', 'Actions']} /></thead>
          <tbody>
            {loansToShow.map((l) => {
              const cust = d.customers.find((c) => c.id === l.customerId);
              const nd = d.nextDueFor(l);
              const today = todayISO();
              const overdue = !!nd && nd < today;
              const dueToday = !!nd && nd === today;
              return (
                <Row key={l.id} onOpen={() => setLedger(l)} label={`Open collection ledger for ${cust?.name ?? 'customer'} · ${l.loanNumber}`}>
                  <NameTd name={cust?.name ?? '—'} onOpen={() => setLedger(l)} />
                  <Td>
                    {nd ? (
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <span className={overdue ? 'font-semibold text-danger' : dueToday ? 'font-semibold text-warning-600 dark:text-warning' : ''}>
                          {overdue && <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-danger/80">Due since</span>}
                          {fmtDate(nd)}
                        </span>
                        {overdue ? <Badge tone="err">Overdue</Badge> : dueToday ? <Badge tone="warn">Today</Badge> : null}
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

/** A loan row. When `onOpen` is given the WHOLE row opens the ledger — clicking
 *  the customer/loan is the natural way to record a collection, and hunting for
 *  the small "View Report" button every time was needless friction. The button
 *  stays for discoverability; the action cell stops row clicks so its own
 *  handler is never double-fired. */
function Row({ children, onOpen, label }: { children: ReactNode; onOpen?: () => void; label?: string }) {
  return (
    <tr
      {...(onOpen ? {
        onClick: onOpen,
        onKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
        },
        tabIndex: 0,
        role: 'button' as const,
        'aria-label': label ?? 'Open collection ledger',
      } : {})}
      className={`group border-t border-slate-100 transition-colors hover:bg-primary-50/40 dark:border-white/[.06] dark:hover:bg-primary/[.06] ${
        onOpen ? 'cursor-pointer focus:outline-none focus-visible:bg-primary-50/60 dark:focus-visible:bg-primary/[.1]' : ''
      }`}
    >
      {children}
    </tr>
  );
}

function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`whitespace-nowrap px-5 py-4 ${className}`}>{children}</td>;
}

/** The customer cell of a clickable row — styled as the primary affordance so
 *  it is visibly the thing to click. Uses a real <button> so taps register on
 *  mobile Safari (clicks on <tr> alone are unreliable on iOS). */
function NameTd({ name, onOpen }: { name: string; onOpen?: () => void }) {
  return (
    <td className="whitespace-nowrap px-5 py-4">
      {onOpen ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="touch-manipulation font-semibold text-primary underline-offset-2 hover:underline active:underline"
        >
          {name}
        </button>
      ) : (
        <span className="font-semibold text-primary underline-offset-2 group-hover:underline">{name}</span>
      )}
    </td>
  );
}

function ActionTd({ onView }: { onView: () => void }) {
  return (
    // stopPropagation: the row itself is clickable, so without this the ledger
    // would be opened twice (harmless today, but a latent double-action bug).
    <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
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
      {/* Header — customer name opens the ledger (same as desktop NameTd) */}
      <button
        type="button"
        onClick={onView}
        aria-label={`Open collection ledger for ${cust?.name ?? 'customer'} · ${loan.loanNumber}`}
        className="flex w-full touch-manipulation items-center gap-3 px-4 pt-4 text-left transition-colors hover:bg-primary/[.04] active:bg-primary/[.07]"
      >
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-700 to-blue-500 text-sm font-bold text-white shadow-sm">
          {initials(cust?.name ?? '—')}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-primary underline-offset-2 active:underline">{cust?.name ?? '—'}</div>
          <div className="mt-0.5 font-mono text-xs text-muted">{loan.loanNumber}</div>
        </div>
        <Badge tone="info">{LOAN_LABELS[loan.type]}</Badge>
      </button>

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
        type="button"
        onClick={onView}
        className="flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 border-t border-slate-100 py-3.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/[.05] active:bg-primary/[.09] dark:border-white/[.06]"
      >
        <ScrollText size={16} /> View Report <ChevronRight size={15} className="opacity-60" />
      </button>
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
