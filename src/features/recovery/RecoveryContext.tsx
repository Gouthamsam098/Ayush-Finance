import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '@/store';
import { config } from '@/lib/config';
import { useData, type PayMode } from '@/mock/DataContext';
import { todayISO } from '@/lib/format';
import type { CollectionClaimSubmission, PromiseSubmission, RecoverySubmission } from './types';
import {
  addSubmission,
  getAssignedLoanIds,
  listSubmissions,
  setAssignedLoanIds,
  updateSubmission,
  clearAssignmentsForUser,
  RECOVERY_SUBMISSIONS_CHANGED,
  RECOVERY_SUBMISSIONS_KEY,
  RECOVERY_ASSIGNMENTS_CHANGED,
} from './recoveryStore';
import { recoveryDueNow } from './recoveryDue';
import {
  isPastTodaysTestSchedule,
  msUntilNextAutoAssignRun,
  runRecoveryAutoAssign,
  type RecoveryAutoAssignResult,
} from './recoveryAutoAssign';
import { RECOVERY_SCHEDULE_CHANGED } from './recoveryStore';

interface RecoveryContextValue {
  submissions: RecoverySubmission[];
  refresh: () => void;
  assignLoans: (agentUserId: number, loanIds: number[]) => void;
  getAssignments: (agentUserId: number) => number[];
  clearAgent: (agentUserId: number) => void;
  submitCollectionClaim: (input: {
    agentUserId: number;
    agentName: string;
    loanId: number;
    customerName: string;
    loanNumber: string;
    amount: number;
    mode: PayMode;
    receiptDate: string;
    note?: string;
  }) => string | null;
  submitPromise: (input: {
    agentUserId: number;
    agentName: string;
    loanId: number;
    customerName: string;
    loanNumber: string;
    promiseDate: string;
    promisedAmount?: number;
    note?: string;
  }) => void;
  approveClaim: (id: string) => Promise<void>;
  rejectClaim: (id: string, reason?: string) => void;
  updatePendingCollectionClaim: (
    id: string,
    agentUserId: number,
    patch: { amount: number; mode: PayMode; receiptDate: string; note?: string },
  ) => string | null;
  /** Demo only: run overdue balancing (respects once-per-day unless force). */
  runOverdueAutoAssign: (force?: boolean) => RecoveryAutoAssignResult;
  assignmentVersion: number;
}

const RecoveryCtx = createContext<RecoveryContextValue | null>(null);

function newId() {
  return `rcv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function RecoveryProvider({ children }: { children: React.ReactNode }) {
  const d = useData();
  const accessToken = useSelector((s: RootState) => s.auth.accessToken);
  const authUserId = useSelector((s: RootState) => s.auth.user?.id ?? null);
  const loanCount = d.loans.length;
  const dataReady = loanCount > 0 && (!config.useApi || !!accessToken);
  const dRef = useRef(d);
  dRef.current = d;
  const [submissions, setSubmissions] = useState<RecoverySubmission[]>(() => listSubmissions());
  const [assignmentVersion, setAssignmentVersion] = useState(0);
  const [scheduleTick, setScheduleTick] = useState(0);

  const refresh = useCallback(() => setSubmissions(listSubmissions()), []);

  // Agent submissions live in localStorage; re-load when admin signs in after agent,
  // when another tab writes, or when this tab receives a submission event.
  useEffect(() => {
    refresh();
  }, [authUserId, refresh]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === RECOVERY_SUBMISSIONS_KEY || e.key === null) refresh();
    };
    const onLocalChange = () => refresh();
    window.addEventListener('storage', onStorage);
    window.addEventListener(RECOVERY_SUBMISSIONS_CHANGED, onLocalChange);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(RECOVERY_SUBMISSIONS_CHANGED, onLocalChange);
    };
  }, [refresh]);

  useEffect(() => {
    const bump = () => setAssignmentVersion((v) => v + 1);
    window.addEventListener(RECOVERY_ASSIGNMENTS_CHANGED, bump);
    return () => window.removeEventListener(RECOVERY_ASSIGNMENTS_CHANGED, bump);
  }, []);

  useEffect(() => {
    const bump = () => setScheduleTick((v) => v + 1);
    window.addEventListener(RECOVERY_SCHEDULE_CHANGED, bump);
    return () => window.removeEventListener(RECOVERY_SCHEDULE_CHANGED, bump);
  }, []);

  const runOverdueAutoAssign = useCallback((force?: boolean) => runRecoveryAutoAssign(d, { force }), [d]);

  useEffect(() => {
    if (!dataReady) return;
    const tick = () => {
      if (dRef.current.loans.length === 0) return;
      if (isPastTodaysTestSchedule()) runRecoveryAutoAssign(dRef.current);
    };
    tick();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      timer = setTimeout(() => {
        tick();
        schedule();
      }, msUntilNextAutoAssignRun());
    };
    schedule();
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [dataReady, loanCount, scheduleTick]);

  const assignLoans = useCallback((agentUserId: number, loanIds: number[]) => {
    setAssignedLoanIds(agentUserId, loanIds);
  }, []);

  const getAssignments = useCallback(
    (agentUserId: number) => getAssignedLoanIds(agentUserId),
    [assignmentVersion],
  );

  const clearAgent = useCallback((agentUserId: number) => {
    clearAssignmentsForUser(agentUserId);
  }, []);

  const submitCollectionClaim = useCallback((input: {
    agentUserId: number;
    agentName: string;
    loanId: number;
    customerName: string;
    loanNumber: string;
    amount: number;
    mode: PayMode;
    receiptDate: string;
    note?: string;
  }): string | null => {
    const pending = listSubmissions().find(
      (s) => s.loanId === input.loanId && s.type === 'COLLECTION_CLAIM' && s.status === 'PENDING',
    );
    if (pending) return 'A collection for this loan is already awaiting admin approval.';
    const row: CollectionClaimSubmission = {
      id: newId(),
      type: 'COLLECTION_CLAIM',
      status: 'PENDING',
      loanId: input.loanId,
      agentUserId: input.agentUserId,
      agentName: input.agentName,
      customerName: input.customerName,
      loanNumber: input.loanNumber,
      amount: input.amount,
      mode: input.mode,
      receiptDate: input.receiptDate,
      note: input.note,
      createdAt: new Date().toISOString(),
    };
    addSubmission(row);
    refresh();
    return null;
  }, [refresh]);

  const submitPromise = useCallback((input: {
    agentUserId: number;
    agentName: string;
    loanId: number;
    customerName: string;
    loanNumber: string;
    promiseDate: string;
    promisedAmount?: number;
    note?: string;
  }) => {
    const row: PromiseSubmission = {
      id: newId(),
      type: 'PROMISE_TO_PAY',
      status: 'OPEN',
      loanId: input.loanId,
      agentUserId: input.agentUserId,
      agentName: input.agentName,
      customerName: input.customerName,
      loanNumber: input.loanNumber,
      promiseDate: input.promiseDate,
      promisedAmount: input.promisedAmount,
      note: input.note,
      createdAt: new Date().toISOString(),
    };
    addSubmission(row);
    refresh();
  }, [refresh]);

  const approveClaim = useCallback(async (id: string) => {
    const row = listSubmissions().find((s) => s.id === id);
    if (!row || row.type !== 'COLLECTION_CLAIM' || row.status !== 'PENDING') return;
    const loan = d.loans.find((l) => l.id === row.loanId);
    const dueBefore = loan ? recoveryDueNow(d, loan) : row.amount;
    const created = await Promise.resolve(d.addCollection({
      loanId: row.loanId,
      amount: row.amount,
      mode: row.mode,
      date: row.receiptDate,
      remarks: row.note ? `Recovery: ${row.note}` : 'Recovery agent collection (approved)',
    }));
    const collectionId = created && typeof created === 'object' && 'id' in created
      ? (created as { id: number }).id
      : (() => {
        const rows = d.collections.filter((c) => c.loanId === row.loanId);
        return rows.length ? rows[rows.length - 1].id : undefined;
      })();
    updateSubmission(id, {
      status: 'APPROVED',
      reviewedAt: new Date().toISOString(),
      collectionId,
    } as Partial<CollectionClaimSubmission>);
    const stillDue = Math.max(0, dueBefore - row.amount);
    if (stillDue <= 0) {
      const assigned = getAssignedLoanIds(row.agentUserId).filter((lid) => lid !== row.loanId);
      setAssignedLoanIds(row.agentUserId, assigned);
    }
    refresh();
  }, [d, refresh]);

  const rejectClaim = useCallback((id: string, reason?: string) => {
    updateSubmission(id, {
      status: 'REJECTED',
      reviewedAt: new Date().toISOString(),
      reviewNote: reason || 'Rejected by admin',
    } as Partial<CollectionClaimSubmission>);
    refresh();
  }, [refresh]);

  const updatePendingCollectionClaim = useCallback((
    id: string,
    agentUserId: number,
    patch: { amount: number; mode: PayMode; receiptDate: string; note?: string },
  ): string | null => {
    const row = listSubmissions().find((s) => s.id === id);
    if (!row || row.type !== 'COLLECTION_CLAIM' || row.status !== 'PENDING') {
      return 'This submission can no longer be edited.';
    }
    if (row.agentUserId !== agentUserId) return 'You can only edit your own submissions.';
    if (!patch.amount || patch.amount <= 0) return 'Enter a valid amount.';
    updateSubmission(id, {
      amount: patch.amount,
      mode: patch.mode,
      receiptDate: patch.receiptDate,
      note: patch.note,
    } as Partial<CollectionClaimSubmission>);
    refresh();
    return null;
  }, [refresh]);

  const value = useMemo(
    () => ({
      submissions,
      refresh,
      assignLoans,
      getAssignments,
      clearAgent,
      submitCollectionClaim,
      submitPromise,
      approveClaim,
      rejectClaim,
      updatePendingCollectionClaim,
      runOverdueAutoAssign,
      assignmentVersion,
    }),
    [submissions, refresh, assignLoans, getAssignments, clearAgent, submitCollectionClaim, submitPromise, approveClaim, rejectClaim, updatePendingCollectionClaim, runOverdueAutoAssign, assignmentVersion],
  );

  return <RecoveryCtx.Provider value={value}>{children}</RecoveryCtx.Provider>;
}

export function useRecovery() {
  const ctx = useContext(RecoveryCtx);
  if (!ctx) throw new Error('useRecovery must be used within RecoveryProvider');
  return ctx;
}
