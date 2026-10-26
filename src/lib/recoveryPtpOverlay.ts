/**
 * Manual promise close (FULFILLED / CANCELLED) when API has no endpoint yet.
 * Demo mode updates submission status directly; API mode uses this overlay.
 */

import type { PromiseSubmission } from '@/features/recovery/types';

const KEY = 'anush.recovery.ptpStatusOverlay';

type Closed = PromiseSubmission['status'];

function readMap(): Record<string, Closed> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Closed>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, Closed>) {
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function getPromiseStatusOverlay(id: string): Closed | null {
  const v = readMap()[id];
  return v === 'FULFILLED' || v === 'CANCELLED' ? v : null;
}

export function setPromiseStatusOverlay(id: string, status: 'FULFILLED' | 'CANCELLED') {
  const map = readMap();
  map[id] = status;
  writeMap(map);
}

export function clearPromiseStatusOverlay(id: string) {
  const map = readMap();
  delete map[id];
  writeMap(map);
}
