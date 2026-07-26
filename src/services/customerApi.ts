/**
 * Customer API calls mapped to /api/v1/customers, plus translation between the
 * backend's snake_case wire shape and the frontend's camelCase Customer type
 * (defined in DataContext). Keeping the mapping here means DataContext and the
 * pages never see the wire format.
 */

import { api, type ListResult } from '@/lib/api';
import type { Customer } from '@/mock/DataContext';

interface CustomerWire {
  id: number;
  code: string;
  name: string;
  father_name?: string;
  mobile: string;
  alt_mobile?: string;
  email?: string;
  date_of_birth?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  occupation?: string;
  monthly_income?: number;
  reference_name?: string;
  reference_mobile?: string;
  aadhaar_masked?: string;
  pan_masked?: string;
  has_aadhaar?: boolean;
  has_pan?: boolean;
  created_at: string;
  updated_at: string;
}

function toCustomer(w: CustomerWire): Customer {
  return {
    id: w.id,
    code: w.code,
    name: w.name,
    fatherName: w.father_name,
    mobile: w.mobile,
    altMobile: w.alt_mobile,
    email: w.email,
    dateOfBirth: w.date_of_birth,
    address: w.address,
    city: w.city,
    state: w.state,
    pincode: w.pincode,
    occupation: w.occupation,
    monthlyIncome: w.monthly_income,
    referenceName: w.reference_name,
    referenceMobile: w.reference_mobile,
    aadhaarMasked: w.aadhaar_masked,
    panMasked: w.pan_masked,
    hasAadhaar: w.has_aadhaar,
    hasPan: w.has_pan,
    createdAt: w.created_at.slice(0, 10),
  };
}

// Only send fields the backend accepts; omit undefined so we don't overwrite
// with nulls on update.
function toWire(c: Partial<Customer>): Record<string, unknown> {
  const w: Record<string, unknown> = {};
  if (c.name !== undefined) w.name = c.name;
  if (c.fatherName !== undefined) w.father_name = c.fatherName;
  if (c.mobile !== undefined) w.mobile = c.mobile;
  if (c.altMobile !== undefined) w.alt_mobile = c.altMobile;
  if (c.email !== undefined) w.email = c.email;
  if (c.dateOfBirth !== undefined) w.date_of_birth = c.dateOfBirth;
  if (c.address !== undefined) w.address = c.address;
  if (c.city !== undefined) w.city = c.city;
  if (c.state !== undefined) w.state = c.state;
  if (c.pincode !== undefined) w.pincode = c.pincode;
  if (c.occupation !== undefined) w.occupation = c.occupation;
  if (c.monthlyIncome !== undefined) w.monthly_income = c.monthlyIncome;
  if (c.referenceName !== undefined) w.reference_name = c.referenceName;
  if (c.referenceMobile !== undefined) w.reference_mobile = c.referenceMobile;
  // Raw KYC values only sent when the user entered them (create/edit).
  if (c.aadhaar !== undefined) w.aadhaar_number = c.aadhaar;
  if (c.pan !== undefined) w.pan_number = c.pan;
  return w;
}

/** Server-side filters for the Reports export. Empty fields are omitted. */
export interface CustomerReportFilters {
  from?: string; // YYYY-MM-DD, on created_at date
  to?: string;   // YYYY-MM-DD, on created_at date
  search?: string;
}

function customerQuery(f: CustomerReportFilters, page: number): string {
  const p = new URLSearchParams({ page: String(page), limit: '100' });
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.search) p.set('search', f.search);
  return p.toString();
}

export const customerApi = {
  async list(): Promise<Customer[]> {
    // Pull a large page; server caps at 100. Pagination UI can refine later.
    const res: ListResult<CustomerWire> = await api.getList<CustomerWire>('/customers?limit=100');
    return res.data.map(toCustomer);
  },

  /** Fetch EVERY customer matching the filters, paging through the server so an
   *  export is never truncated (the server caps a single page at 100). */
  async fetchAll(f: CustomerReportFilters = {}): Promise<Customer[]> {
    const out: Customer[] = [];
    let page = 1;
    for (;;) {
      const res: ListResult<CustomerWire> = await api.getList<CustomerWire>(`/customers?${customerQuery(f, page)}`);
      out.push(...res.data.map(toCustomer));
      if (page >= (res.meta?.total_pages ?? 1) || res.data.length === 0) break;
      page += 1;
    }
    return out;
  },

  async create(c: Partial<Customer>): Promise<Customer> {
    return toCustomer(await api.post<CustomerWire>('/customers', toWire(c)));
  },

  async update(id: number, c: Partial<Customer>): Promise<Customer> {
    return toCustomer(await api.patch<CustomerWire>(`/customers/${id}`, toWire(c)));
  },

  async remove(id: number): Promise<void> {
    await api.delete(`/customers/${id}`);
  },
};
