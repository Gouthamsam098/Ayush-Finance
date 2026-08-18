import type { Customer, Loan, LoanType } from '@/mock/DataContext';

/** Numeric comparison operators offered for count/amount filters. */
export type NumOp = 'any' | 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'between';

export const NUM_OPS: { value: NumOp; label: string; symbol: string }[] = [
  { value: 'any', label: 'Any', symbol: '∗' },
  { value: 'gt', label: 'Greater than', symbol: '>' },
  { value: 'gte', label: 'At least', symbol: '≥' },
  { value: 'lt', label: 'Less than', symbol: '<' },
  { value: 'lte', label: 'At most', symbol: '≤' },
  { value: 'eq', label: 'Equal to', symbol: '=' },
  { value: 'between', label: 'Between', symbol: '↔' },
];

/** A single numeric filter: an operator plus one or two operands. */
export interface NumFilter { op: NumOp; a: number | null; b: number | null; }
export const emptyNum = (): NumFilter => ({ op: 'any', a: null, b: null });

/** Does a value satisfy a numeric filter? A null operand means "unbounded". */
export function matchNum(value: number, f: NumFilter): boolean {
  const { op, a, b } = f;
  if (op === 'any') return true;
  if (op === 'between') {
    if (a != null && value < a) return false;
    if (b != null && value > b) return false;
    return true;
  }
  if (a == null) return true; // operator chosen but no value yet → don't exclude
  switch (op) {
    case 'gt': return value > a;
    case 'gte': return value >= a;
    case 'lt': return value < a;
    case 'lte': return value <= a;
    case 'eq': return value === a;
    default: return true;
  }
}

/** Is a numeric filter actually constraining anything? */
export function numActive(f: NumFilter): boolean {
  if (f.op === 'any') return false;
  if (f.op === 'between') return f.a != null || f.b != null;
  return f.a != null;
}

/** Short human label for an active numeric filter, e.g. "≥ ₹1L". */
export function numLabel(f: NumFilter, fmt: (n: number) => string): string {
  if (!numActive(f)) return '';
  if (f.op === 'between') {
    const lo = f.a != null ? fmt(f.a) : '…';
    const hi = f.b != null ? fmt(f.b) : '…';
    return `${lo} – ${hi}`;
  }
  const sym = NUM_OPS.find((o) => o.value === f.op)?.symbol ?? '';
  return `${sym} ${fmt(f.a as number)}`;
}

export type StatusFilter = '' | 'ACTIVE' | 'INACTIVE';
export type KycFilter = '' | 'VERIFIED' | 'PENDING';

/** The complete customer filter set. */
export interface CustomerFilters {
  status: StatusFilter;
  kyc: KycFilter;
  overdueOnly: boolean;
  loanTypes: LoanType[];   // customer holds at least one of these (empty = any)
  loanCount: NumFilter;
  outstanding: NumFilter;  // total across the customer's loans, in rupees
  income: NumFilter;       // monthly income, in rupees
  city: string;
  state: string;
  occupation: string;      // case-insensitive contains
}

export const defaultFilters = (): CustomerFilters => ({
  status: '',
  kyc: '',
  overdueOnly: false,
  loanTypes: [],
  loanCount: emptyNum(),
  outstanding: emptyNum(),
  income: emptyNum(),
  city: '',
  state: '',
  occupation: '',
});

/** Per-customer facts the predicate needs, computed once by the caller. */
export interface CustomerFacts {
  kyc: 'VERIFIED' | 'PENDING';
  active: boolean;
  overdue: boolean;
  loanCount: number;
  outstanding: number;
  loanTypes: Set<LoanType>;
}

/** Count how many filter dimensions are currently constraining the list. */
export function countActive(f: CustomerFilters): number {
  let n = 0;
  if (f.status) n++;
  if (f.kyc) n++;
  if (f.overdueOnly) n++;
  if (f.loanTypes.length) n++;
  if (numActive(f.loanCount)) n++;
  if (numActive(f.outstanding)) n++;
  if (numActive(f.income)) n++;
  if (f.city) n++;
  if (f.state) n++;
  if (f.occupation.trim()) n++;
  return n;
}

/** True if a customer (with its precomputed facts) passes every active filter. */
export function passesFilters(c: Customer, facts: CustomerFacts, f: CustomerFilters): boolean {
  if (f.status === 'ACTIVE' && !facts.active) return false;
  if (f.status === 'INACTIVE' && facts.active) return false;
  if (f.kyc && facts.kyc !== f.kyc) return false;
  if (f.overdueOnly && !facts.overdue) return false;
  if (f.loanTypes.length && !f.loanTypes.some((t) => facts.loanTypes.has(t))) return false;
  if (!matchNum(facts.loanCount, f.loanCount)) return false;
  if (!matchNum(facts.outstanding, f.outstanding)) return false;
  if (!matchNum(c.monthlyIncome ?? 0, f.income)) return false;
  if (f.city && c.city !== f.city) return false;
  if (f.state && c.state !== f.state) return false;
  if (f.occupation.trim() && !(c.occupation ?? '').toLowerCase().includes(f.occupation.trim().toLowerCase())) return false;
  return true;
}

/** Convenience: build the facts object for a customer from loan helpers.
 *  Overdue uses the live next-due (amount-based), same as Collections/Dashboard —
 *  never the stored loan.nextDueDate which goes stale after payments. */
export function factsFor(
  c: Customer,
  loans: Loan[],
  outstandingFor: (l: Loan) => number,
  kyc: 'VERIFIED' | 'PENDING',
  today: string,
  nextDueFor: (l: Loan) => string | null,
): CustomerFacts {
  const mine = loans.filter((l) => l.customerId === c.id);
  return {
    kyc,
    active: mine.some((l) => l.status === 'ACTIVE'),
    overdue: mine.some((l) => {
      if (l.status !== 'ACTIVE' || outstandingFor(l) <= 0) return false;
      const nd = nextDueFor(l);
      return !!nd && nd < today;
    }),
    loanCount: mine.length,
    outstanding: mine.reduce((s, l) => s + outstandingFor(l), 0),
    loanTypes: new Set(mine.map((l) => l.type)),
  };
}
