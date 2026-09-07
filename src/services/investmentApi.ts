/**
 * Investment API calls mapped to /api/v1/investments, plus translation between
 * the backend's snake_case wire shape and the frontend's camelCase types.
 *
 * The server is authoritative for all money math (interest per cycle, accrued,
 * due, next payout) — those arrive as derived fields rather than being
 * recomputed here, so the API and the UI can never disagree. The local helpers
 * in @/lib/investments remain the fallback for mock mode.
 */

import { api, type ListResult } from '@/lib/api';
import type { Investment, InvestorPayout, PayoutFrequency, PayMode } from '@/lib/investments';

interface InvestmentWire {
  id: number;
  code: string;
  investor_name: string;
  mobile?: string;
  email?: string;
  principal: number;
  rate: number;
  frequency: PayoutFrequency;
  start_date: string;
  status: 'ACTIVE' | 'CLOSED';
  settled_date?: string;
  notes?: string;
  // server-derived money figures
  interest_per_cycle: number;
  accrued_interest: number;
  interest_paid: number;
  interest_due: number;
  cycles_elapsed: number;
  next_payout_date?: string;
  created_at: string;
  updated_at: string;
}

/** Server-computed figures carried alongside the record, so the UI can render
 *  the authoritative numbers instead of recomputing them. */
export interface InvestmentDerived {
  interestPerCycle: number;
  accruedInterest: number;
  interestPaid: number;
  interestDue: number;
  cyclesElapsed: number;
  nextPayoutDate?: string;
}

export type InvestmentWithDerived = Investment & { derived: InvestmentDerived };

function toInvestment(w: InvestmentWire): InvestmentWithDerived {
  return {
    id: w.id,
    code: w.code,
    investorName: w.investor_name,
    mobile: w.mobile,
    email: w.email,
    principal: w.principal,
    rate: w.rate,
    frequency: w.frequency,
    startDate: w.start_date.slice(0, 10),
    status: w.status,
    settledDate: w.settled_date ? w.settled_date.slice(0, 10) : undefined,
    notes: w.notes,
    createdAt: w.created_at.slice(0, 10),
    derived: {
      interestPerCycle: w.interest_per_cycle,
      accruedInterest: w.accrued_interest,
      interestPaid: w.interest_paid,
      interestDue: w.interest_due,
      cyclesElapsed: w.cycles_elapsed,
      nextPayoutDate: w.next_payout_date ? w.next_payout_date.slice(0, 10) : undefined,
    },
  };
}

interface PayoutWire {
  id: number;
  investment_id: number;
  expense_id?: number;
  date: string;
  amount: number;
  mode: PayMode;
  remarks?: string;
  created_at: string;
}

const toPayout = (w: PayoutWire): InvestorPayout => ({
  id: w.id,
  investmentId: w.investment_id,
  date: w.date.slice(0, 10),
  amount: w.amount,
  mode: w.mode,
  remarks: w.remarks,
});

/** Only the raw inputs — the server derives every money figure. */
function toWire(i: Partial<Investment>): Record<string, unknown> {
  const w: Record<string, unknown> = {};
  if (i.investorName !== undefined) w.investor_name = i.investorName;
  if (i.mobile !== undefined) w.mobile = i.mobile || null;
  if (i.email !== undefined) w.email = i.email || null;
  if (i.principal !== undefined) w.principal = i.principal;
  if (i.rate !== undefined) w.rate = i.rate;
  if (i.frequency !== undefined) w.frequency = i.frequency;
  if (i.startDate !== undefined) w.start_date = i.startDate;
  if (i.notes !== undefined) w.notes = i.notes || null;
  return w;
}

/** Portfolio roll-up, computed server-side across ALL investments (never just
 *  the current page), so the KPI figures don't depend on pagination. */
export interface InvestmentTotalsWire {
  investors: number;
  active_count: number;
  capital: number;
  monthly_outgo: number;
  interest_due: number;
  interest_paid: number;
  overdue_count: number;
}

export const investmentApi = {
  /** Every investment (both statuses) — the page filters client-side.
   *
   *  Pages through the server rather than taking one capped page: a single
   *  ?limit=N request silently drops everything past N, and investor capital
   *  feeds the Available Funds KPI, so a short read understates the book. */
  async list(): Promise<InvestmentWithDerived[]> {
    const out: InvestmentWithDerived[] = [];
    let page = 1;
    for (;;) {
      const res: ListResult<InvestmentWire> =
        await api.getList<InvestmentWire>(`/investments?page=${page}&limit=200`);
      out.push(...res.data.map(toInvestment));
      if (page >= (res.meta?.total_pages ?? 1) || res.data.length === 0) break;
      page += 1;
    }
    return out;
  },

  async get(id: number): Promise<InvestmentWithDerived> {
    return toInvestment(await api.get<InvestmentWire>(`/investments/${id}`));
  },

  async create(i: Partial<Investment>): Promise<InvestmentWithDerived> {
    return toInvestment(await api.post<InvestmentWire>('/investments', toWire(i)));
  },

  async update(id: number, i: Partial<Investment>): Promise<InvestmentWithDerived> {
    return toInvestment(await api.patch<InvestmentWire>(`/investments/${id}`, toWire(i)));
  },

  async remove(id: number): Promise<void> {
    await api.delete(`/investments/${id}`);
  },

  /** Return the capital and close the investment (posts NO expense — returning
   *  borrowed money is not a cost). */
  async settle(id: number): Promise<InvestmentWithDerived> {
    return toInvestment(await api.post<InvestmentWire>(`/investments/${id}/settle`, {}));
  },

  async reopen(id: number): Promise<InvestmentWithDerived> {
    return toInvestment(await api.post<InvestmentWire>(`/investments/${id}/reopen`, {}));
  },

  async listPayouts(id: number): Promise<InvestorPayout[]> {
    const rows = await api.get<PayoutWire[]>(`/investments/${id}/payouts`);
    return (rows ?? []).map(toPayout);
  },

  /** Pay interest. The server writes the payout AND its Expenses row in ONE
   *  transaction, so a cost can never exist without the expense accounting for
   *  it — the frontend does not (and must not) post the expense separately. */
  async payInterest(id: number, p: { amount: number; date: string; mode: PayMode; remarks?: string }): Promise<InvestorPayout> {
    return toPayout(await api.post<PayoutWire>(`/investments/${id}/payouts`, {
      amount: p.amount, date: p.date, mode: p.mode, remarks: p.remarks ?? null,
    }));
  },

  async deletePayout(payoutId: number): Promise<void> {
    await api.delete(`/investments/payouts/${payoutId}`);
  },

  async totals(): Promise<InvestmentTotalsWire> {
    return api.get<InvestmentTotalsWire>('/investments/totals');
  },
};
