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
import { withRetrySafeKey } from '@/lib/idempotency';
import type { Collection, CollectionKind, PayMode } from '@/mock/DataContext';

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
  /** Who received the money (server-set): ADMIN | STAFF | RECOVERY_AGENT | CUSTOMER. */
  collector_type?: Collection['collectorType'];
  collector_name?: string;
  collector_user_id?: number;
  /** UPI ID the payment was received at (approved agent UPI claims; server-set). */
  payee_vpa?: string;
  payee_name?: string;
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
    recordedOn: w.created_at ? w.created_at.slice(0, 10) : undefined,
    // Reports group receipts by this id; for an approved agent claim or a
    // customer proof the person who received the money is the collector, not
    // the admin who approved it.
    postedByUserId: w.collector_user_id ?? w.posted_by,
    collectorType: w.collector_type,
    collectorName: w.collector_name,
    payeeVpa: w.payee_vpa,
    payeeName: w.payee_name,
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

  /** Fetch EVERY payment, with no cap — the authoritative set for anything
   *  that SUMS money (dashboard KPIs, profit, charts).
   *
   *  list() above caps at 500 rows and returns them as a bare array with no
   *  total, so a book with more payments than that is silently truncated and
   *  every derived total reads low. Callers that need completeness must use
   *  this; list() stays for the single-day feed, which is bounded by the day. */
  async fetchAll(): Promise<Collection[]> {
    return this.fetchAllInRange();
  },

  /** Fetch EVERY payment within a date range, paging through the server's
   *  paginated feed (from/to/page → envelope with meta). Complete + authoritative
   *  for exports; the legacy list() caps at 500 and can't range.
   *
   *  NOTE: limit stays at 200 deliberately — the server clamps limit to 500
   *  (collection service maxFeedLimit) but computes total_pages from the
   *  REQUESTED limit, so asking for more than 500 yields a meta that claims
   *  one page while returning 500 rows. Paging under the clamp keeps meta honest. */
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
   *  The Idempotency-Key is tied to the payment's content (withRetrySafeKey):
   *  if the response is lost and the same payment is saved again, the retry
   *  carries the SAME key and the server returns the payment it already
   *  recorded instead of creating a second one — so a flaky connection can never
   *  double-charge a borrower. The UI's in-flight button guard covers
   *  double-clicks; this covers the network. */
  async record(loanId: number, c: Partial<Collection>): Promise<Collection> {
    const body = toWire(c);
    return toCollection(await withRetrySafeKey(`collection:${loanId}`, body, (key) =>
      api.post<CollectionWire>(`/loans/${loanId}/collections`, body, { headers: { 'Idempotency-Key': key } })));
  },

  /** Atomically swap `replaceIds` for `payments` on one loan.
   *
   *  The ledger's receipt-day edit rewrites a whole day's payments. Doing that
   *  as separate delete + record calls has no atomicity: a dropped connection
   *  part-way either destroys that day's money or leaves it double-counted.
   *  The server does the whole swap in ONE transaction, so the ledger can never
   *  be observed mid-edit. A retry after a lost response cannot double-count
   *  either: the originals are already deleted, so the server refuses it. */
  async replace(loanId: number, replaceIds: number[], payments: Partial<Collection>[]): Promise<Collection[]> {
    const rows = await api.post<CollectionWire[]>(
      `/loans/${loanId}/collections/replace`,
      { replace_ids: replaceIds, payments: payments.map(toWire) },
    );
    return rows.map(toCollection);
  },

  async update(id: number, c: Partial<Collection>): Promise<Collection> {
    return toCollection(await api.patch<CollectionWire>(`/collections/${id}`, toWire(c)));
  },

  async remove(id: number): Promise<void> {
    await api.delete(`/collections/${id}`);
  },

  /** Recovery agent: payments on the signed-in agent's assigned loans. */
  async agentList(): Promise<Collection[]> {
    return ((await api.get<CollectionWire[]>('/agent/collections')) ?? []).map(toCollection);
  },

  /** Borrower portal: every payment on the signed-in customer's loans. */
  async portalList(): Promise<Collection[]> {
    const rows = await api.get<CollectionWire[]>('/portal/collections');
    return (rows ?? []).map(toCollection);
  },
};
