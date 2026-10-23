/** Admin-only: hide reviewed recovery / portal-proof cards from Collections until dismissed. */

const RECOVERY_DISMISSED_KEY = 'anush.admin.dismissedRecoverySubmissions';
const PROOF_DISMISSED_KEY = 'anush.admin.dismissedPaymentProofs';

export const ADMIN_DISMISSALS_CHANGED = 'anush:admin-dismissals-changed';

function readIds(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeIds(key: string, ids: Set<string>) {
  localStorage.setItem(key, JSON.stringify([...ids]));
  window.dispatchEvent(new Event(ADMIN_DISMISSALS_CHANGED));
}

export function isRecoverySubmissionDismissed(id: string): boolean {
  return readIds(RECOVERY_DISMISSED_KEY).has(id);
}

export function dismissRecoverySubmission(id: string) {
  const next = readIds(RECOVERY_DISMISSED_KEY);
  next.add(id);
  writeIds(RECOVERY_DISMISSED_KEY, next);
}

export function isPaymentProofDismissed(id: string): boolean {
  return readIds(PROOF_DISMISSED_KEY).has(id);
}

export function dismissPaymentProof(id: string) {
  const next = readIds(PROOF_DISMISSED_KEY);
  next.add(id);
  writeIds(PROOF_DISMISSED_KEY, next);
}
