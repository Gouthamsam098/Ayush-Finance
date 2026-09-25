/**
 * Demo storage for customer UPI payment screenshots until backend upload exists.
 * Replace `persistPaymentProof` with an API call; keep `PaymentProofRecord` shape stable for integration.
 */

import type { PortalPayPurpose } from '@/features/customer-portal/loanPortalSummary';

const STORAGE_KEY = 'anush.portal.paymentProofs';

export const PAYMENT_PROOF_SUBMITTED_EVENT = 'anush:payment-proof-submitted';
export const PAYMENT_PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const PAYMENT_PROOF_ACCEPT = 'image/jpeg,image/png,image/webp';

export type PaymentProofStatus = 'pending' | 'verified';

export interface PaymentProofRecord {
  id: string;
  loanId: number;
  customerId: number;
  loanNumber: string;
  fileName: string;
  mimeType: string;
  /** Demo-only inline image; production should use server file id / URL. */
  dataUrl: string;
  amountRupees: number;
  purpose: PortalPayPurpose;
  submittedAt: string;
  status: PaymentProofStatus;
}

function readAll(): PaymentProofRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PaymentProofRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(rows: PaymentProofRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

export function listPaymentProofs(): PaymentProofRecord[] {
  return readAll().sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

export function countPendingPaymentProofs(): number {
  return readAll().filter((r) => r.status === 'pending').length;
}

/** Pending submission count per loan (multiple uploads increment the count). */
export function pendingProofCountByLoanId(): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const row of readAll()) {
    if (row.status !== 'pending') continue;
    counts[row.loanId] = (counts[row.loanId] ?? 0) + 1;
  }
  return counts;
}

export function getLatestPaymentProof(loanId: number): PaymentProofRecord | null {
  const forLoan = readAll()
    .filter((r) => r.loanId === loanId)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  return forLoan[0] ?? null;
}

export function setPaymentProofStatus(id: string, status: PaymentProofStatus): PaymentProofRecord | null {
  const rows = readAll();
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const next = { ...rows[idx], status };
  rows[idx] = next;
  writeAll(rows);
  window.dispatchEvent(new CustomEvent(PAYMENT_PROOF_SUBMITTED_EVENT, { detail: next }));
  return next;
}

export function persistPaymentProof(input: Omit<PaymentProofRecord, 'id' | 'status' | 'submittedAt'>): PaymentProofRecord {
  const record: PaymentProofRecord = {
    ...input,
    id: `pp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    submittedAt: new Date().toISOString(),
    status: 'pending',
  };
  writeAll([record, ...readAll()]);
  window.dispatchEvent(new CustomEvent(PAYMENT_PROOF_SUBMITTED_EVENT, { detail: record }));
  return record;
}
