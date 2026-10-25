import type { RecoverySubmission } from '@/features/recovery/types';
import { fmtDate, inr } from '@/lib/format';

export type AgentActivityKind =
  | 'COLLECT_SUBMITTED'
  | 'COLLECT_UPDATED'
  | 'COLLECT_APPROVED'
  | 'COLLECT_REJECTED'
  | 'PTP_SET'
  | 'PTP_FULFILLED'
  | 'PTP_CANCELLED'
  | 'PROOF_UPLOADED';

export interface AgentActivityRow {
  id: string;
  agentUserId: number;
  at: string;
  kind: AgentActivityKind;
  loanId: number;
  loanNumber: string;
  customerName: string;
  title: string;
  detail?: string;
  amountRupees?: number;
}

const EXTRA_KEY = 'anush.recovery.agentActivityExtras';
export const AGENT_ACTIVITY_CHANGED = 'anush:recovery-agent-activity-changed';

type ExtraRow = Omit<AgentActivityRow, 'title'> & { title?: string; summary?: string };

function readExtras(): ExtraRow[] {
  try {
    const raw = localStorage.getItem(EXTRA_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ExtraRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeExtras(rows: ExtraRow[]) {
  localStorage.setItem(EXTRA_KEY, JSON.stringify(rows.slice(0, 500)));
  window.dispatchEvent(new Event(AGENT_ACTIVITY_CHANGED));
}

export function recordAgentActivity(
  row: Omit<AgentActivityRow, 'id' | 'title'> & { title?: string; summary?: string },
): void {
  const title = row.title ?? row.summary ?? 'Activity';
  const entry: ExtraRow = {
    ...row,
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title,
  };
  writeExtras([entry, ...readExtras()]);
}

function submissionActivities(s: RecoverySubmission): AgentActivityRow[] {
  const base = {
    agentUserId: s.agentUserId,
    loanId: s.loanId,
    loanNumber: s.loanNumber,
    customerName: s.customerName,
  };

  if (s.type === 'COLLECTION_CLAIM') {
    const rows: AgentActivityRow[] = [
      {
        id: `${s.id}:collect-submitted`,
        ...base,
        at: s.createdAt,
        kind: 'COLLECT_SUBMITTED',
        title: 'Collect submitted',
        detail: `${inr(s.amount)} · ${s.mode} · receipt ${fmtDate(s.receiptDate)}`,
        amountRupees: s.amount,
      },
    ];
    if (s.reviewedAt && s.status === 'APPROVED') {
      rows.push({
        id: `${s.id}:collect-approved`,
        ...base,
        at: s.reviewedAt,
        kind: 'COLLECT_APPROVED',
        title: 'Collect approved',
        detail: `${inr(s.amount)} recorded on ledger`,
        amountRupees: s.amount,
      });
    }
    if (s.reviewedAt && s.status === 'REJECTED') {
      rows.push({
        id: `${s.id}:collect-rejected`,
        ...base,
        at: s.reviewedAt,
        kind: 'COLLECT_REJECTED',
        title: 'Collect rejected',
        detail: s.reviewNote?.trim() || 'Admin rejected — resubmit from Collect',
        amountRupees: s.amount,
      });
    }
    if (!s.reviewedAt && s.status === 'REJECTED') {
      rows.push({
        id: `${s.id}:collect-rejected`,
        ...base,
        at: s.createdAt,
        kind: 'COLLECT_REJECTED',
        title: 'Collect rejected',
        detail: s.reviewNote?.trim() || 'Rejected — resubmit from Collect',
        amountRupees: s.amount,
      });
    }
    return rows;
  }

  const rows: AgentActivityRow[] = [
    {
      id: `${s.id}:ptp-set`,
      ...base,
      at: s.createdAt,
      kind: 'PTP_SET',
      title: 'Promise to pay',
      detail: `Due ${fmtDate(s.promiseDate)}${s.promisedAmount ? ` · ${inr(s.promisedAmount)}` : ''}`,
      amountRupees: s.promisedAmount,
    },
  ];
  if (s.status === 'FULFILLED') {
    rows.push({
      id: `${s.id}:ptp-fulfilled`,
      ...base,
      at: s.reviewedAt ?? s.createdAt,
      kind: 'PTP_FULFILLED',
      title: 'Promise fulfilled',
      detail: fmtDate(s.promiseDate),
    });
  }
  if (s.status === 'CANCELLED') {
    rows.push({
      id: `${s.id}:ptp-cancelled`,
      ...base,
      at: s.reviewedAt ?? s.createdAt,
      kind: 'PTP_CANCELLED',
      title: 'Promise cancelled',
      detail: fmtDate(s.promiseDate),
    });
  }
  return rows;
}

function extraToRow(e: ExtraRow): AgentActivityRow {
  return {
    id: e.id,
    agentUserId: e.agentUserId,
    at: e.at,
    kind: e.kind,
    loanId: e.loanId,
    loanNumber: e.loanNumber,
    customerName: e.customerName,
    title: e.title ?? e.summary ?? 'Activity',
    detail: e.detail,
    amountRupees: e.amountRupees,
  };
}

/** Chronological activity for one recovery agent (newest first). */
export function listAgentActivities(
  agentUserId: number,
  submissions: RecoverySubmission[],
): AgentActivityRow[] {
  const fromSubs = submissions
    .filter((s) => s.agentUserId === agentUserId)
    .flatMap(submissionActivities);
  const fromExtras = readExtras()
    .filter((e) => e.agentUserId === agentUserId)
    .map(extraToRow);

  const byId = new Map<string, AgentActivityRow>();
  for (const row of [...fromSubs, ...fromExtras]) {
    byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) => b.at.localeCompare(a.at));
}
