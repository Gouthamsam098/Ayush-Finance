import { listMockUsers } from '@/lib/mockUsers';
import { fmtDate, todayISO } from '@/lib/format';
import type { Loan } from '@/mock/DataContext';
import { recoveryDueNow } from './recoveryDue';
import {
  computeBalancedOverdueAssignments,
  countOverdueReassignments,
} from './autoAssignOverdueLoans';
import {
  readAssignmentsMap,
  replaceAssignmentsMap,
  readLastAutoAssignDate,
  writeLastAutoAssignDate,
  readTestAutoAssignTime,
} from './recoveryStore';

export type RecoveryDueApi = {
  loans: Loan[];
  totalDueForDaily: (loan: Loan) => number;
  totalDueForMonthly: (loan: Loan) => number;
  totalDueForInterestOnly: (loan: Loan) => number;
};

export type RecoveryAutoAssignResult = {
  ran: boolean;
  skippedReason?: 'already_ran_today' | 'no_agents' | 'no_loans';
  overdueCount?: number;
  agentsCount?: number;
  reassignedCount?: number;
};

/** Demo recovery agents live in mockUsers even when loans come from the API. */
export function hasActiveRecoveryAgents(): boolean {
  return listMockUsers().some((u) => u.role === 'RECOVERY_AGENT' && u.isActive);
}

export function runRecoveryAutoAssign(
  d: RecoveryDueApi,
  options?: { force?: boolean },
): RecoveryAutoAssignResult {
  if (d.loans.length === 0) {
    return { ran: false, skippedReason: 'no_loans' };
  }

  const runSlotKey = autoAssignRunSlotKey();
  if (!options?.force && readLastAutoAssignDate() === runSlotKey) {
    return { ran: false, skippedReason: 'already_ran_today' };
  }

  const agents = listMockUsers()
    .filter((u) => u.role === 'RECOVERY_AGENT' && u.isActive)
    .map((u) => u.id)
    .sort((a, b) => a - b);

  if (agents.length === 0) {
    return { ran: false, skippedReason: 'no_agents' };
  }

  const overdueLoanIds = d.loans
    .filter((l) => l.status === 'ACTIVE' && recoveryDueNow(d, l) > 0)
    .map((l) => l.id)
    .sort((a, b) => a - b);

  const before = readAssignmentsMap();
  const after = computeBalancedOverdueAssignments(agents, overdueLoanIds, before);
  const reassignedCount = countOverdueReassignments(overdueLoanIds, before, after);

  replaceAssignmentsMap(after);
  writeLastAutoAssignDate(runSlotKey);

  return {
    ran: true,
    overdueCount: overdueLoanIds.length,
    agentsCount: agents.length,
    reassignedCount,
  };
}

/** Once-per-day key; includes test HH:MM when set so you can pick another time same day. */
export function autoAssignRunSlotKey(): string {
  const test = readTestAutoAssignTime();
  return test ? `${todayISO()}|${test}` : todayISO();
}

/** In test schedule mode, skip catch-up on load until today's HH:MM has passed. */
export function isPastTodaysTestSchedule(now = new Date()): boolean {
  const test = readTestAutoAssignTime();
  if (!test) return true;
  const [hh, mm] = test.split(':').map(Number);
  const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
  return now.getTime() >= scheduled.getTime();
}

/** Milliseconds until the next scheduled auto-assign (test time or local midnight). */
export function msUntilNextAutoAssignRun(): number {
  const test = readTestAutoAssignTime();
  const now = new Date();
  if (!test) {
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    return Math.max(1000, next.getTime() - now.getTime());
  }
  const [hh, mm] = test.split(':').map(Number);
  let next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
  }
  return Math.max(1000, next.getTime() - now.getTime());
}

/** Saved daily time for display (null = midnight local). */
export function savedDailyScheduleTime(): string | null {
  return readTestAutoAssignTime();
}

export function formatScheduleClock12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function dailyScheduleSummary(): string {
  const t = readTestAutoAssignTime();
  return t ? `Every day at ${formatScheduleClock12(t)}` : 'Every day at 12:00 AM (midnight)';
}

export type NextAutoAssignRun = {
  dateLabel: string;
  timeLabel: string;
  countdown: string;
};

export function nextAutoAssignRun(): NextAutoAssignRun {
  const ms = msUntilNextAutoAssignRun();
  const at = new Date(Date.now() + ms);
  const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return {
    dateLabel: fmtDate(day),
    timeLabel: formatScheduleClock12(`${hh}:${mm}`),
    countdown: formatDuration(ms),
  };
}

/** Human-readable next run for Settings UI. */
export function describeNextAutoAssignRun(): string {
  const n = nextAutoAssignRun();
  return `${n.dateLabel} at ${n.timeLabel} (in ${n.countdown})`;
}

function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
