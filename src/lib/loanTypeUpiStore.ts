/**
 * Per-loan-type UPI settings: the UPI ID (and payee name) borrowers pay to.
 *
 * Demo mode (VITE_USE_API off): localStorage, as before.
 * API mode: stored on the server — staff read / admin save at
 * /settings/loan-type-upi, the borrower reads /portal/loan-type-upi and a
 * recovery agent /agent/loan-type-upi — so the portal on a borrower's own phone
 * shows what the admin saved. (Kept only in the admin's browser, it never
 * reached them.) Reads stay synchronous: they return an in-memory copy that
 * `refreshLoanTypeUpi()` loads, and every change fires LOAN_TYPE_UPI_CHANGED,
 * which the screens already listen to.
 */

import {
  LOAN_TYPE_UPI_ORDER,
  emptyLoanTypeUpiMap,
  isLoanTypeUpiComplete,
  mergeLoanTypeUpiMap,
  validateLoanTypeUpiMap,
  type LoanTypeUpiMap,
} from '@/lib/loanTypeUpi';
import { config } from '@/lib/config';
import { api, ApiError } from '@/lib/api';
import { tokenStore } from '@/lib/tokenStore';
import { store } from '@/store';

const STORAGE_KEY = 'anush.settings.loanTypeUpi';

export const LOAN_TYPE_UPI_CHANGED = 'anush:loan-type-upi-changed';

function notify() {
  window.dispatchEvent(new Event(LOAN_TYPE_UPI_CHANGED));
}

function readLocalMap(): LoanTypeUpiMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyLoanTypeUpiMap();
    const parsed = JSON.parse(raw) as Partial<LoanTypeUpiMap>;
    return mergeLoanTypeUpiMap(parsed);
  } catch {
    return emptyLoanTypeUpiMap();
  }
}

// ── API mode (backend) ───────────────────────────────────────────────────────

interface Wire {
  loan_types: Record<string, { payee_vpa: string; payee_name: string }>;
  complete: boolean;
}

/** Re-read from the server after this long, so an admin's change reaches open pages. */
const STALE_MS = 60_000;

const remote = {
  owner: '',
  map: emptyLoanTypeUpiMap(),
  /** A load has finished (successfully or not) since sign-in. */
  settled: false,
  fetchedAt: 0,
  inflight: null as Promise<void> | null,
};

function apiSession(): { path: string; owner: string } | null {
  if (!config.useApi || !tokenStore.get()) return null;
  const { accessToken, user } = store.getState().auth;
  if (!accessToken || !user) return null;
  const path = user.role === 'CUSTOMER'
    ? '/portal/loan-type-upi'
    : user.role === 'RECOVERY_AGENT'
      ? '/agent/loan-type-upi'
      : '/settings/loan-type-upi';
  return { path, owner: `${user.role}:${user.id}` };
}

function fromWire(w: Wire | null | undefined): LoanTypeUpiMap {
  const partial: Partial<LoanTypeUpiMap> = {};
  for (const t of LOAN_TYPE_UPI_ORDER) {
    const row = w?.loan_types?.[t];
    if (row) partial[t] = { payeeVpa: row.payee_vpa, payeeName: row.payee_name };
  }
  return mergeLoanTypeUpiMap(partial);
}

function setRemoteMap(next: LoanTypeUpiMap) {
  const changed = JSON.stringify(next) !== JSON.stringify(remote.map) || !remote.settled;
  remote.map = next;
  remote.settled = true;
  remote.fetchedAt = Date.now();
  if (changed) notify();
}

/** Load the settings from the server (API mode); resolves when done. */
export function refreshLoanTypeUpi(): Promise<void> {
  const s = apiSession();
  if (!s) return Promise.resolve();
  if (remote.owner !== s.owner) {
    remote.owner = s.owner;
    remote.map = emptyLoanTypeUpiMap();
    remote.settled = false;
    remote.fetchedAt = 0;
    remote.inflight = null;
  }
  if (remote.inflight) return remote.inflight;
  const owner = s.owner;
  const run = api.get<Wire>(s.path)
    .then((w) => {
      if (remote.owner === owner) setRemoteMap(fromWire(w));
    })
    .catch(() => {
      // Keep the last copy; the next read retries. Until something loads, the
      // portal says UPI is unavailable — which, right now, it is.
      if (remote.owner === owner && !remote.settled) {
        remote.settled = true;
        remote.fetchedAt = Date.now();
        notify();
      }
    })
    .finally(() => {
      if (remote.inflight === run) remote.inflight = null;
    });
  remote.inflight = run;
  return run;
}

function apiMap(): LoanTypeUpiMap {
  const s = apiSession();
  if (s && (remote.owner !== s.owner || Date.now() - remote.fetchedAt > STALE_MS)) void refreshLoanTypeUpi();
  return remote.map;
}

// ── public API (same signatures in both modes) ───────────────────────────────

export function readLoanTypeUpiMap(): LoanTypeUpiMap {
  return config.useApi ? apiMap() : readLocalMap();
}

/** False only while the first server load is still in flight (API mode). */
export function isLoanTypeUpiSettled(): boolean {
  if (!config.useApi) return true;
  const s = apiSession();
  return !!s && remote.owner === s.owner && remote.settled;
}

/**
 * Settings saved in THIS browser before they moved to the server, when the
 * server has none yet — offered to the admin to save, never applied silently.
 */
export function readLegacyLocalLoanTypeUpiMap(): LoanTypeUpiMap | null {
  if (!config.useApi) return null;
  const local = readLocalMap();
  return isLoanTypeUpiComplete(local) ? local : null;
}

/** Saves all six rows. Resolves to null on success, or a message for a toast. */
export async function saveLoanTypeUpiMap(map: LoanTypeUpiMap): Promise<string | null> {
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
  if (config.useApi) {
    const loanTypes: Wire['loan_types'] = {};
    for (const t of LOAN_TYPE_UPI_ORDER) {
      loanTypes[t] = { payee_vpa: normalized[t].payeeVpa, payee_name: normalized[t].payeeName };
    }
    try {
      setRemoteMap(fromWire(await api.put<Wire>('/settings/loan-type-upi', { loan_types: loanTypes })));
      return null;
    } catch (e) {
      if (e instanceof ApiError) {
        const fieldMsgs = Object.values(e.fields ?? {}).filter(Boolean);
        return fieldMsgs.length > 0 ? `${e.message} ${fieldMsgs[0]}` : e.message;
      }
      return 'Could not reach the server. Check your connection and try again.';
    }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  notify();
  return null;
}

export function isPortalLoanTypeUpiReady(): boolean {
  return isLoanTypeUpiComplete(readLoanTypeUpiMap());
}
