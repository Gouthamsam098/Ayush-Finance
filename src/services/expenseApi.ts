/**
 * Expense API calls mapped to /api/v1/expenses, plus translation between the
 * backend's snake_case wire shape and the frontend's camelCase Expense type
 * (defined in DataContext). Money crosses the boundary as rupees; ids are minted
 * server-side.
 *
 * Routes (see backend router):
 *   POST   /expenses          create
 *   GET    /expenses          paginated list (newest first)
 *   GET    /expenses/{id}     read one
 *   PATCH  /expenses/{id}     edit
 *   DELETE /expenses/{id}     soft-delete
 */

import { api, type ListResult } from '@/lib/api';
import type { Expense, PayMode } from '@/mock/DataContext';

interface ExpenseWire {
  id: number;
  category: string;
  sub_category?: string;
  name: string;
  amount: number;
  mode: PayMode;
  date: string;
  remarks?: string;
  created_at: string;
  updated_at: string;
}

function toExpense(w: ExpenseWire): Expense {
  return {
    id: w.id,
    date: w.date.slice(0, 10),
    category: w.category,
    subCategory: w.sub_category,
    name: w.name,
    amount: w.amount,
    mode: w.mode,
    remarks: w.remarks,
  };
}

// Only send fields the backend accepts; omit undefined so a partial update
// doesn't overwrite untouched columns.
function toWire(e: Partial<Expense>): Record<string, unknown> {
  const w: Record<string, unknown> = {};
  if (e.date !== undefined) w.date = e.date;
  if (e.category !== undefined) w.category = e.category;
  if (e.subCategory !== undefined) w.sub_category = e.subCategory;
  if (e.name !== undefined) w.name = e.name;
  if (e.amount !== undefined) w.amount = e.amount;
  if (e.mode !== undefined) w.mode = e.mode;
  if (e.remarks !== undefined) w.remarks = e.remarks;
  return w;
}

/** Server-side filters for the Reports export. Empty fields are omitted. */
export interface ExpenseReportFilters {
  from?: string;     // YYYY-MM-DD
  to?: string;       // YYYY-MM-DD
  category?: string; // Personal | Office | Savings
  search?: string;
}

function expenseQuery(f: ExpenseReportFilters, page: number): string {
  const p = new URLSearchParams({ page: String(page), limit: '200' });
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.category) p.set('category', f.category);
  if (f.search) p.set('search', f.search);
  return p.toString();
}

export const expenseApi = {
  async list(): Promise<Expense[]> {
    // Pull a large page; server caps at 500. Filters/pagination UI can refine later.
    const res: ListResult<ExpenseWire> = await api.getList<ExpenseWire>('/expenses?limit=500');
    return res.data.map(toExpense);
  },

  /** Fetch EVERY expense matching the filters, paging through the server so an
   *  export is never truncated. */
  async fetchAll(f: ExpenseReportFilters = {}): Promise<Expense[]> {
    const out: Expense[] = [];
    let page = 1;
    for (;;) {
      const res: ListResult<ExpenseWire> = await api.getList<ExpenseWire>(`/expenses?${expenseQuery(f, page)}`);
      out.push(...res.data.map(toExpense));
      if (page >= (res.meta?.total_pages ?? 1) || res.data.length === 0) break;
      page += 1;
    }
    return out;
  },

  async create(e: Partial<Expense>): Promise<Expense> {
    return toExpense(await api.post<ExpenseWire>('/expenses', toWire(e)));
  },

  async update(id: number, e: Partial<Expense>): Promise<Expense> {
    return toExpense(await api.patch<ExpenseWire>(`/expenses/${id}`, toWire(e)));
  },

  async remove(id: number): Promise<void> {
    await api.delete(`/expenses/${id}`);
  },
};
