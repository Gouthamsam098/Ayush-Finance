/**
 * Loan API calls mapped to /api/v1/loans, plus translation between the backend's
 * snake_case wire shape and the frontend's camelCase Loan type (defined in
 * DataContext). The server is authoritative for all money math (interest,
 * deduction, daily/EMI amount, term, next-due date) — we send only the raw
 * inputs and read the derived values back.
 */

import { api, type ListResult } from '@/lib/api';
import type { Loan, LoanType } from '@/mock/DataContext';

interface LoanWire {
  id: number;
  loan_number: string;
  customer_id: number;
  type: LoanType;
  repayment_mode?: 'EMI' | 'MONTHLY_INTEREST';
  principal: number;
  rate: number;
  interest: number;
  deduction?: number;
  disbursed_amount: number; // net cash given = principal − deduction (server-derived, always present)
  instalment_amount?: number; // per-period amount (daily / EMI / interest); frontend calls it dailyAmount
  num_days?: number;
  loan_date: string;
  next_due_date?: string;
  status: 'ACTIVE' | 'CLOSED';
  contact?: string;
  remarks?: string;
  vehicle_number?: string;
  vehicle_brand?: string;
  vehicle_name?: string;
  outstanding: number;
  created_at: string;
  updated_at: string;
}

function toLoan(w: LoanWire): Loan {
  return {
    id: w.id,
    loanNumber: w.loan_number,
    customerId: w.customer_id,
    type: w.type,
    repaymentMode: w.repayment_mode,
    principal: w.principal,
    rate: w.rate,
    interest: w.interest,
    deduction: w.deduction,
    disbursed: w.disbursed_amount,
    dailyAmount: w.instalment_amount,
    numDays: w.num_days,
    loanDate: w.loan_date.slice(0, 10),
    nextDueDate: w.next_due_date ? w.next_due_date.slice(0, 10) : undefined,
    status: w.status,
    contact: w.contact,
    remarks: w.remarks,
    vehicleNumber: w.vehicle_number,
    vehicleBrand: w.vehicle_brand,
    vehicleName: w.vehicle_name,
  };
}

/** Only the raw inputs — the server derives interest/EMI/term/dates. numDays
 *  carries months (EMI) or days (Flexible); it's ignored server-side otherwise. */
function toWire(l: Partial<Loan>): Record<string, unknown> {
  const w: Record<string, unknown> = {};
  if (l.customerId !== undefined) w.customer_id = l.customerId;
  if (l.type !== undefined) w.type = l.type;
  if (l.repaymentMode !== undefined) w.repayment_mode = l.repaymentMode;
  if (l.principal !== undefined) w.principal = l.principal;
  if (l.rate !== undefined) w.rate = l.rate;
  if (l.loanDate !== undefined) w.loan_date = l.loanDate;
  if (l.numDays !== undefined) w.num_days = l.numDays;
  if (l.contact !== undefined) w.contact = l.contact;
  if (l.remarks !== undefined) w.remarks = l.remarks;
  if (l.vehicleNumber !== undefined) w.vehicle_number = l.vehicleNumber;
  if (l.vehicleBrand !== undefined) w.vehicle_brand = l.vehicleBrand;
  if (l.vehicleName !== undefined) w.vehicle_name = l.vehicleName;
  return w;
}

/** Server-side filters for the Reports export. Empty fields are omitted. */
export interface LoanReportFilters {
  from?: string;   // YYYY-MM-DD, on loan_date
  to?: string;     // YYYY-MM-DD, on loan_date
  status?: string; // ACTIVE | CLOSED
  type?: string;   // LoanType
  search?: string;
}

function loanQuery(f: LoanReportFilters, page: number): string {
  const p = new URLSearchParams({ page: String(page), limit: '100' });
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.status) p.set('status', f.status);
  if (f.type) p.set('type', f.type);
  if (f.search) p.set('search', f.search);
  return p.toString();
}

export const loanApi = {
  async list(): Promise<Loan[]> {
    const res: ListResult<LoanWire> = await api.getList<LoanWire>('/loans?limit=100');
    return res.data.map(toLoan);
  },

  /** Fetch EVERY loan matching the filters, paging through the server so the
   *  export is never silently truncated (the plain list() caps at 100). */
  async fetchAll(f: LoanReportFilters = {}): Promise<Loan[]> {
    const out: Loan[] = [];
    let page = 1;
    for (;;) {
      const res: ListResult<LoanWire> = await api.getList<LoanWire>(`/loans?${loanQuery(f, page)}`);
      out.push(...res.data.map(toLoan));
      if (page >= (res.meta?.total_pages ?? 1) || res.data.length === 0) break;
      page += 1;
    }
    return out;
  },

  async create(l: Partial<Loan>): Promise<Loan> {
    return toLoan(await api.post<LoanWire>('/loans', toWire(l)));
  },

  async update(id: number, l: Partial<Loan>): Promise<Loan> {
    return toLoan(await api.patch<LoanWire>(`/loans/${id}`, toWire(l)));
  },

  async close(id: number): Promise<Loan> {
    return toLoan(await api.post<LoanWire>(`/loans/${id}/close`, {}));
  },

  async reopen(id: number): Promise<Loan> {
    return toLoan(await api.post<LoanWire>(`/loans/${id}/reopen`, {}));
  },

  async remove(id: number): Promise<void> {
    await api.delete(`/loans/${id}`);
  },
};
