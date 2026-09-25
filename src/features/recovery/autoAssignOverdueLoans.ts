import type { AssignmentsMap } from './recoveryStore';

/**
 * Demo auto-assign: balance unassigned / inactive-agent overdue loans across agents
 * by count. Keeps existing active-agent assignments (sticky day-to-day).
 */
export function computeBalancedOverdueAssignments(
  agentIds: number[],
  overdueLoanIds: number[],
  current: AssignmentsMap,
): AssignmentsMap {
  const agents = [...agentIds].sort((a, b) => a - b);
  if (agents.length === 0) return cloneMap(current);

  const overdue = new Set(overdueLoanIds);
  const active = new Set(agents);
  const next = cloneMap(current);

  for (const id of agents) {
    const key = String(id);
    if (!next[key]) next[key] = [];
  }

  const agentForLoan = (loanId: number): number | undefined => {
    for (const [key, ids] of Object.entries(next)) {
      if (ids.includes(loanId)) return Number(key);
    }
    return undefined;
  };

  const overdueCount = (agentId: number) =>
    (next[String(agentId)] ?? []).filter((id) => overdue.has(id)).length;

  const detach = (loanId: number) => {
    for (const key of Object.keys(next)) {
      next[key] = next[key].filter((id) => id !== loanId);
    }
  };

  const attach = (loanId: number, agentId: number) => {
    detach(loanId);
    const key = String(agentId);
    if (!next[key]) next[key] = [];
    if (!next[key].includes(loanId)) next[key].push(loanId);
  };

  const unassigned: number[] = [];

  for (const loanId of [...overdueLoanIds].sort((a, b) => a - b)) {
    const cur = agentForLoan(loanId);
    if (cur != null && active.has(cur)) continue;
    if (cur != null && !active.has(cur)) detach(loanId);
    unassigned.push(loanId);
  }

  for (const loanId of unassigned) {
    let pick = agents[0];
    let min = overdueCount(pick);
    for (const aid of agents) {
      const c = overdueCount(aid);
      if (c < min || (c === min && aid < pick)) {
        min = c;
        pick = aid;
      }
    }
    attach(loanId, pick);
  }

  return next;
}

function cloneMap(current: AssignmentsMap): AssignmentsMap {
  const out: AssignmentsMap = {};
  for (const [key, ids] of Object.entries(current)) {
    out[key] = [...ids];
  }
  return out;
}

/** Count overdue loans whose agent changed between two maps. */
export function countOverdueReassignments(
  overdueLoanIds: number[],
  before: AssignmentsMap,
  after: AssignmentsMap,
): number {
  const agentFor = (map: AssignmentsMap, loanId: number) => {
    for (const [key, ids] of Object.entries(map)) {
      if (ids.includes(loanId)) return Number(key);
    }
    return undefined;
  };
  let n = 0;
  for (const loanId of overdueLoanIds) {
    if (agentFor(before, loanId) !== agentFor(after, loanId)) n += 1;
  }
  return n;
}
