import type { PromiseSubmission, RecoverySubmission } from './types';
import { isActiveOpenPromise } from '@/lib/recoveryPtp';
import { clearPromiseStatusOverlay, getPromiseStatusOverlay } from '@/lib/recoveryPtpOverlay';
import { ApiError } from '@/lib/api';
import { config } from '@/lib/config';
import { tokenStore } from '@/lib/tokenStore';
import { listMockUsers } from '@/lib/mockUsers';
import { recoveryApi, type RecoveryAgentInfo } from '@/services/recoveryApi';
import { store } from '@/store';
import { dismissRecoverySubmission } from '@/lib/adminDismissals';

/**
 * Recovery-agent state: loan assignments, agent submissions (collection claims
 * and promises to pay) and the daily auto-assign schedule.
 *
 * Demo mode (VITE_USE_API off): localStorage, as before.
 * API mode: the server is the record. The exported functions keep their
 * synchronous signatures (screens call them during render) and read an
 * in-memory copy that `refreshRecovery()` reloads from the backend — on sign-in,
 * every 30 s while the tab is visible, and after each write. Each reload fires
 * the same change events the screens already listen to.
 */

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

// ── API-mode cache ───────────────────────────────────────────────────────────

const POLL_MS = 30_000;

const remote = {
  owner: '',
  agents: [] as RecoveryAgentInfo[],
  assignments: {} as AssignmentsMap,
  submissions: [] as RecoverySubmission[],
  schedule: null as { runTime: string | null; lastRunSlot: string | null } | null,
  inflight: false,
  /** A refresh was asked for while one was in flight — run it right after. */
  rerun: false,
  /** Bumped by every local write, so an older in-flight poll can't overwrite it. */
  version: 0,
  pollTimer: 0 as number,
};

type Scope = 'staff' | 'agent';

function apiScope(): { scope: Scope; owner: string; userId: number; isAdmin: boolean } | null {
  if (!config.useApi || !tokenStore.get()) return null;
  const { accessToken, user } = store.getState().auth;
  if (!accessToken || !user || user.role === 'CUSTOMER') return null;
  const scope: Scope = user.role === 'RECOVERY_AGENT' ? 'agent' : 'staff';
  return { scope, owner: `${scope}:${user.id}`, userId: user.id, isAdmin: user.role === 'ADMIN' };
}

function syncOwner(owner: string) {
  if (remote.owner === owner) return;
  remote.owner = owner;
  remote.agents = [];
  remote.assignments = {};
  remote.submissions = [];
  remote.schedule = null;
  remote.version += 1;
}

function startPolling() {
  if (remote.pollTimer) return;
  remote.pollTimer = window.setInterval(() => {
    // Signed out: stop polling and drop the cached recovery data.
    if (!apiScope()) {
      window.clearInterval(remote.pollTimer);
      remote.pollTimer = 0;
      syncOwner('');
      return;
    }
    if (document.visibilityState === 'visible') void refreshRecovery();
  }, POLL_MS);
}

/** Reload assignments, submissions and (admin) the schedule from the server. */
export async function refreshRecovery(): Promise<void> {
  const s = apiScope();
  if (!s) return;
  syncOwner(s.owner);
  startPolling();
  if (remote.inflight) {
    // Don't drop it: a write may have just happened (e.g. an approval).
    remote.rerun = true;
    return;
  }
  remote.inflight = true;
  const owner = s.owner;
  const version = remote.version;
  try {
    let agents = remote.agents;
    let assignments: AssignmentsMap;
    let submissions: RecoverySubmission[];
    let schedule = remote.schedule;
    if (s.scope === 'agent') {
      const [loanIds, subs] = await Promise.all([recoveryApi.agentLoanIds(), recoveryApi.agentSubmissions()]);
      assignments = { [String(s.userId)]: loanIds };
      submissions = subs;
    } else {
      const [snap, subs, sched] = await Promise.all([
        recoveryApi.assignments(),
        recoveryApi.staffSubmissions(),
        s.isAdmin ? recoveryApi.schedule().catch(() => null) : Promise.resolve(null),
      ]);
      agents = snap.agents;
      assignments = snap.map;
      submissions = subs;
      if (sched) schedule = { runTime: sched.run_time, lastRunSlot: sched.last_run_slot ?? null };
    }
    if (remote.owner !== owner) return;
    // A local write landed while this poll was in flight: its data is older
    // than what the screens show, so discard it and fetch again.
    if (remote.version !== version) {
      remote.rerun = true;
      return;
    }
    // Notify only on real change: every notification re-renders the recovery
    // screens, and an idle 30-second poll must not reset an open dialog.
    const changed = (x: unknown, y: unknown) => JSON.stringify(x) !== JSON.stringify(y);
    const assignmentsChanged = changed(agents, remote.agents) || changed(assignments, remote.assignments);
    const submissionsChanged = changed(submissions, remote.submissions);
    const scheduleChanged = changed(schedule, remote.schedule);
    remote.agents = agents;
    if (assignmentsChanged) remote.assignments = assignments;
    if (submissionsChanged) remote.submissions = submissions;
    remote.schedule = schedule;
    if (assignmentsChanged) notifyAssignmentsChanged();
    if (submissionsChanged) notifySubmissionsChanged();
    if (scheduleChanged) window.dispatchEvent(new Event(RECOVERY_SCHEDULE_CHANGED));
    if (s.scope === 'agent') void pushBrowserOnlyPromiseClosures(submissions);
  } catch {
    /* no Collections access, or offline — keep the last copy; the next poll retries */
  } finally {
    remote.inflight = false;
    if (remote.rerun) {
      remote.rerun = false;
      void refreshRecovery();
    }
  }
}

let pushingClosures = false;

/**
 * Promises an agent closed before closing was saved on the server live only in
 * this browser (recoveryPtpOverlay). Save each one on the server once, then
 * drop it from the browser. A refusal (e.g. no longer this agent's promise) also
 * drops it; a network failure keeps it for the next refresh.
 */
async function pushBrowserOnlyPromiseClosures(subs: RecoverySubmission[]) {
  if (pushingClosures) return;
  pushingClosures = true;
  try {
    for (const sub of subs) {
      if (sub.type !== 'PROMISE_TO_PAY') continue;
      const closed = getPromiseStatusOverlay(sub.id);
      if (closed !== 'FULFILLED' && closed !== 'CANCELLED') continue;
      if (sub.status !== 'OPEN') {
        clearPromiseStatusOverlay(sub.id);
        continue;
      }
      try {
        upsertCachedSubmission(await recoveryApi.closePromise(sub.id, closed));
        clearPromiseStatusOverlay(sub.id);
      } catch (e) {
        if (e instanceof ApiError) clearPromiseStatusOverlay(sub.id);
      }
    }
  } finally {
    pushingClosures = false;
  }
}

/** API mode: replace one submission in the cache (after a write) and notify. */
export function upsertCachedSubmission(row: RecoverySubmission, replaceId?: string) {
  remote.version += 1;
  const id = replaceId ?? row.id;
  const idx = remote.submissions.findIndex((s) => s.id === id);
  remote.submissions = idx >= 0
    ? remote.submissions.map((s, i) => (i === idx ? row : s))
    : [row, ...remote.submissions];
  notifySubmissionsChanged();
}

/** API mode: drop a submission from the cache (a failed optimistic write). */
export function removeCachedSubmission(id: string) {
  remote.version += 1;
  remote.submissions = remote.submissions.filter((s) => s.id !== id);
  notifySubmissionsChanged();
}

/** Recovery agents for other screens (Collections tags, Reports, Settings). */
export function listRecoveryAgents(): { id: number; fullName: string; isActive: boolean }[] {
  if (config.useApi) return remote.agents.map((a) => ({ id: a.id, fullName: a.name, isActive: a.isActive }));
  return listMockUsers()
    .filter((u) => u.role === 'RECOVERY_AGENT')
    .map((u) => ({ id: u.id, fullName: u.fullName.trim() || u.email, isActive: u.isActive }));
}

// ── auto-assign schedule ─────────────────────────────────────────────────────

export function readLastAutoAssignDate(): string | null {
  if (config.useApi) return remote.schedule?.lastRunSlot ?? null;
  try {
    return localStorage.getItem(RECOVERY_AUTO_ASSIGN_LAST_KEY);
  } catch {
    return null;
  }
}

export function writeLastAutoAssignDate(isoDate: string) {
  if (config.useApi) return; // recorded by the server job
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
  if (config.useApi) return remote.schedule?.runTime ?? null;
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

/** API: null = midnight. Demo: always persist HH:MM (default 00:00). */
export function writeTestAutoAssignTime(value: string | null) {
  const demoTime = !value || value === '00:00' ? '00:00' : value;
  const apiTime = demoTime === '00:00' ? null : demoTime;
  if (config.useApi) {
    remote.version += 1;
    remote.schedule = { runTime: apiTime, lastRunSlot: remote.schedule?.lastRunSlot ?? null };
    window.dispatchEvent(new Event(RECOVERY_SCHEDULE_CHANGED));
    recoveryApi.setSchedule(apiTime)
      .then((s) => {
        remote.schedule = { runTime: s.run_time, lastRunSlot: s.last_run_slot ?? null };
        window.dispatchEvent(new Event(RECOVERY_SCHEDULE_CHANGED));
      })
      .catch((e) => {
        console.error('Saving the auto-assign schedule failed', e);
        void refreshRecovery();
      });
    return;
  }
  localStorage.setItem(RECOVERY_AUTO_ASSIGN_TEST_TIME_KEY, demoTime);
  window.dispatchEvent(new Event(RECOVERY_SCHEDULE_CHANGED));
}

// ── assignments ──────────────────────────────────────────────────────────────

export type AssignmentsMap = Record<string, number[]>;

function readAssignments(): AssignmentsMap {
  if (config.useApi) return remote.assignments;
  try {
    const raw = localStorage.getItem(ASSIGN_KEY);
    return raw ? (JSON.parse(raw) as AssignmentsMap) : {};
  } catch {
    return {};
  }
}

function writeAssignments(map: AssignmentsMap) {
  // API mode: assignments are saved with the agent (Settings → userApi) and by
  // the server's auto-assign; this tab just reloads them.
  if (config.useApi) {
    void refreshRecovery();
    return;
  }
  localStorage.setItem(ASSIGN_KEY, JSON.stringify(map));
  notifyAssignmentsChanged();
}

export function replaceAssignmentsMap(map: AssignmentsMap) {
  writeAssignments(map);
}

function readSubmissions(): RecoverySubmission[] {
  if (config.useApi) return remote.submissions;
  try {
    const raw = localStorage.getItem(SUB_KEY);
    return raw ? (JSON.parse(raw) as RecoverySubmission[]) : [];
  } catch {
    return [];
  }
}

function writeSubmissions(rows: RecoverySubmission[]) {
  if (config.useApi) return; // API mode writes go through RecoveryContext → recoveryApi
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
  if (config.useApi) {
    void refreshRecovery();
    return;
  }
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
  if (config.useApi) {
    void refreshRecovery();
    return;
  }
  const map = readAssignments();
  delete map[String(agentUserId)];
  writeAssignments(map);
}


// listSubmissions() returns the SAME array while the data is unchanged. The
// Collections page refreshes the queue from an effect whose dependencies
// include the submissions themselves; a fresh array on every call made React
// re-render forever ("Maximum update depth exceeded").
let sortedSubmissions: { source: unknown; rows: RecoverySubmission[] } = { source: undefined, rows: [] };

export function listSubmissions(): RecoverySubmission[] {
  let source: unknown;
  if (config.useApi) {
    source = remote.submissions;
  } else {
    try {
      source = localStorage.getItem(SUB_KEY);
    } catch {
      source = null;
    }
  }
  if (source !== sortedSubmissions.source) {
    sortedSubmissions = {
      source,
      rows: [...readSubmissions()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }
  return sortedSubmissions.rows;
}

export function addSubmission(row: RecoverySubmission) {
  if (config.useApi) {
    upsertCachedSubmission(row);
    return;
  }
  writeSubmissions([row, ...readSubmissions()]);
  notifySubmissionsChanged();
}

/** Admin removes a reviewed (or any) queue card from Collections — hidden via dismiss list; demo mode also drops the row. */
export function removeSubmissionFromAdminQueue(id: string) {
  dismissRecoverySubmission(id);
  if (config.useApi) {
    // Dismiss is per-browser; drop from cache so the queue updates before the next poll.
    remote.version += 1;
    remote.submissions = remote.submissions.filter((s) => s.id !== id);
    sortedSubmissions = { source: undefined, rows: [] };
  } else {
    writeSubmissions(readSubmissions().filter((s) => s.id !== id));
    sortedSubmissions = { source: undefined, rows: [] };
  }
  notifySubmissionsChanged();
}

export function updateSubmission(id: string, patch: Partial<RecoverySubmission>) {
  if (config.useApi) {
    const cur = remote.submissions.find((s) => s.id === id);
    if (cur) upsertCachedSubmission({ ...cur, ...patch } as RecoverySubmission);
    return;
  }
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
    (s): s is PromiseSubmission =>
      s.loanId === loanId && s.type === 'PROMISE_TO_PAY' && isActiveOpenPromise(s as PromiseSubmission),
  );
  const scoped = agentUserId != null ? rows.filter((s) => s.agentUserId === agentUserId) : rows;
  if (scoped.length === 0) return undefined;
  return scoped.reduce((latest, s) => (s.createdAt >= latest.createdAt ? s : latest));
}

/** Open promises for one agent (active OPEN, not manually closed). */
export function openPromisesForAgent(
  agentUserId: number,
  submissions?: RecoverySubmission[],
): PromiseSubmission[] {
  return (submissions ?? readSubmissions())
    .filter((s): s is PromiseSubmission =>
      s.agentUserId === agentUserId && s.type === 'PROMISE_TO_PAY' && isActiveOpenPromise(s))
    .sort((a, b) => a.promiseDate.localeCompare(b.promiseDate) || b.createdAt.localeCompare(a.createdAt));
}
