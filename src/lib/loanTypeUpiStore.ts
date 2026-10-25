/**
 * Per-loan-type UPI settings (UI-only until backend API is wired).
 * Stored in localStorage so admin and customer portal on the same browser stay in sync.
 */

import {
  LOAN_TYPE_UPI_ORDER,
  emptyLoanTypeUpiMap,
  isLoanTypeUpiComplete,
  mergeLoanTypeUpiMap,
  validateLoanTypeUpiMap,
  type LoanTypeUpiMap,
} from '@/lib/loanTypeUpi';

const STORAGE_KEY = 'anush.settings.loanTypeUpi';

export const LOAN_TYPE_UPI_CHANGED = 'anush:loan-type-upi-changed';

function notify() {
  window.dispatchEvent(new Event(LOAN_TYPE_UPI_CHANGED));
}

export function readLoanTypeUpiMap(): LoanTypeUpiMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyLoanTypeUpiMap();
    const parsed = JSON.parse(raw) as Partial<LoanTypeUpiMap>;
    return mergeLoanTypeUpiMap(parsed);
  } catch {
    return emptyLoanTypeUpiMap();
  }
}

/** Returns null on success, or a short message for toast. */
export function saveLoanTypeUpiMap(map: LoanTypeUpiMap): string | null {
  const errors = validateLoanTypeUpiMap(map);
  if (errors) {
    return 'Fill a valid UPI ID and payee name for every loan type.';
  }
  const normalized = emptyLoanTypeUpiMap();
  for (const t of LOAN_TYPE_UPI_ORDER) {
    normalized[t] = {
      payeeVpa: map[t].payeeVpa.trim().toLowerCase(),
      payeeName: map[t].payeeName.trim(),
    };
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  notify();
  return null;
}

export function isPortalLoanTypeUpiReady(): boolean {
  return isLoanTypeUpiComplete(readLoanTypeUpiMap());
}
