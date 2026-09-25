import { listMockUsers } from '@/lib/mockUsers';
import { readAssignmentsMap } from './recoveryStore';

/** loanId → recovery agent display name (demo assignments from Settings). */
export function recoveryAgentNameByLoanId(): Record<number, string> {
  const agents = new Map(
    listMockUsers()
      .filter((u) => u.role === 'RECOVERY_AGENT' && u.isActive)
      .map((u) => [u.id, u.fullName.trim() || u.email]),
  );
  const assignments = readAssignmentsMap();
  const out: Record<number, string> = {};
  for (const [agentKey, loanIds] of Object.entries(assignments)) {
    const name = agents.get(Number(agentKey));
    if (!name) continue;
    for (const loanId of loanIds) out[loanId] = name;
  }
  return out;
}
