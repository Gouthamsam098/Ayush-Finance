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
  hasActiveRecoveryAgents,
  isPastTodaysScheduledRun,
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
import { rememberClaimUpi, rememberCollectionUpi, upiSnapshotFromClaim, enrichCollectionClaim } from '@/lib/recoveryClaimUpi';
import { clearPromiseStatusOverlay } from '@/lib/recoveryPtpOverlay';
import { recordAgentActivity } from '@/lib/recoveryAgentActivity';
import { refreshPaymentProofs, settleClaimProofsLocally } from '@/features/customer-portal/paymentProofStore';

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
    payeeVpa?: string;
    payeeName?: string;
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
    patch: {
      amount: number;
      mode: PayMode;
      receiptDate: string;
      note?: string;
      payeeVpa?: string;
      payeeName?: string;
    },
  ) => Promise<string | null>;
  /** Mark promise fulfilled or cancelled (demo: persisted; API: local overlay until backend). */
  closePromiseToPay: (id: string, agentUserId: number, status: 'FULFILLED' | 'CANCELLED') => Promise<string | null>;
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
      if (!isPastTodaysScheduledRun()) return;
      if (!hasActiveRecoveryAgents()) return;
      runRecoveryAutoAssign(dRef.current);
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
    payeeVpa?: string;
    payeeName?: string;
  }): Promise<string | null> => {
    const pending = listSubmissions().find(
      (s) => s.loanId === input.loanId && s.type === 'COLLECTION_CLAIM' && s.status === 'PENDING',
    );
    if (pending) return 'A collection for this loan is already awaiting admin approval.';
    if (config.useApi) {
      // Wait for the server so a refusal reaches the agent (the dialog shows
      // the message and stays open) instead of silently vanishing.
      try {
        const saved = await recoveryApi.submitClaim(input);
        const withUpi = input.mode === 'UPI' && input.payeeVpa
          ? { ...saved, payeeVpa: input.payeeVpa, payeeName: input.payeeName } as RecoverySubmission
          : saved;
        if (withUpi.type === 'COLLECTION_CLAIM' && withUpi.mode === 'UPI' && withUpi.payeeVpa) {
          rememberClaimUpi(withUpi.id, { payeeVpa: withUpi.payeeVpa, payeeName: withUpi.payeeName ?? '' });
        }
        upsertCachedSubmission(withUpi);
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
      payeeVpa: input.mode === 'UPI' ? input.payeeVpa : undefined,
      payeeName: input.mode === 'UPI' ? input.payeeName : undefined,
      createdAt: new Date().toISOString(),
    };
    if (row.mode === 'UPI' && row.payeeVpa) {
      rememberClaimUpi(row.id, { payeeVpa: row.payeeVpa, payeeName: row.payeeName ?? '' });
    }
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
    const claim = enrichCollectionClaim(row);
    const upiSnap = upiSnapshotFromClaim(claim);

    if (config.useApi) {
      // The server records the collection (credited to the agent), marks the
      // claim approved and releases the loan once nothing is due — atomically.
      // A refusal throws, which the queue shows as "Could not accept".
      const saved = await recoveryApi.approve(id);
      const merged = claim.mode === 'UPI' && upiSnap
        ? { ...saved, payeeVpa: upiSnap.payeeVpa, payeeName: upiSnap.payeeName } as RecoverySubmission
        : saved;
      if (merged.type === 'COLLECTION_CLAIM' && upiSnap) rememberClaimUpi(merged.id, upiSnap);
      upsertCachedSubmission(merged);
      window.dispatchEvent(new Event(COLLECTIONS_CHANGED_EVENT));
      // The server accepted the claim's screenshot with it — show that.
      refreshPaymentProofs();
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
      ...(upiSnap ? { payeeVpa: upiSnap.payeeVpa, payeeName: upiSnap.payeeName } : {}),
    }));
    const collectionId = created && typeof created === 'object' && 'id' in created
      ? (created as { id: number }).id
      : (() => {
        const rows = d.collections.filter((c) => c.loanId === row.loanId);
        return rows.length ? rows[rows.length - 1].id : undefined;
      })();
    if (collectionId && upiSnap) rememberCollectionUpi(collectionId, upiSnap);
    updateSubmission(id, {
      status: 'APPROVED',
      reviewedAt: new Date().toISOString(),
      collectionId,
    } as Partial<CollectionClaimSubmission>);
    settleClaimProofsLocally(id, 'verified');
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
    settleClaimProofsLocally(id, 'rejected');
    refresh();
    if (config.useApi) {
      recoveryApi.reject(id, reason)
        .then((saved) => {
          upsertCachedSubmission(saved);
          refreshPaymentProofs(); // its screenshot was rejected with it
        })
        .catch((e) => {
          console.error('Reject was not saved', e);
          void refreshRecovery();
        });
    }
  }, [refresh]);

  const updatePendingCollectionClaim = useCallback(async (
    id: string,
    agentUserId: number,
    patch: {
      amount: number;
      mode: PayMode;
      receiptDate: string;
      note?: string;
      payeeVpa?: string;
      payeeName?: string;
    },
  ): Promise<string | null> => {
    const row = listSubmissions().find((s) => s.id === id);
    if (!row || row.type !== 'COLLECTION_CLAIM' || row.status !== 'PENDING') {
      return 'This submission can no longer be edited.';
    }
    if (row.agentUserId !== agentUserId) return 'You can only edit your own submissions.';
    if (!patch.amount || patch.amount <= 0) return 'Enter a valid amount.';
    if (config.useApi) {
      try {
        const saved = await recoveryApi.updateClaim(id, patch);
        const withUpi = patch.mode === 'UPI' && patch.payeeVpa
          ? { ...saved, payeeVpa: patch.payeeVpa, payeeName: patch.payeeName } as RecoverySubmission
          : saved;
        if (withUpi.type === 'COLLECTION_CLAIM' && withUpi.mode === 'UPI' && withUpi.payeeVpa) {
          rememberClaimUpi(withUpi.id, { payeeVpa: withUpi.payeeVpa, payeeName: withUpi.payeeName ?? '' });
        }
        upsertCachedSubmission(withUpi);
        refreshPaymentProofs(); // an attached screenshot takes the new amount
        recordAgentActivity({
          agentUserId,
          at: new Date().toISOString(),
          kind: 'COLLECT_UPDATED',
          loanId: row.loanId,
          loanNumber: row.loanNumber,
          customerName: row.customerName,
          title: 'Collect updated',
          detail: `${patch.mode} · ${patch.receiptDate}`,
          amountRupees: patch.amount,
        });
        refresh();
        return null;
      } catch (e) {
        // e.g. the admin approved or rejected it meanwhile — show why, and reload.
        void refreshRecovery();
        return saveErrorText(e, OFFLINE_MSG);
      }
    }
    const nextUpi = patch.mode === 'UPI' && patch.payeeVpa
      ? { payeeVpa: patch.payeeVpa, payeeName: patch.payeeName }
      : { payeeVpa: undefined, payeeName: undefined };
    if (patch.mode === 'UPI' && patch.payeeVpa) {
      rememberClaimUpi(id, { payeeVpa: patch.payeeVpa, payeeName: patch.payeeName ?? '' });
    }
    updateSubmission(id, {
      amount: patch.amount,
      mode: patch.mode,
      receiptDate: patch.receiptDate,
      note: patch.note,
      ...nextUpi,
    } as Partial<CollectionClaimSubmission>);
    recordAgentActivity({
      agentUserId,
      at: new Date().toISOString(),
      kind: 'COLLECT_UPDATED',
      loanId: row.loanId,
      loanNumber: row.loanNumber,
      customerName: row.customerName,
      title: 'Collect updated',
      detail: `${patch.mode} · ${patch.receiptDate}`,
      amountRupees: patch.amount,
    });
    refresh();
    return null;
  }, [refresh]);

  const closePromiseToPay = useCallback(async (
    id: string,
    agentUserId: number,
    status: 'FULFILLED' | 'CANCELLED',
  ): Promise<string | null> => {
    const row = listSubmissions().find((s) => s.id === id);
    if (!row || row.type !== 'PROMISE_TO_PAY') return 'Promise not found.';
    if (row.agentUserId !== agentUserId) return 'You can only close your own promises.';
    if (row.status !== 'OPEN' && !config.useApi) return 'This promise is already closed.';
    if (config.useApi) {
      // Saved on the server, so every device (and the admin) sees it closed.
      try {
        const saved = await recoveryApi.closePromise(id, status);
        clearPromiseStatusOverlay(id);
        upsertCachedSubmission(saved);
        refresh();
        return null;
      } catch (e) {
        void refreshRecovery();
        return saveErrorText(e, OFFLINE_MSG);
      }
    }
    updateSubmission(id, {
      status,
      reviewedAt: new Date().toISOString(),
    } as Partial<PromiseSubmission>);
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
      closePromiseToPay,
      runOverdueAutoAssign,
      assignmentVersion,
    }),
    [submissions, refresh, assignLoans, getAssignments, clearAgent, submitCollectionClaim, submitPromise, approveClaim, rejectClaim, updatePendingCollectionClaim, closePromiseToPay, runOverdueAutoAssign, assignmentVersion],
  );

  return <RecoveryCtx.Provider value={value}>{children}</RecoveryCtx.Provider>;
}

export function useRecovery() {
  const ctx = useContext(RecoveryCtx);
  if (!ctx) throw new Error('useRecovery must be used within RecoveryProvider');
  return ctx;
}
