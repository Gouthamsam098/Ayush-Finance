/**
 * Customer UPI payment screenshots.
 *
 * Demo mode (VITE_USE_API off): stored in localStorage, as before.
 * API mode: stored on the backend (/portal/payment-proofs for the borrower,
 * /payment-proofs for staff). Accepting a proof records its payment as
 * collections server-side, then COLLECTIONS_CHANGED_EVENT makes DataContext
 * refetch so the Dashboard / Collections / portal show the money.
 *
 * The exported functions keep their synchronous signatures and the
 * `PaymentProofRecord` shape, because the portal and Collections components
 * call them during render. In API mode they read an in-memory copy of the
 * server list that refreshes in the background, and announce every change
 * through PAYMENT_PROOF_SUBMITTED_EVENT, which those components already listen to.
 */

import type { PortalPayPurpose } from '@/features/customer-portal/loanPortalSummary';
import { config } from '@/lib/config';
import { api, ApiError } from '@/lib/api';
import { tokenStore } from '@/lib/tokenStore';
import { COLLECTIONS_CHANGED_EVENT } from '@/lib/dataEvents';
import { store } from '@/store';

export const PAYMENT_PROOF_STORAGE_KEY = 'anush.portal.paymentProofs';

export const PAYMENT_PROOF_SUBMITTED_EVENT = 'anush:payment-proof-submitted';
export const PAYMENT_PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const PAYMENT_PROOF_ACCEPT = 'image/jpeg,image/png,image/webp';

export type PaymentProofStatus = 'pending' | 'verified' | 'rejected';

export interface PaymentProofRecord {
  id: string;
  loanId: number;
  customerId: number;
  loanNumber: string;
  fileName: string;
  mimeType: string;
  /** Inline image. API mode: filled in once the screenshot has been fetched. */
  dataUrl: string;
  amountRupees: number;
  purpose: PortalPayPurpose;
  submittedAt: string;
  status: PaymentProofStatus;
}

// ── demo mode (localStorage) ─────────────────────────────────────────────────

function readAll(): PaymentProofRecord[] {
  try {
    const raw = localStorage.getItem(PAYMENT_PROOF_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PaymentProofRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(rows: PaymentProofRecord[]) {
  localStorage.setItem(PAYMENT_PROOF_STORAGE_KEY, JSON.stringify(rows));
}

// ── API mode (backend) ───────────────────────────────────────────────────────

interface ProofWire {
  id: number;
  loan_id: number;
  loan_number: string;
  customer_id: number;
  amount: number;
  purpose: PortalPayPurpose;
  file_name: string;
  mime_type: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  submitted_at: string;
}

const STATUS_FROM_WIRE: Record<ProofWire['status'], PaymentProofStatus> = {
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
};

/** How long a fetched list counts as fresh before a read triggers a refetch. */
const STALE_MS = 15_000;
/** Background refresh while a page is open, so new uploads / reviews appear. */
const POLL_MS = 30_000;
/** Screenshots kept in memory for the staff list: every pending proof, plus
 *  this many of the most recent reviewed ones (each can be up to 5 MB). */
const RECENT_REVIEWED_IMAGES = 20;

const remote = {
  owner: '',
  rows: [] as PaymentProofRecord[],
  images: new Map<string, string>(),
  loadingImages: new Set<string>(),
  fetchedAt: 0,
  inflight: false,
  /** Another refresh was asked for while one was in flight — run it after. */
  rerun: false,
  /** Bumped by every local write, so an older in-flight list can't overwrite it. */
  version: 0,
  pollTimer: 0 as number,
};

type Scope = 'portal' | 'staff';

/** The signed-in API session, or null (logged out / demo token). */
function apiSession(): { scope: Scope; owner: string } | null {
  if (!config.useApi || !tokenStore.get()) return null;
  const { accessToken, user } = store.getState().auth;
  // Recovery agents neither upload nor review proofs (their staff list is a 403).
  if (!accessToken || !user || user.role === 'RECOVERY_AGENT') return null;
  const scope: Scope = user.role === 'CUSTOMER' ? 'portal' : 'staff';
  return { scope, owner: `${scope}:${user.id}` };
}

const basePath = (scope: Scope) => (scope === 'portal' ? '/portal/payment-proofs' : '/payment-proofs');

function toRecord(w: ProofWire): PaymentProofRecord {
  const id = String(w.id);
  return {
    id,
    loanId: w.loan_id,
    customerId: w.customer_id,
    loanNumber: w.loan_number,
    fileName: w.file_name,
    mimeType: w.mime_type,
    dataUrl: remote.images.get(id) ?? '',
    amountRupees: w.amount,
    purpose: w.purpose,
    submittedAt: w.submitted_at,
    status: STATUS_FROM_WIRE[w.status] ?? 'pending',
  };
}

function emit(record?: PaymentProofRecord) {
  window.dispatchEvent(new CustomEvent(PAYMENT_PROOF_SUBMITTED_EVENT, { detail: record }));
}

/** One event per loan (its latest proof), so per-loan listeners refresh too. */
function emitAll() {
  const latestByLoan = new Map<number, PaymentProofRecord>();
  for (const r of remote.rows) {
    const cur = latestByLoan.get(r.loanId);
    if (!cur || r.submittedAt > cur.submittedAt) latestByLoan.set(r.loanId, r);
  }
  if (latestByLoan.size === 0) emit();
  latestByLoan.forEach((r) => emit(r));
}

/** Drop the cached list when a different user signs in on this tab. */
function syncOwner(owner: string) {
  if (remote.owner === owner) return;
  remote.owner = owner;
  remote.rows = [];
  remote.images.clear();
  remote.loadingImages.clear();
  remote.fetchedAt = 0;
  remote.version += 1;
}

function startPolling() {
  if (remote.pollTimer) return;
  remote.pollTimer = window.setInterval(() => {
    // Signed out: stop polling and drop the cached proofs and screenshots.
    if (!apiSession()) {
      window.clearInterval(remote.pollTimer);
      remote.pollTimer = 0;
      syncOwner('');
      return;
    }
    if (document.visibilityState === 'visible') refreshRemote(true);
  }, POLL_MS);
}

function refreshRemote(force = false) {
  const s = apiSession();
  if (!s) return;
  syncOwner(s.owner);
  startPolling();
  if (remote.inflight) {
    if (force) remote.rerun = true;
    return;
  }
  if (!force && Date.now() - remote.fetchedAt < STALE_MS) return;
  remote.inflight = true;
  remote.fetchedAt = Date.now();
  const owner = s.owner;
  const version = remote.version;
  api.get<ProofWire[]>(basePath(s.scope))
    .then((list) => {
      if (remote.owner !== owner) return;
      // A write landed while this list was in flight: it is older than what we
      // show, so drop it and fetch again.
      if (remote.version !== version) {
        remote.rerun = true;
        return;
      }
      const before = new Map(remote.rows.map((r) => [r.id, r.status]));
      const uploading = remote.rows.filter((r) => r.id.startsWith('tmp-'));
      const next = [...uploading, ...(list ?? []).map(toRecord)];
      const changed = next.length !== remote.rows.length
        || next.some((r) => before.get(r.id) !== r.status);
      // A proof accepted elsewhere (staff on another device, or the borrower
      // seeing their proof accepted) means new collections on the server.
      const newlyVerified = next.some((r) => r.status === 'verified' && before.has(r.id) && before.get(r.id) !== 'verified');
      remote.rows = next;
      // Free screenshots of proofs that are no longer listed.
      const listed = new Set(next.map((r) => r.id));
      for (const id of [...remote.images.keys()]) if (!listed.has(id)) remote.images.delete(id);
      if (changed) emitAll();
      if (newlyVerified) window.dispatchEvent(new Event(COLLECTIONS_CHANGED_EVENT));
      if (s.scope === 'staff') loadImages(owner, s.scope);
    })
    .catch(() => { /* keep the last list; the next read or poll retries */ })
    .finally(() => {
      remote.inflight = false;
      if (remote.rerun) {
        remote.rerun = false;
        refreshRemote(true);
      }
    });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Fetch screenshots one at a time (authenticated), newest/pending first. */
async function loadImages(owner: string, scope: Scope) {
  const keep = [
    ...remote.rows.filter((r) => r.status === 'pending'),
    ...remote.rows.filter((r) => r.status !== 'pending').slice(0, RECENT_REVIEWED_IMAGES),
  ];
  const keepIds = new Set(keep.map((r) => r.id));
  for (const id of [...remote.images.keys()]) if (!keepIds.has(id)) remote.images.delete(id);
  const wanted = keep
    .filter((r) => !r.id.startsWith('tmp-') && !remote.images.has(r.id) && !remote.loadingImages.has(r.id));
  for (const r of wanted) {
    if (remote.owner !== owner) return;
    remote.loadingImages.add(r.id);
    try {
      const res = await fetch(`${config.apiBaseUrl}${basePath(scope)}/${r.id}/image`, {
        headers: { Authorization: `Bearer ${tokenStore.get() ?? ''}` },
      });
      if (!res.ok) continue;
      const dataUrl = await blobToDataUrl(await res.blob());
      if (remote.owner !== owner) return;
      remote.images.set(r.id, dataUrl);
      const idx = remote.rows.findIndex((x) => x.id === r.id);
      if (idx >= 0) {
        remote.rows[idx] = { ...remote.rows[idx], dataUrl };
        emit(remote.rows[idx]);
      }
    } catch {
      /* image stays blank; retried on the next refresh */
    } finally {
      remote.loadingImages.delete(r.id);
    }
  }
}

function replaceRow(id: string, row: PaymentProofRecord | null) {
  remote.version += 1;
  const idx = remote.rows.findIndex((r) => r.id === id);
  if (idx < 0) return;
  if (row) remote.rows[idx] = row;
  else remote.rows.splice(idx, 1);
}

/** The message shown when the server refuses a proof action. */
function errorText(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    const fieldMsgs = Object.values(e.fields ?? {}).filter(Boolean);
    return fieldMsgs.length > 0 ? fieldMsgs.join(' · ') : e.message;
  }
  return fallback;
}

const OFFLINE_MSG = 'Could not reach the server. Check your connection and try again.';

/**
 * Staff accept ('verified') or reject, waiting for the server. Resolves to
 * null on success, or the server's reason (e.g. the amount now exceeds the
 * outstanding) so the screen can show it instead of a false success.
 */
export async function reviewPaymentProof(id: string, status: 'verified' | 'rejected'): Promise<string | null> {
  if (!config.useApi) {
    return setPaymentProofStatus(id, status) ? null : 'Could not update proof status';
  }
  if (!remote.rows.some((r) => r.id === id)) return 'This proof is no longer available. Refresh and try again.';
  try {
    const w = await api.post<ProofWire>(`/payment-proofs/${id}/${status === 'verified' ? 'verify' : 'reject'}`, {});
    const saved = toRecord(w);
    replaceRow(id, saved);
    emit(saved);
    if (saved.status === 'verified') window.dispatchEvent(new Event(COLLECTIONS_CHANGED_EVENT));
    return null;
  } catch (e) {
    refreshRemote(true);
    return errorText(e, OFFLINE_MSG);
  }
}

/**
 * Borrower uploads a screenshot, waiting for the server. Resolves to null on
 * success, or the reason it was refused (too many pending, not an image…).
 */
export async function submitPaymentProof(input: Omit<PaymentProofRecord, 'id' | 'status' | 'submittedAt'>): Promise<string | null> {
  if (!config.useApi) {
    persistPaymentProof(input);
    return null;
  }
  try {
    const w = await uploadProof(input);
    const saved = { ...toRecord(w), dataUrl: input.dataUrl };
    remote.images.set(saved.id, input.dataUrl);
    remote.version += 1;
    remote.rows = [saved, ...remote.rows.filter((r) => r.id !== saved.id)];
    emit(saved);
    return null;
  } catch (e) {
    return errorText(e, 'Upload failed. ' + OFFLINE_MSG);
  }
}

function apiRows(): PaymentProofRecord[] {
  refreshRemote();
  return remote.rows;
}

// ── public API (same signatures in both modes) ───────────────────────────────

export function listPaymentProofs(): PaymentProofRecord[] {
  const rows = config.useApi ? [...apiRows()] : readAll();
  return rows.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

export function countPendingPaymentProofs(): number {
  const rows = config.useApi ? apiRows() : readAll();
  return rows.filter((r) => r.status === 'pending').length;
}

/** Pending submission count per loan (multiple uploads increment the count). */
export function pendingProofCountByLoanId(): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const row of config.useApi ? apiRows() : readAll()) {
    if (row.status !== 'pending') continue;
    counts[row.loanId] = (counts[row.loanId] ?? 0) + 1;
  }
  return counts;
}

export function getLatestPaymentProof(loanId: number): PaymentProofRecord | null {
  const forLoan = (config.useApi ? apiRows() : readAll())
    .filter((r) => r.loanId === loanId)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  return forLoan[0] ?? null;
}

/**
 * Staff accept ('verified') or reject. API mode: the change shows at once and
 * the server call runs behind it; accepting records the payment server-side. If
 * the server refuses (e.g. the amount now exceeds the outstanding because cash
 * was recorded meanwhile), the proof returns to pending.
 */
export function setPaymentProofStatus(id: string, status: PaymentProofStatus): PaymentProofRecord | null {
  if (config.useApi) {
    const current = remote.rows.find((r) => r.id === id);
    if (!current || id.startsWith('tmp-') || status === 'pending') return null;
    const optimistic = { ...current, status };
    replaceRow(id, optimistic);
    emit(optimistic);
    api.post<ProofWire>(`/payment-proofs/${id}/${status === 'verified' ? 'verify' : 'reject'}`, {})
      .then((w) => {
        const saved = toRecord(w);
        replaceRow(id, saved);
        emit(saved);
        if (saved.status === 'verified') window.dispatchEvent(new Event(COLLECTIONS_CHANGED_EVENT));
      })
      .catch((e) => {
        console.error('Payment proof review failed', e);
        replaceRow(id, current);
        emit(current);
        refreshRemote(true);
      });
    return optimistic;
  }
  const rows = readAll();
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const next = { ...rows[idx], status };
  rows[idx] = next;
  writeAll(rows);
  window.dispatchEvent(new CustomEvent(PAYMENT_PROOF_SUBMITTED_EVENT, { detail: next }));
  return next;
}

/**
 * Borrower submits a screenshot. API mode: shown as pending at once and
 * uploaded behind it; if the server refuses the upload, it is withdrawn again.
 */
export function persistPaymentProof(input: Omit<PaymentProofRecord, 'id' | 'status' | 'submittedAt'>): PaymentProofRecord {
  const record: PaymentProofRecord = {
    ...input,
    id: `${config.useApi ? 'tmp' : 'pp'}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    submittedAt: new Date().toISOString(),
    status: 'pending',
  };
  if (config.useApi) {
    refreshRemote();
    remote.rows = [record, ...remote.rows];
    emit(record);
    uploadProof(input)
      .then((w) => {
        const saved = toRecord(w);
        remote.images.set(saved.id, input.dataUrl);
        replaceRow(record.id, { ...saved, dataUrl: input.dataUrl });
        emit(saved);
      })
      .catch((e) => {
        console.error('Payment proof upload failed', e);
        replaceRow(record.id, null);
        emit(record);
      });
    return record;
  }
  writeAll([record, ...readAll()]);
  window.dispatchEvent(new CustomEvent(PAYMENT_PROOF_SUBMITTED_EVENT, { detail: record }));
  return record;
}

async function uploadProof(input: Omit<PaymentProofRecord, 'id' | 'status' | 'submittedAt'>): Promise<ProofWire> {
  const blob = await (await fetch(input.dataUrl)).blob();
  const fd = new FormData();
  fd.append('loan_id', String(input.loanId));
  fd.append('amount', String(input.amountRupees));
  fd.append('purpose', input.purpose);
  fd.append('file', new File([blob], input.fileName || 'payment.png', { type: input.mimeType || blob.type }));
  return api.upload<ProofWire>('/portal/payment-proofs', fd);
}
