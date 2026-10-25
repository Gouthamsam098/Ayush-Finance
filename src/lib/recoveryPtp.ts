import { todayISO } from '@/lib/format';
import type { PromiseSubmission } from '@/features/recovery/types';
import { getPromiseStatusOverlay } from '@/lib/recoveryPtpOverlay';

/** Days after promise date before UI shows “Follow up” (still OPEN in storage). */
export const PTP_FOLLOW_UP_AFTER_DAYS = Math.max(
  1,
  Number(import.meta.env.VITE_PTP_FOLLOW_UP_DAYS) || 3,
);

export type PtpTiming = 'TODAY' | 'UPCOMING' | 'MISSED' | 'FOLLOW_UP';

function parseLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function daysBetweenIso(from: string, to: string): number {
  const a = parseLocal(from).getTime();
  const b = parseLocal(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function effectivePromiseStatus(ptp: PromiseSubmission): PromiseSubmission['status'] {
  const overlay = getPromiseStatusOverlay(ptp.id);
  return overlay ?? ptp.status;
}

export function isActiveOpenPromise(ptp: PromiseSubmission): boolean {
  return effectivePromiseStatus(ptp) === 'OPEN';
}

export function classifyPtpTiming(promiseDate: string, today = todayISO()): PtpTiming {
  if (promiseDate > today) return 'UPCOMING';
  if (promiseDate === today) return 'TODAY';
  const elapsed = daysBetweenIso(promiseDate, today);
  if (elapsed >= PTP_FOLLOW_UP_AFTER_DAYS) return 'FOLLOW_UP';
  return 'MISSED';
}

export function ptpTimingLabel(timing: PtpTiming): string {
  switch (timing) {
    case 'TODAY': return 'Due today';
    case 'UPCOMING': return 'Upcoming';
    case 'MISSED': return 'Missed';
    case 'FOLLOW_UP': return 'Follow up';
  }
}
