/**
 * Collection (repayment) API calls, plus translation between the backend's
 * snake_case wire shape and the frontend's camelCase Collection type (defined
 * in DataContext). Money crosses the boundary as rupees; receipt numbers and
 * ids are minted server-side.
 *
 * Routes (see backend router):
 *   POST   /loans/{loanId}/collections   record a payment
 *   GET    /loans/{loanId}/collections   a loan's ledger
 *   GET    /collections?date=YYYY-MM-DD   cross-loan daily feed
 *   PATCH  /collections/{id}              edit a payment
 *   DELETE /collections/{id}              remove a payment
 */

import { api, type ListResult } from '@/lib/api';
import type { Collection, CollectionKind, PayMode } from '@/mock/DataContext';

/** Unique key for one logical payment write, so a retry is de-duplicated
 *  server-side. crypto.randomUUID is unavailable on older Safari and on
 *  non-secure origins, so fall back to random+timestamp — uniqueness per
 *  request is all that is required (the key is never a secret). */
function newIdempotencyKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

interface CollectionWire {
  id: number;
  receipt_no: string;
  loan_id: number;
  date: string;
  amount: number;
  mode: PayMode;
  kind: CollectionKind;
  remarks?: string;
  target_due_date?: string;
  posted_by?: number;
  created_at: string;
  updated_at: string;
}

function toCollection(w: CollectionWire): Collection {
  return {
    id: w.id,
    receiptNo: w.receipt_no,
    loanId: w.loan_id,
    date: w.date.slice(0, 10),
    amount: w.amount,
    mode: w.mode,
    kind: w.kind,
    remarks: w.remarks,
    targetDate: w.target_due_date ? w.target_due_date.slice(0, 10) : undefined,
  };
}

/** Body for record/update — the loan is addressed by URL, not the body. */
function toWire(c: Partial<Collection>): Record<string, unknown> {
  const w: Record<string, unknown> = {};
  if (c.amount !== undefined) w.amount = c.amount;
  if (c.date !== undefined) w.date = c.date;
  if (c.mode !== undefined) w.mode = c.mode;
  if (c.kind !== undefined) w.kind = c.kind;
  if (c.remarks !== undefined) w.remarks = c.remarks;
  if (c.targetDate !== undefined) w.target_due_date = c.targetDate;
  return w;
}

/** Server-side date-range filter for the Reports export. */
export interface CollectionReportFilters {
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
}

export const collectionApi = {
  /** All payments across loans (optionally for a single day) — the feed. */
  async list(date?: string): Promise<Collection[]> {
    const q = date ? `?date=${date}&limit=500` : '?limit=500';
    const rows = await api.get<CollectionWire[]>(`/collections${q}`);
    return (rows ?? []).map(toCollection);
  },

  /** Fetch EVERY payment within a date range, paging through the server's
   *  paginated feed (from/to/page → envelope with meta). Complete + authoritative
   *  for exports; the legacy list() caps at 500 and can't range. */
  async fetchAllInRange(f: CollectionReportFilters = {}): Promise<Collection[]> {
    const out: Collection[] = [];
    let page = 1;
    for (;;) {
      const p = new URLSearchParams({ page: String(page), limit: '200' });
      if (f.from) p.set('from', f.from);
      if (f.to) p.set('to', f.to);
      // page param alone triggers the server's paginated (envelope) mode.
      const res: ListResult<CollectionWire> = await api.getList<CollectionWire>(`/collections?${p.toString()}`);
      out.push(...res.data.map(toCollection));
      if (page >= (res.meta?.total_pages ?? 1) || res.data.length === 0) break;
      page += 1;
    }
    return out;
  },

  /** A single loan's ledger. */
  async listByLoan(loanId: number): Promise<Collection[]> {
    const rows = await api.get<CollectionWire[]>(`/loans/${loanId}/collections`);
    return (rows ?? []).map(toCollection);
  },

  /** Record a payment.
   *
   *  Sends a fresh Idempotency-Key per call. If the response is lost to a
   *  network timeout and the request is retried with the same key, the server
   *  returns the payment it already recorded instead of creating a second one —
   *  so a flaky connection can never double-charge a borrower. The UI's
   *  in-flight button guard covers double-clicks; this covers the network. */
  async record(loanId: number, c: Partial<Collection>): Promise<Collection> {
    return toCollection(await api.post<CollectionWire>(
      `/loans/${loanId}/collections`,
      toWire(c),
      { headers: { 'Idempotency-Key': newIdempotencyKey() } },
    ));
  },

  async update(id: number, c: Partial<Collection>): Promise<Collection> {
    return toCollection(await api.patch<CollectionWire>(`/collections/${id}`, toWire(c)));
  },

  async remove(id: number): Promise<void> {
    await api.delete(`/collections/${id}`);
  },
};
