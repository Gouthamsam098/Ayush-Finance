import type { LoanType } from '@/mock/DataContext';
import { LOAN_LABELS } from '@/mock/DataContext';

/** Fixed order for Settings form and validation (all six product types). */
export const LOAN_TYPE_UPI_ORDER: LoanType[] = [
  'DAILY_COLLECTION',
  'DAILY_INTEREST',
  'MONTHLY_INTEREST',
  'FLEXIBLE',
  'VEHICLE',
  'PROPERTY',
];

export interface LoanTypeUpiRow {
  payeeVpa: string;
  payeeName: string;
}

export type LoanTypeUpiMap = Record<LoanType, LoanTypeUpiRow>;

/** NPCI-style VPA: user@psp (letters, digits, dot, hyphen, underscore). */
export const UPI_VPA_PATTERN = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,}$/;

export function emptyLoanTypeUpiMap(): LoanTypeUpiMap {
  const map = {} as LoanTypeUpiMap;
  for (const t of LOAN_TYPE_UPI_ORDER) {
    map[t] = { payeeVpa: '', payeeName: '' };
  }
  return map;
}

export function mergeLoanTypeUpiMap(partial: Partial<LoanTypeUpiMap>): LoanTypeUpiMap {
  const base = emptyLoanTypeUpiMap();
  for (const t of LOAN_TYPE_UPI_ORDER) {
    const row = partial[t];
    if (row) {
      base[t] = { payeeVpa: row.payeeVpa ?? '', payeeName: row.payeeName ?? '' };
    }
  }
  return base;
}

export function validateUpiVpa(vpa: string): string | null {
  const v = vpa.trim().toLowerCase();
  if (!v) return 'UPI ID is required';
  if (v.length > 256) return 'UPI ID is too long';
  if (!UPI_VPA_PATTERN.test(v)) return 'Enter a valid UPI ID (e.g. name@ybl)';
  return null;
}

export function validatePayeeName(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Payee name is required';
  if (n.length < 2) return 'Payee name is too short';
  if (n.length > 80) return 'Payee name is too long';
  return null;
}

export type LoanTypeUpiFieldErrors = Partial<Record<LoanType, { payeeVpa?: string; payeeName?: string }>>;

export function validateLoanTypeUpiMap(map: LoanTypeUpiMap): LoanTypeUpiFieldErrors | null {
  const errors: LoanTypeUpiFieldErrors = {};
  let any = false;
  for (const t of LOAN_TYPE_UPI_ORDER) {
    const row = map[t];
    const vpaErr = validateUpiVpa(row?.payeeVpa ?? '');
    const nameErr = validatePayeeName(row?.payeeName ?? '');
    if (vpaErr || nameErr) {
      errors[t] = {};
      if (vpaErr) errors[t]!.payeeVpa = vpaErr;
      if (nameErr) errors[t]!.payeeName = nameErr;
      any = true;
    }
  }
  return any ? errors : null;
}

export function isLoanTypeUpiComplete(map: LoanTypeUpiMap): boolean {
  return validateLoanTypeUpiMap(map) === null;
}

export function upiForLoanType(map: LoanTypeUpiMap, type: LoanType): LoanTypeUpiRow | null {
  if (!isLoanTypeUpiComplete(map)) return null;
  const row = map[type];
  if (!row) return null;
  return {
    payeeVpa: row.payeeVpa.trim().toLowerCase(),
    payeeName: row.payeeName.trim(),
  };
}

export function loanTypeUpiLabel(type: LoanType): string {
  return LOAN_LABELS[type];
}
