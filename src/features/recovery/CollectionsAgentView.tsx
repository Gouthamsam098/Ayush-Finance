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
import { HandCoins, Search, X, CalendarClock, AlertCircle, Clock, Layers, ScrollText } from 'lucide-react';
import { AgentActivityPanel } from './components/AgentActivityPanel';
import { recordAgentActivity } from '@/lib/recoveryAgentActivity';
import { RecoveryAssignmentCard } from './components/RecoveryAssignmentCard';
import { ReportCollectionDialog, type CollectionClaimSubmitPayload } from './components/ReportCollectionDialog';
import { submitPaymentProof } from '@/features/customer-portal/paymentProofStore';
import { enrichCollectionClaim } from '@/lib/recoveryClaimUpi';
import { PromiseToPayDialog } from './components/PromiseToPayDialog';
import { useToast } from '@/components/ui/toast';
import { latestCollectionClaimForAgent, latestOpenPromiseForLoan, openPromisesForAgent } from './recoveryStore';
import type { CollectionClaimSubmission, PromiseSubmission } from './types';
import { LedgerDialog } from '@/components/LedgerDialog';
import { AgentPtpPanel } from './components/AgentPtpPanel';
import { classifyPtpTiming, type PtpTiming } from '@/lib/recoveryPtp';

type AgentListFilter = 'all' | 'pending' | 'ptp' | 'history';
type PtpSubFilter = 'ALL' | PtpTiming;

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
  const [ptpSubFilter, setPtpSubFilter] = useState<PtpSubFilter>('ALL');
  const [editPending, setEditPending] = useState<{ loan: Loan; claim: CollectionClaimSubmission } | null>(null);
  const editInitial = useMemo(() => {
    if (!editPending) return undefined;
    const claim = enrichCollectionClaim(editPending.claim);
    return {
      amount: claim.amount,
      mode: claim.mode,
      receiptDate: claim.receiptDate,
      note: claim.note,
      payeeVpa: claim.payeeVpa,
      payeeName: claim.payeeName,
    };
  }, [editPending]);

  const assignedIds = useMemo(() => recovery.getAssignments(user.id), [recovery, user.id]);

  const openPromises = useMemo(
    () => openPromisesForAgent(user.id, recovery.submissions),
    [user.id, recovery.submissions],
  );

  const ptpTodayCount = useMemo(
    () => openPromises.filter((p) => classifyPtpTiming(p.promiseDate) === 'TODAY').length,
    [openPromises],
  );

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
      ptpToday: ptpTodayCount,
      ptpOpen: openPromises.length,
    };
  }, [d, assignedIds, recovery.submissions, user.id, ptpTodayCount, openPromises.length]);

  const submitClaim = async (loan: Loan, payload: CollectionClaimSubmitPayload) => {
    const { proofFile, ...claimPayload } = payload;
    const c = d.customers.find((x) => x.id === loan.customerId);
    const err = await recovery.submitCollectionClaim({
      agentUserId: user.id,
      agentName: user.fullName || user.username,
      loanId: loan.id,
      customerName: c?.name ?? '—',
      loanNumber: loan.loanNumber,
      ...claimPayload,
    });
    if (err) return err;
    if (proofFile && claimPayload.mode === 'UPI') {
      const proofErr = await submitPaymentProof({
        customerId: loan.customerId,
        loanId: loan.id,
        loanNumber: loan.loanNumber,
        fileName: proofFile.fileName,
        mimeType: proofFile.mimeType,
        dataUrl: proofFile.dataUrl,
        amountRupees: claimPayload.amount,
        purpose: 'CUSTOM',
        recoveryAgentName: user.fullName || user.username,
        submittedByName: user.fullName || user.username,
        submittedByRole: user.role,
      });
      if (proofErr) {
        return `Collection submitted, but screenshot failed: ${proofErr}. Open loan details to upload again.`;
      }
      recordAgentActivity({
        agentUserId: user.id,
        at: new Date().toISOString(),
        kind: 'PROOF_UPLOADED',
        loanId: loan.id,
        loanNumber: loan.loanNumber,
        customerName: c?.name ?? '—',
        title: 'Screenshot submitted',
        detail: `With Collect · ${claimPayload.mode}`,
        amountRupees: claimPayload.amount,
      });
    }
    toast('Submitted for admin approval', 'success');
    return null;
  };

  const collectForLoanId = (loanId: number) => {
    const loan = d.loans.find((l) => l.id === loanId);
    if (loan) setPayLoan(loan);
  };

  const closePtp = async (id: string, status: 'FULFILLED' | 'CANCELLED') => {
    const err = await recovery.closePromiseToPay(id, user.id, status);
    if (err) {
      toast(err, 'error');
      return;
    }
    toast(status === 'FULFILLED' ? 'Promise marked fulfilled' : 'Promise cancelled', 'success');
  };

  return (
    <div className="flex min-h-full min-w-0 w-full flex-col">
      <PageHeader
        icon={<HandCoins size={20} />}
        title="My collections"
        subtitle={`${kpis.assigned} assigned · field recovery`}
      />

      <div className="flex min-w-0 w-full flex-1 flex-col gap-4 px-safe pb-safe pt-1 sm:gap-5 sm:px-5 md:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-2 sm:gap-2.5 md:grid-cols-4 lg:grid-cols-5 [&>*]:min-w-0">
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
          <StatCard
            label="PTP today"
            value={String(kpis.ptpToday)}
            accent="#d97706"
            icon={<CalendarClock size={16} />}
            active={listFilter === 'ptp' && ptpSubFilter === 'TODAY'}
            onClick={() => {
              setListFilter('ptp');
              setPtpSubFilter('TODAY');
            }}
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
          <button
            type="button"
            onClick={() => { setListFilter('ptp'); setPtpSubFilter('ALL'); }}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all min-h-11',
              listFilter === 'ptp'
                ? 'bg-gradient-to-r from-[#022999] to-violet-600 text-white shadow-[0_4px_14px_rgba(79,70,229,.35)]'
                : 'border border-slate-200/90 bg-surface text-muted dark:border-white/[.07]',
            )}
          >
            <CalendarClock size={14} /> Promise to pay
            {kpis.ptpOpen > 0 && (
              <span className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                listFilter === 'ptp' ? 'bg-white/25' : 'bg-violet-500/15 text-violet-700 dark:text-violet-200',
              )}>
                {kpis.ptpOpen}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setListFilter('history')}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-all min-h-11',
              listFilter === 'history'
                ? 'bg-gradient-to-r from-slate-700 to-slate-500 text-white shadow-[0_4px_14px_rgba(71,85,105,.35)]'
                : 'border border-slate-200/90 bg-surface text-muted dark:border-white/[.07]',
            )}
          >
            <ScrollText size={14} /> Activity
          </button>
        </div>

        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              listFilter === 'ptp'
                ? 'Search promises…'
                : listFilter === 'history'
                  ? 'Search activity…'
                  : 'Search your assignments…'
            }
            className="h-12 w-full min-w-0 rounded-xl border border-slate-200 bg-surface pl-10 pr-10 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-white/[.08] sm:h-11 sm:text-sm"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">
              <X size={15} />
            </button>
          )}
        </div>

        {listFilter === 'history' ? (
          <AgentActivityPanel agentUserId={user.id} search={search} />
        ) : listFilter === 'ptp' ? (
          <AgentPtpPanel
            agentUserId={user.id}
            promises={openPromises}
            search={search}
            filter={ptpSubFilter}
            onFilterChange={setPtpSubFilter}
            onCollect={collectForLoanId}
            onFulfill={(id) => void closePtp(id, 'FULFILLED')}
            onCancel={(id) => void closePtp(id, 'CANCELLED')}
          />
        ) : assignedIds.length === 0 ? (
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
                ? 'Collections waiting for admin approval. UPI screenshots are reviewed separately under Portal proofs.'
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
              const ptpToday = ptp && classifyPtpTiming(ptp.promiseDate) === 'TODAY' ? ptp : undefined;
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
                  ptpToday={ptpToday}
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
          initial={editInitial}
          onSubmit={async (p) => {
            const err = await recovery.updatePendingCollectionClaim(editPending.claim.id, user.id, p);
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
          onSubmit={async (p) => {
            const c = d.customers.find((x) => x.id === ptpLoan.customerId);
            const err = await recovery.submitPromise({
              agentUserId: user.id,
              agentName: user.fullName || user.username,
              loanId: ptpLoan.id,
              customerName: c?.name ?? '—',
              loanNumber: ptpLoan.loanNumber,
              ...p,
            });
            if (err) {
              toast(`Promise not saved: ${err}`, 'error');
              return;
            }
            toast('Promise date saved', 'success');
          }}
        />
      )}
    </div>
  );
}
