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
import {
  RECOVERY_SCHEDULE_CHANGED,
  refreshRecovery,
  upsertCachedSubmission,
} from './recoveryStore';
import { recoveryApi } from '@/services/recoveryApi';
import { ApiError } from '@/lib/api';
import { COLLECTIONS_CHANGED_EVENT } from '@/lib/dataEvents';

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
  }) => Promise<string | null>;
  submitPromise: (input: {
    agentUserId: number;
    agentName: string;
    loanId: number;
    customerName: string;
    loanNumber: string;
    promiseDate: string;
    promisedAmount?: number;
    note?: string;
  }) => Promise<string | null>;
  approveClaim: (id: string) => Promise<void>;
  rejectClaim: (id: string, reason?: string) => void;
  updatePendingCollectionClaim: (
    id: string,
    agentUserId: number,
    patch: { amount: number; mode: PayMode; receiptDate: string; note?: string },
  ) => Promise<string | null>;
  /** Demo only: run overdue balancing (respects once-per-day unless force). */
  runOverdueAutoAssign: (force?: boolean) => RecoveryAutoAssignResult;
  assignmentVersion: number;
}

const RecoveryCtx = createContext<RecoveryContextValue | null>(null);

/** The message an agent sees when the server refuses a submission. */
function saveErrorText(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    const fieldMsgs = Object.values(e.fields ?? {}).filter(Boolean);
    return fieldMsgs.length > 0 ? fieldMsgs.join(' · ') : e.message;
  }
  return fallback;
}

const OFFLINE_MSG = 'Could not reach the server. Check your connection and try again.';

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
    // API mode: assignments + submissions live on the server.
    if (config.useApi && authUserId != null) void refreshRecovery();
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

  const runOverdueAutoAssign = useCallback((force?: boolean): RecoveryAutoAssignResult => {
    if (config.useApi) {
      // Server-side job; the new assignments arrive with the refresh.
      recoveryApi.runAutoAssign()
        .then(() => refreshRecovery())
        .catch((e) => console.error('Auto-assign run failed', e));
      return { ran: false };
    }
    return runRecoveryAutoAssign(d, { force });
  }, [d]);

  useEffect(() => {
    // API mode: the server runs the daily auto-assign (no browser needed).
    if (!dataReady || config.useApi) return;
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

  const submitCollectionClaim = useCallback(async (input: {
    agentUserId: number;
    agentName: string;
    loanId: number;
    customerName: string;
    loanNumber: string;
    amount: number;
    mode: PayMode;
    receiptDate: string;
    note?: string;
  }): Promise<string | null> => {
    const pending = listSubmissions().find(
      (s) => s.loanId === input.loanId && s.type === 'COLLECTION_CLAIM' && s.status === 'PENDING',
    );
    if (pending) return 'A collection for this loan is already awaiting admin approval.';
    if (config.useApi) {
      // Wait for the server so a refusal reaches the agent (the dialog shows
      // the message and stays open) instead of silently vanishing.
      try {
        upsertCachedSubmission(await recoveryApi.submitClaim(input));
        refresh();
        return null;
      } catch (e) {
        return saveErrorText(e, OFFLINE_MSG);
      }
    }
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

  const submitPromise = useCallback(async (input: {
    agentUserId: number;
    agentName: string;
    loanId: number;
    customerName: string;
    loanNumber: string;
    promiseDate: string;
    promisedAmount?: number;
    note?: string;
  }): Promise<string | null> => {
    if (config.useApi) {
      try {
        upsertCachedSubmission(await recoveryApi.submitPromise(input));
        refresh();
        return null;
      } catch (e) {
        return saveErrorText(e, OFFLINE_MSG);
      }
    }
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
    return null;
  }, [refresh]);

  const approveClaim = useCallback(async (id: string) => {
    const row = listSubmissions().find((s) => s.id === id);
    if (!row || row.type !== 'COLLECTION_CLAIM' || row.status !== 'PENDING') return;
    if (config.useApi) {
      // The server records the collection (credited to the agent), marks the
      // claim approved and releases the loan once nothing is due — atomically.
      // A refusal throws, which the queue shows as "Could not accept".
      const saved = await recoveryApi.approve(id);
      upsertCachedSubmission(saved);
      window.dispatchEvent(new Event(COLLECTIONS_CHANGED_EVENT));
      void refreshRecovery();
      refresh();
      return;
    }
    const loan = d.loans.find((l) => l.id === row.loanId);
    const dueBefore = loan ? recoveryDueNow(d, loan) : row.amount;
    const created = await Promise.resolve(d.addCollection({
      loanId: row.loanId,
      amount: row.amount,
      mode: row.mode,
      date: row.receiptDate,
      remarks: row.note ? `Recovery: ${row.note}` : 'Recovery agent collection (approved)',
      collectorType: 'RECOVERY_AGENT',
      collectorName: row.agentName,
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
    if (config.useApi) {
      recoveryApi.reject(id, reason)
        .then((saved) => upsertCachedSubmission(saved))
        .catch((e) => {
          console.error('Reject was not saved', e);
          void refreshRecovery();
        });
    }
  }, [refresh]);

  const updatePendingCollectionClaim = useCallback(async (
    id: string,
    agentUserId: number,
    patch: { amount: number; mode: PayMode; receiptDate: string; note?: string },
  ): Promise<string | null> => {
    const row = listSubmissions().find((s) => s.id === id);
    if (!row || row.type !== 'COLLECTION_CLAIM' || row.status !== 'PENDING') {
      return 'This submission can no longer be edited.';
    }
    if (row.agentUserId !== agentUserId) return 'You can only edit your own submissions.';
    if (!patch.amount || patch.amount <= 0) return 'Enter a valid amount.';
    if (config.useApi) {
      try {
        upsertCachedSubmission(await recoveryApi.updateClaim(id, patch));
        refresh();
        return null;
      } catch (e) {
        // e.g. the admin approved or rejected it meanwhile — show why, and reload.
        void refreshRecovery();
        return saveErrorText(e, OFFLINE_MSG);
      }
    }
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
