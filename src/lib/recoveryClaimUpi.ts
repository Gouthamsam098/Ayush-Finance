/**
 * UPI ID snapshots for recovery-agent collection claims (no backend fields).
 * Persisted in localStorage so API-mode claims still show/report the VPA the agent selected.
 */

import type { Collection } from '@/mock/DataContext';
import type { CollectionClaimSubmission, RecoverySubmission } from '@/features/recovery/types';
import { resolveCollector } from '@/lib/collectionCollector';

const CLAIM_KEY = 'anush.recovery.claimUpi';
const COLLECTION_KEY = 'anush.recovery.collectionUpi';

export interface UpiSnapshot {
  payeeVpa: string;
  payeeName: string;
}

function readMap<T>(key: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, T>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap<T>(key: string, map: Record<string, T>) {
  localStorage.setItem(key, JSON.stringify(map));
}

export function rememberClaimUpi(claimId: string, snap: UpiSnapshot) {
  if (!claimId || !snap.payeeVpa.trim()) return;
  const map = readMap<UpiSnapshot>(CLAIM_KEY);
  map[claimId] = {
    payeeVpa: snap.payeeVpa.trim().toLowerCase(),
    payeeName: snap.payeeName.trim(),
  };
  writeMap(CLAIM_KEY, map);
}

export function rememberCollectionUpi(collectionId: number, snap: UpiSnapshot) {
  if (!collectionId || !snap.payeeVpa.trim()) return;
  const map = readMap<UpiSnapshot>(COLLECTION_KEY);
  map[String(collectionId)] = {
    payeeVpa: snap.payeeVpa.trim().toLowerCase(),
    payeeName: snap.payeeName.trim(),
  };
  writeMap(COLLECTION_KEY, map);
}

export function getClaimUpiSnapshot(claimId: string): UpiSnapshot | null {
  return readMap<UpiSnapshot>(CLAIM_KEY)[claimId] ?? null;
}

export function getCollectionUpiSnapshot(collectionId: number): UpiSnapshot | null {
  return readMap<UpiSnapshot>(COLLECTION_KEY)[String(collectionId)] ?? null;
}

/** Merge stored UPI onto a claim for display (API rows omit VPA). */
export function enrichCollectionClaim(claim: CollectionClaimSubmission): CollectionClaimSubmission {
  if (claim.mode !== 'UPI') {
    return { ...claim, payeeVpa: undefined, payeeName: undefined };
  }
  const stored = getClaimUpiSnapshot(claim.id);
  return {
    ...claim,
    payeeVpa: claim.payeeVpa?.trim() || stored?.payeeVpa,
    payeeName: claim.payeeName?.trim() || stored?.payeeName,
  };
}

export function upiSnapshotFromClaim(claim: CollectionClaimSubmission): UpiSnapshot | null {
  const c = enrichCollectionClaim(claim);
  if (c.mode !== 'UPI' || !c.payeeVpa) return null;
  return { payeeVpa: c.payeeVpa, payeeName: c.payeeName ?? '' };
}

/** UPI shown on a collection receipt (agent recovery UPI only). */
export function resolveCollectionUpi(c: Collection): UpiSnapshot | null {
  if (c.mode !== 'UPI') return null;
  if (c.payeeVpa?.trim()) {
    return { payeeVpa: c.payeeVpa.trim().toLowerCase(), payeeName: c.payeeName?.trim() ?? '' };
  }
  const stored = getCollectionUpiSnapshot(c.id);
  if (stored) return stored;
  return null;
}

/** Link approved UPI claims to collections for reports (API mode). */
export function syncApprovedClaimUpiToCollections(
  collections: Collection[],
  submissions: RecoverySubmission[],
) {
  for (const s of submissions) {
    if (s.type !== 'COLLECTION_CLAIM' || s.status !== 'APPROVED' || s.mode !== 'UPI') continue;
    const snap = upiSnapshotFromClaim(enrichCollectionClaim(s));
    if (!snap) continue;

    if (s.collectionId) {
      rememberCollectionUpi(s.collectionId, snap);
      continue;
    }

    const already = collections.find((c) => getCollectionUpiSnapshot(c.id)?.payeeVpa === snap.payeeVpa && c.loanId === s.loanId);
    if (already) continue;

    const match = collections.find((c) => {
      if (c.loanId !== s.loanId || c.mode !== 'UPI' || c.amount !== s.amount || c.date !== s.receiptDate) return false;
      if (getCollectionUpiSnapshot(c.id)) return false;
      const who = resolveCollector(c);
      return who.type === 'RECOVERY_AGENT';
    });
    if (match) rememberCollectionUpi(match.id, snap);
  }
}

export function formatUpiReportCells(c: Collection): [string, string] {
  const snap = resolveCollectionUpi(c);
  if (!snap) return ['—', '—'];
  return [snap.payeeVpa, snap.payeeName || '—'];
}
