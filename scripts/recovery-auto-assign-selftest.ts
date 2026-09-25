import assert from 'node:assert/strict';
import {
  computeBalancedOverdueAssignments,
  countOverdueReassignments,
} from '../src/features/recovery/autoAssignOverdueLoans.ts';

const agents = [10, 20];

// Sticky: loan 1 stays on agent 10; new overdue split by count (tie → lower agent id)
{
  const before = { '10': [1, 99], '20': [] };
  const after = computeBalancedOverdueAssignments(agents, [1, 2, 3], before);
  assert.deepEqual(after['10'].sort(), [1, 3, 99]);
  assert.deepEqual(after['20'].sort(), [2]);
  assert.equal(countOverdueReassignments([1, 2, 3], before, after), 2);
}

// Equal split fresh
{
  const after = computeBalancedOverdueAssignments(agents, [1, 2, 3, 4], {});
  assert.equal(after['10'].length, 2);
  assert.equal(after['20'].length, 2);
}

// Inactive agent → reassign overdue
{
  const before = { '99': [5], '10': [], '20': [] };
  const after = computeBalancedOverdueAssignments(agents, [5], before);
  assert.ok(after['10'].includes(5) || after['20'].includes(5));
  assert.ok(!after['99']?.includes(5));
}

function ownerOf(map: Record<string, number[]>, loanId: number): number | undefined {
  for (const [key, ids] of Object.entries(map)) {
    if (ids.includes(loanId)) return Number(key);
  }
  return undefined;
}

// Fresh book: every overdue loan must land on an active agent
{
  const overdue = [101, 102, 103];
  const after = computeBalancedOverdueAssignments(agents, overdue, {});
  for (const loanId of overdue) {
    const owner = ownerOf(after, loanId);
    assert.ok(owner === 10 || owner === 20, `loan ${loanId} must be assigned`);
  }
}

console.log('recovery-auto-assign-selftest: ok');
