import type { RecoverySubmission } from './types';

const ASSIGN_KEY = 'anush.recovery.assignments';
export const RECOVERY_SUBMISSIONS_KEY = 'anush.recovery.submissions';
export const RECOVERY_AUTO_ASSIGN_LAST_KEY = 'anush.recovery.lastAutoAssignDate';
/** Testing only: daily auto-assign at this local HH:MM instead of midnight. */
export const RECOVERY_AUTO_ASSIGN_TEST_TIME_KEY = 'anush.recovery.autoAssignTestTime';
const SUB_KEY = RECOVERY_SUBMISSIONS_KEY;

/** Same-tab listeners (e.g. admin UI) refresh when agent writes a submission. */
export const RECOVERY_SUBMISSIONS_CHANGED = 'anush:recovery-submissions-changed';
export const RECOVERY_ASSIGNMENTS_CHANGED = 'anush:recovery-assignments-changed';
export const RECOVERY_SCHEDULE_CHANGED = 'anush:recovery-schedule-changed';

function notifySubmissionsChanged() {
  window.dispatchEvent(new Event(RECOVERY_SUBMISSIONS_CHANGED));
}

function notifyAssignmentsChanged() {
  window.dispatchEvent(new Event(RECOVERY_ASSIGNMENTS_CHANGED));
}

export function readLastAutoAssignDate(): string | null {
  try {
    return localStorage.getItem(RECOVERY_AUTO_ASSIGN_LAST_KEY);
  } catch {
    return null;
  }
}

export function writeLastAutoAssignDate(isoDate: string) {
  localStorage.setItem(RECOVERY_AUTO_ASSIGN_LAST_KEY, isoDate);
}

function parseHHMM(value: string): { h: number; m: number } | null {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

/** User test schedule (Settings) or optional VITE_RECOVERY_AUTO_ASSIGN_TEST_TIME. */
export function readTestAutoAssignTime(): string | null {
  try {
    const stored = localStorage.getItem(RECOVERY_AUTO_ASSIGN_TEST_TIME_KEY);
    if (stored) {
      const p = parseHHMM(stored);
      return p ? stored : null;
    }
  } catch {
    /* ignore */
  }
  const env = import.meta.env.VITE_RECOVERY_AUTO_ASSIGN_TEST_TIME as string | undefined;
  if (env && parseHHMM(env)) return env;
  return null;
}

export function writeTestAutoAssignTime(value: string | null) {
  if (!value) localStorage.removeItem(RECOVERY_AUTO_ASSIGN_TEST_TIME_KEY);
  else localStorage.setItem(RECOVERY_AUTO_ASSIGN_TEST_TIME_KEY, value);
  window.dispatchEvent(new Event(RECOVERY_SCHEDULE_CHANGED));
}

export type AssignmentsMap = Record<string, number[]>;

function readAssignments(): AssignmentsMap {
  try {
    const raw = localStorage.getItem(ASSIGN_KEY);
    return raw ? (JSON.parse(raw) as AssignmentsMap) : {};
  } catch {
    return {};
  }
}

function writeAssignments(map: AssignmentsMap) {
  localStorage.setItem(ASSIGN_KEY, JSON.stringify(map));
  notifyAssignmentsChanged();
}

export function replaceAssignmentsMap(map: AssignmentsMap) {
  writeAssignments(map);
}

function readSubmissions(): RecoverySubmission[] {
  try {
    const raw = localStorage.getItem(SUB_KEY);
    return raw ? (JSON.parse(raw) as RecoverySubmission[]) : [];
  } catch {
    return [];
  }
}

function writeSubmissions(rows: RecoverySubmission[]) {
  localStorage.setItem(SUB_KEY, JSON.stringify(rows));
}

export function readAssignmentsMap(): AssignmentsMap {
  return readAssignments();
}

export function getAssignedLoanIds(agentUserId: number): number[] {
  return readAssignments()[String(agentUserId)] ?? [];
}

/** First agent assigned to a loan (one agent per loan in Settings UI). */
export function getAgentIdForLoan(loanId: number): number | undefined {
  const map = readAssignments();
  for (const [agentKey, loanIds] of Object.entries(map)) {
    if (loanIds.includes(loanId)) return Number(agentKey);
  }
  return undefined;
}

/** Loan ids assigned to any agent except `excludeAgentUserId` (omit when creating a new agent). */
export function loanIdsAssignedToOtherAgents(excludeAgentUserId?: number): Set<number> {
  const map = readAssignments();
  const blocked = new Set<number>();
  for (const [agentKey, ids] of Object.entries(map)) {
    if (excludeAgentUserId != null && Number(agentKey) === excludeAgentUserId) continue;
    ids.forEach((id) => blocked.add(id));
  }
  return blocked;
}

export function setAssignedLoanIds(agentUserId: number, loanIds: number[]) {
  const unique = [...new Set(loanIds)];
  const map = readAssignments();
  const agentKey = String(agentUserId);
  for (const [key, ids] of Object.entries(map)) {
    if (key === agentKey) continue;
    const next = ids.filter((id) => !unique.includes(id));
    if (next.length !== ids.length) map[key] = next;
  }
  map[agentKey] = unique;
  writeAssignments(map);
}

export function clearAssignmentsForUser(agentUserId: number) {
  const map = readAssignments();
  delete map[String(agentUserId)];
  writeAssignments(map);
}


export function listSubmissions(): RecoverySubmission[] {
  return readSubmissions().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addSubmission(row: RecoverySubmission) {
  writeSubmissions([row, ...readSubmissions()]);
  notifySubmissionsChanged();
}

export function updateSubmission(id: string, patch: Partial<RecoverySubmission>) {
  writeSubmissions(readSubmissions().map((s) => (s.id === id ? { ...s, ...patch } as RecoverySubmission : s)));
  notifySubmissionsChanged();
}

export function pendingClaimForLoan(loanId: number): RecoverySubmission | undefined {
  return readSubmissions().find(
    (s) => s.loanId === loanId && s.type === 'COLLECTION_CLAIM' && s.status === 'PENDING',
  );
}

export function latestSubmissionForLoan(loanId: number): RecoverySubmission | undefined {
  return readSubmissions().find((s) => s.loanId === loanId);
}

/** Latest collection claim this agent filed for a loan (if any). */
export function latestCollectionClaimForAgent(
  loanId: number,
  agentUserId: number,
  submissions?: RecoverySubmission[],
): RecoverySubmission | undefined {
  const rows = (submissions ?? readSubmissions()).filter(
    (s) => s.loanId === loanId && s.agentUserId === agentUserId && s.type === 'COLLECTION_CLAIM',
  );
  if (rows.length === 0) return undefined;
  return rows.reduce((latest, s) => (s.createdAt >= latest.createdAt ? s : latest));
}

/** Open promise-to-pay for this loan (latest), optionally scoped to one agent. */
export function latestOpenPromiseForLoan(
  loanId: number,
  agentUserId?: number,
  submissions?: RecoverySubmission[],
): RecoverySubmission | undefined {
  const rows = (submissions ?? readSubmissions()).filter(
    (s) => s.loanId === loanId && s.type === 'PROMISE_TO_PAY' && s.status === 'OPEN',
  );
  const scoped = agentUserId != null ? rows.filter((s) => s.agentUserId === agentUserId) : rows;
  if (scoped.length === 0) return undefined;
  return scoped.reduce((latest, s) => (s.createdAt >= latest.createdAt ? s : latest));
}
