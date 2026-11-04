/**
 * Local promise field edits when the API has no update endpoint yet.
 * Merged on read so agent UI keeps the updated date/amount/note after save and poll.
 */

import type { PromiseSubmission, RecoverySubmission } from '@/features/recovery/types';

const KEY = 'anush.recovery.ptpLocalPatch';

export interface PromiseLocalPatch {
  promiseDate: string;
  promisedAmount?: number;
  note?: string;
}

function readMap(): Record<string, PromiseLocalPatch> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PromiseLocalPatch>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, PromiseLocalPatch>) {
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function setPromiseLocalPatch(id: string, patch: PromiseLocalPatch) {
  const map = readMap();
  map[id] = patch;
  writeMap(map);
}

export function getPromiseLocalPatch(id: string): PromiseLocalPatch | null {
  const p = readMap()[id];
  if (!p || typeof p.promiseDate !== 'string' || !p.promiseDate) return null;
  return p;
}

export function clearPromiseLocalPatch(id: string) {
  const map = readMap();
  if (!(id in map)) return;
  delete map[id];
  writeMap(map);
}

export function applySubmissionLocalPatches(s: RecoverySubmission): RecoverySubmission {
  if (s.type !== 'PROMISE_TO_PAY') return s;
  const patch = getPromiseLocalPatch(s.id);
  if (!patch) return s;
  return {
    ...s,
    promiseDate: patch.promiseDate,
    promisedAmount: patch.promisedAmount,
    note: patch.note ?? '',
  } as PromiseSubmission;
}
