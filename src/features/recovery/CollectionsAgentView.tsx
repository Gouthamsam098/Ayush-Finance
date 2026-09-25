import { useCallback, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '@/store';
import { useData, type Loan } from '@/mock/DataContext';
import { recoveryDueNow } from './recoveryDue';
import { useRecovery } from './RecoveryContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/stat-card';
import { inrShort, todayISO } from '@/lib/format';
import { cn } from '@/lib/utils';
import { HandCoins, Search, X, CalendarClock, AlertCircle, Clock, Layers } from 'lucide-react';
import { RecoveryAssignmentCard } from './components/RecoveryAssignmentCard';
import { ReportCollectionDialog } from './components/ReportCollectionDialog';
import { PromiseToPayDialog } from './components/PromiseToPayDialog';
import { useToast } from '@/components/ui/toast';
import { latestCollectionClaimForAgent, latestOpenPromiseForLoan } from './recoveryStore';
import type { CollectionClaimSubmission, PromiseSubmission } from './types';
import { LedgerDialog } from '@/components/LedgerDialog';

type AgentListFilter = 'all' | 'pending';

export function CollectionsAgentView() {
  const user = useSelector((s: RootState) => s.auth.user)!;
  const d = useData();
  const recovery = useRecovery();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [payLoan, setPayLoan] = useState<Loan | null>(null);
  const [ptpLoan, setPtpLoan] = useState<Loan | null>(null);
  const [statementLoan, setStatementLoan] = useState<Loan | null>(null);
  const [listFilter, setListFilter] = useState<AgentListFilter>('all');
  const [editPending, setEditPending] = useState<{ loan: Loan; claim: CollectionClaimSubmission } | null>(null);

  const assignedIds = useMemo(() => recovery.getAssignments(user.id), [recovery, user.id]);

  const loanHasPendingClaim = useCallback((loanId: number) => (
    recovery.submissions.some(
      (s) => s.agentUserId === user.id && s.loanId === loanId && s.type === 'COLLECTION_CLAIM' && s.status === 'PENDING',
    )
  ), [recovery.submissions, user.id]);

  const loans = useMemo(() => {
    const q = search.trim().toLowerCase();
    return d.loans.filter((l) => {
      if (!assignedIds.includes(l.id) || l.status !== 'ACTIVE') return false;
      if (listFilter === 'pending' && !loanHasPendingClaim(l.id)) return false;
      if (!q) return true;
      const c = d.customers.find((x) => x.id === l.customerId);
      return (
        l.loanNumber.toLowerCase().includes(q)
        || (c?.name ?? '').toLowerCase().includes(q)
        || (c?.mobile ?? '').includes(q)
        || (c?.code ?? '').toLowerCase().includes(q)
        || (c?.city ?? '').toLowerCase().includes(q)
      );
    });
  }, [d.loans, d.customers, assignedIds, search, listFilter, loanHasPendingClaim]);

  const kpis = useMemo(() => {
    const assigned = d.loans.filter((l) => assignedIds.includes(l.id) && l.status === 'ACTIVE');
    const overdue = assigned.filter((l) => recoveryDueNow(d, l) > 0);
    const pending = recovery.submissions.filter((s) => s.agentUserId === user.id && s.type === 'COLLECTION_CLAIM' && s.status === 'PENDING').length;
    return {
      assigned: assigned.length,
      overdueCount: overdue.length,
      overdueAmt: overdue.reduce((s, l) => s + recoveryDueNow(d, l), 0),
      pending,
    };
  }, [d, assignedIds, recovery.submissions, user.id]);

  const submitClaim = async (loan: Loan, payload: { amount: number; mode: import('@/mock/DataContext').PayMode; receiptDate: string; note: string }) => {
    const c = d.customers.find((x) => x.id === loan.customerId);
    const err = recovery.submitCollectionClaim({
      agentUserId: user.id,
      agentName: user.fullName || user.username,
      loanId: loan.id,
      customerName: c?.name ?? '—',
      loanNumber: loan.loanNumber,
      ...payload,
    });
    if (err) return err;
    toast('Submitted for admin approval', 'success');
    return null;
  };

  return (
    <div className="flex min-h-full min-w-0 w-full flex-col">
      <PageHeader
        icon={<HandCoins size={20} />}
        title="My collections"
        subtitle={`${kpis.assigned} assigned · field recovery`}
      />

      <div className="flex min-w-0 w-full flex-1 flex-col gap-4 px-safe pb-safe pt-1 sm:gap-5 sm:px-5 md:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-2 sm:gap-2.5 md:grid-cols-4 [&>*]:min-w-0">
          <StatCard
            label="Assigned"
            value={String(kpis.assigned)}
            accent="#6366f1"
            icon={<HandCoins size={16} />}
            onClick={() => setListFilter('all')}
            active={listFilter === 'all'}
          />
          <StatCard label="Overdue" value={String(kpis.overdueCount)} accent="#ef4444" icon={<AlertCircle size={16} />} active={kpis.overdueCount > 0} />
          <StatCard label="Due amount" value={inrShort(kpis.overdueAmt)} accent="#f59e0b" icon={<CalendarClock size={16} />} />
          <StatCard
            label="Pending approval"
            value={String(kpis.pending)}
            accent="#8b5cf6"
            icon={<Clock size={16} />}
            active={listFilter === 'pending'}
            onClick={() => setListFilter('pending')}
          />
        </div>

        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:overflow-visible sm:pb-0">
          <button
            type="button"
            onClick={() => setListFilter('all')}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all min-h-11',
              listFilter === 'all'
                ? 'bg-gradient-to-r from-blue-700 to-blue-500 text-white shadow-[0_4px_14px_rgba(37,99,235,.35)]'
                : 'border border-slate-200/90 bg-surface text-muted dark:border-white/[.07]',
            )}
          >
            <Layers size={14} /> All assignments
          </button>
          <button
            type="button"
            onClick={() => setListFilter('pending')}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all min-h-11',
              listFilter === 'pending'
                ? 'bg-gradient-to-r from-violet-700 to-purple-500 text-white shadow-[0_4px_14px_rgba(139,92,246,.35)]'
                : 'border border-slate-200/90 bg-surface text-muted dark:border-white/[.07]',
            )}
          >
            <Clock size={14} /> Pending approval
            {kpis.pending > 0 && (
              <span className="rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] font-bold">{kpis.pending}</span>
            )}
          </button>
        </div>

        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your assignments…"
            className="h-12 w-full min-w-0 rounded-xl border border-slate-200 bg-surface pl-10 pr-10 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-white/[.08] sm:h-11 sm:text-sm"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">
              <X size={15} />
            </button>
          )}
        </div>

        {assignedIds.length === 0 ? (
          <div className="rounded-card border border-slate-200/90 bg-surface px-6 py-16 text-center shadow-card dark:border-white/[.07]">
            <p className="font-display text-lg font-bold text-ink">No loans assigned yet</p>
            <p className="mt-2 text-[13px] text-muted">Ask an admin to assign accounts to you in Settings.</p>
          </div>
        ) : loans.length === 0 ? (
          <div className="rounded-card border border-slate-200/90 bg-surface px-6 py-16 text-center shadow-card dark:border-white/[.07]">
            <p className="font-display text-lg font-bold text-ink">
              {listFilter === 'pending' ? 'No pending submissions' : 'No matches'}
            </p>
            <p className="mt-2 text-[13px] text-muted">
              {listFilter === 'pending'
                ? 'Payments you send with Paid will appear here until admin approves.'
                : 'Try another search term.'}
            </p>
            {listFilter === 'pending' && (
              <button type="button" onClick={() => setListFilter('all')} className="mt-4 text-[13px] font-semibold text-primary hover:underline">
                View all assignments
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 md:gap-5 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {loans.map((l, i) => {
              const cust = d.customers.find((c) => c.id === l.customerId);
              const due = recoveryDueNow(d, l);
              const claim = latestCollectionClaimForAgent(l.id, user.id, recovery.submissions) as CollectionClaimSubmission | undefined;
              const ptp = latestOpenPromiseForLoan(l.id, user.id, recovery.submissions) as PromiseSubmission | undefined;
              const nd = d.nextDueFor(l);
              const today = todayISO();
              const scheduleOverdue = !!nd && nd < today;
              return (
                <RecoveryAssignmentCard
                  key={l.id}
                  loan={l}
                  cust={cust}
                  agentName={user.fullName || user.username}
                  due={due}
                  claim={claim}
                  ptp={ptp}
                  nd={nd}
                  scheduleOverdue={scheduleOverdue}
                  animationDelay={Math.min(i, 6) * 50}
                  onPay={() => setPayLoan(l)}
                  onPromise={() => setPtpLoan(l)}
                  onStatement={() => setStatementLoan(l)}
                  onEditPending={
                    claim?.status === 'PENDING'
                      ? () => setEditPending({ loan: l, claim })
                      : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      {payLoan && (
        <ReportCollectionDialog
          open
          onClose={() => setPayLoan(null)}
          loan={payLoan}
          customerName={d.customers.find((c) => c.id === payLoan.customerId)?.name ?? '—'}
          dueHint={recoveryDueNow(d, payLoan)}
          onSubmit={(p) => submitClaim(payLoan, p)}
        />
      )}
      {editPending && (
        <ReportCollectionDialog
          open
          variant="edit"
          onClose={() => setEditPending(null)}
          loan={editPending.loan}
          customerName={d.customers.find((c) => c.id === editPending.loan.customerId)?.name ?? '—'}
          dueHint={recoveryDueNow(d, editPending.loan)}
          initial={{
            amount: editPending.claim.amount,
            mode: editPending.claim.mode,
            receiptDate: editPending.claim.receiptDate,
            note: editPending.claim.note,
          }}
          onSubmit={async (p) => {
            const err = recovery.updatePendingCollectionClaim(editPending.claim.id, user.id, p);
            if (err) return err;
            toast('Pending submission updated', 'success');
            return null;
          }}
        />
      )}
      {statementLoan && (
        <LedgerDialog
          loan={statementLoan}
          onClose={() => setStatementLoan(null)}
          statementOnly
        />
      )}
      {ptpLoan && (
        <PromiseToPayDialog
          open
          onClose={() => setPtpLoan(null)}
          loan={ptpLoan}
          customerName={d.customers.find((c) => c.id === ptpLoan.customerId)?.name ?? '—'}
          onSubmit={(p) => {
            const c = d.customers.find((x) => x.id === ptpLoan.customerId);
            recovery.submitPromise({
              agentUserId: user.id,
              agentName: user.fullName || user.username,
              loanId: ptpLoan.id,
              customerName: c?.name ?? '—',
              loanNumber: ptpLoan.loanNumber,
              ...p,
            });
            toast('Promise date saved', 'success');
          }}
        />
      )}
    </div>
  );
}
