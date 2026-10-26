/**
 * Recovery-agent API calls (assignments, claims / promises, review, daily
 * auto-assign) mapped to the frontend's recovery types.
 *
 * Staff (Collections permission):  /recovery/*
 * Recovery agent (own data only):  /agent/*
 */

import { api } from '@/lib/api';
import type { PayMode } from '@/mock/DataContext';
import type {
  CollectionClaimSubmission,
  PromiseSubmission,
  RecoverySubmission,
} from '@/features/recovery/types';

interface SubmissionWire {
  id: number;
  type: 'COLLECTION_CLAIM' | 'PROMISE_TO_PAY';
  status: string;
  loan_id: number;
  loan_number: string;
  customer_name: string;
  agent_user_id: number;
  agent_name: string;
  amount?: number;
  mode?: PayMode;
  receipt_date?: string;
  promise_date?: string;
  promised_amount?: number;
  note?: string;
  created_at: string;
  reviewed_at?: string;
  review_note?: string;
  /** UPI claims: the UPI ID it was paid to (server-set from Settings on filing). */
  payee_vpa?: string;
  payee_name?: string;
  /** When the agent last edited the pending claim. */
  edited_at?: string;
}

export interface RecoveryAgentInfo {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
}

export interface RecoveryAssignmentsSnapshot {
  agents: RecoveryAgentInfo[];
  /** agent id (string) → loan ids, the shape the recovery store uses. */
  map: Record<string, number[]>;
}

export interface AutoAssignScheduleWire {
  run_time: string | null;
  last_run_slot?: string;
  last_run_at?: string;
  next_run_at: string;
}

export function toSubmission(w: SubmissionWire): RecoverySubmission {
  const base = {
    id: String(w.id),
    loanId: w.loan_id,
    agentUserId: w.agent_user_id,
    agentName: w.agent_name,
    customerName: w.customer_name,
    loanNumber: w.loan_number,
    note: w.note,
    createdAt: w.created_at,
    reviewedAt: w.reviewed_at,
    reviewNote: w.review_note,
    editedAt: w.edited_at,
  };
  if (w.type === 'COLLECTION_CLAIM') {
    const claim: CollectionClaimSubmission = {
      ...base,
      type: 'COLLECTION_CLAIM',
      status: w.status as CollectionClaimSubmission['status'],
      amount: w.amount ?? 0,
      mode: w.mode ?? 'CASH',
      receiptDate: (w.receipt_date ?? '').slice(0, 10),
      ...(w.mode === 'UPI' && w.payee_vpa ? { payeeVpa: w.payee_vpa, payeeName: w.payee_name } : {}),
    };
    return claim;
  }
  const promise: PromiseSubmission = {
    ...base,
    type: 'PROMISE_TO_PAY',
    status: w.status as PromiseSubmission['status'],
    promiseDate: (w.promise_date ?? '').slice(0, 10),
    promisedAmount: w.promised_amount,
  };
  return promise;
}

export const recoveryApi = {
  // ── staff ──
  async assignments(): Promise<RecoveryAssignmentsSnapshot> {
    const w = await api.get<{
      agents: { id: number; name: string; email: string; is_active: boolean }[];
      assignments: { loan_id: number; agent_user_id: number }[];
    }>('/recovery/assignments');
    const map: Record<string, number[]> = {};
    for (const a of w.agents ?? []) map[String(a.id)] = [];
    for (const a of w.assignments ?? []) (map[String(a.agent_user_id)] ??= []).push(a.loan_id);
    return {
      agents: (w.agents ?? []).map((a) => ({ id: a.id, name: a.name, email: a.email, isActive: a.is_active })),
      map,
    };
  },

  async staffSubmissions(): Promise<RecoverySubmission[]> {
    return ((await api.get<SubmissionWire[]>('/recovery/submissions')) ?? []).map(toSubmission);
  },

  async approve(id: string): Promise<RecoverySubmission> {
    return toSubmission(await api.post<SubmissionWire>(`/recovery/submissions/${id}/approve`, {}));
  },

  async reject(id: string, reason?: string): Promise<RecoverySubmission> {
    return toSubmission(await api.post<SubmissionWire>(`/recovery/submissions/${id}/reject`, { reason: reason ?? '' }));
  },

  async schedule(): Promise<AutoAssignScheduleWire> {
    return api.get<AutoAssignScheduleWire>('/recovery/auto-assign');
  },

  async setSchedule(runTime: string | null): Promise<AutoAssignScheduleWire> {
    return api.put<AutoAssignScheduleWire>('/recovery/auto-assign', { run_time: runTime });
  },

  async runAutoAssign(): Promise<{ ran: boolean; skipped_reason?: string; overdue_count: number; agents_count: number; reassigned_count: number }> {
    return api.post('/recovery/auto-assign/run', {});
  },

  // ── agent ──
  async agentLoanIds(): Promise<number[]> {
    return ((await api.get<{ id: number }[]>('/agent/loans')) ?? []).map((l) => l.id);
  },

  async agentSubmissions(): Promise<RecoverySubmission[]> {
    return ((await api.get<SubmissionWire[]>('/agent/submissions')) ?? []).map(toSubmission);
  },

  async submitClaim(input: { loanId: number; amount: number; mode: PayMode; receiptDate: string; note?: string }): Promise<RecoverySubmission> {
    return toSubmission(await api.post<SubmissionWire>('/agent/claims', {
      loan_id: input.loanId, amount: input.amount, mode: input.mode, receipt_date: input.receiptDate, note: input.note || null,
    }));
  },

  async updateClaim(id: string, input: { amount: number; mode: PayMode; receiptDate: string; note?: string }): Promise<RecoverySubmission> {
    return toSubmission(await api.patch<SubmissionWire>(`/agent/claims/${id}`, {
      amount: input.amount, mode: input.mode, receipt_date: input.receiptDate, note: input.note || null,
    }));
  },

  async submitPromise(input: { loanId: number; promiseDate: string; promisedAmount?: number; note?: string }): Promise<RecoverySubmission> {
    return toSubmission(await api.post<SubmissionWire>('/agent/promises', {
      loan_id: input.loanId, promise_date: input.promiseDate, promised_amount: input.promisedAmount ?? null, note: input.note || null,
    }));
  },

  /** The agent closes their own open promise (saved on the server for every device). */
  async closePromise(id: string, status: 'FULFILLED' | 'CANCELLED'): Promise<RecoverySubmission> {
    return toSubmission(await api.post<SubmissionWire>(`/agent/promises/${id}/close`, { status }));
  },
};
