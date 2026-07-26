import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSelector } from 'react-redux';
import { todayISO, isoLocal, addDays } from '@/lib/format';
import { config } from '@/lib/config';
import { customerApi } from '@/services/customerApi';
import { loanApi } from '@/services/loanApi';
import { collectionApi } from '@/services/collectionApi';
import { expenseApi } from '@/services/expenseApi';
import type { RootState } from '@/store';

// ─────────────── Types ───────────────
// Seven loan products, three economic behaviours:
//  • INSTALMENT (collection) loans — Daily/Monthly Collection, Vehicle, Property:
//    interest deducted upfront (net disbursed = principal − interest); a fixed
//    instalment (daily or monthly) repays the FULL principal. Term = ceil(P ÷ instalment).
//  • INTEREST-ONLY loans — Daily Interest, Monthly Interest: customer pays the
//    interest amount every period; principal stays fixed until separately settled.
//    Full principal disbursed; open-ended (no fixed term). Outstanding = principal
//    + any accrued-but-unpaid interest.
//  • FLEXIBLE: a single custom-length interest cycle, principal settled at the end.
export type LoanType =
  | 'DAILY_COLLECTION' | 'VEHICLE' | 'PROPERTY'
  | 'DAILY_INTEREST' | 'MONTHLY_INTEREST' | 'FLEXIBLE';
/** Daily Collection: interest deducted upfront, daily instalments repay principal. */
export const isDailyLoan = (t: LoanType) => t === 'DAILY_COLLECTION';
/** EMI loans (Vehicle, Property): full principal disbursed, flat overall interest,
 *  repaid in equal monthly EMIs = (principal + interest) ÷ months. No upfront cut. */
export const isEmiLoan = (t: LoanType) => t === 'VEHICLE' || t === 'PROPERTY';
/** Upfront-interest instalment loans (only Daily Collection now). */
export const isInstalmentLoan = (t: LoanType) => isDailyLoan(t);
/** @deprecated kept for callers; monthly-cadence collection no longer exists. */
export const isMonthlyLike = (_t: LoanType) => false;
/** Interest-accruing loans BY TYPE: customer pays interest each cycle; principal
 *  fixed until settled. Daily/Monthly Interest + Flexible. Use behavesInterestOnly(loan)
 *  when a loan is available — it also covers a monthly-mode Vehicle/Property. */
export const isInterestOnly = (t: LoanType) => t === 'DAILY_INTEREST' || t === 'MONTHLY_INTEREST' || t === 'FLEXIBLE';
/** Repayment mode — only meaningful for Vehicle/Property (mirrors backend). */
export type RepaymentMode = 'EMI' | 'MONTHLY_INTEREST';
/** BEHAVIOUR predicate (mirrors backend Loan.BehavesInterestOnly): true for
 *  inherently interest-only types AND a Vehicle/Property in MONTHLY_INTEREST mode. */
export const behavesInterestOnly = (loan: Loan) =>
  isInterestOnly(loan.type) || (isEmiLoan(loan.type) && loan.repaymentMode === 'MONTHLY_INTEREST');
/** BEHAVIOUR predicate: an EMI-type loan NOT in monthly-interest mode. */
export const behavesEmi = (loan: Loan) =>
  isEmiLoan(loan.type) && loan.repaymentMode !== 'MONTHLY_INTEREST';
/** Interest cadence in days by TYPE: 1 for Daily Interest, 30 otherwise. NOTE:
 *  Flexible's cadence is its own numDays — use cadenceDaysForLoan(loan) when the
 *  loan is available (mirrors backend interestCadenceDays). */
export const interestOnlyCadence = (t: LoanType) => (t === 'DAILY_INTEREST' ? 1 : 30);
/** Loan-aware interest cadence: Daily=1, Flexible=numDays, else 30. */
export const cadenceDaysForLoan = (loan: Loan) =>
  loan.type === 'DAILY_INTEREST' ? 1 : loan.type === 'FLEXIBLE' ? (loan.numDays ?? 30) : 30;
/** EMI = (principal + flat interest) ÷ months, rounded. Interest is the overall
 *  loan interest = principal × rate/100 (once, not per month). */
export const emiFor = (principal: number, interest: number, months: number) =>
  months > 0 ? Math.round((principal + interest) / months) : 0;
/** Calendar days elapsed since the loan date, Day 1 = loan date, uncapped. */
export const elapsedDaysSinceLoan = (loanDate: string) => {
  const [ly, lm, ld] = loanDate.split('-').map(Number);
  const [ty, tm, td] = todayISO().split('-').map(Number);
  const start = new Date(ly, lm - 1, ld);
  const today = new Date(ty, tm - 1, td);
  return Math.max(0, Math.round((today.getTime() - start.getTime()) / 86400000) + 1);
};
/** Number of completed 30-day cycles since the loan date (day 30 = 1, day 59 = 1, day 60 = 2). */
export const monthlyCyclesElapsed = (loanDate: string, cycleDays = 30) => Math.floor(elapsedDaysSinceLoan(loanDate) / cycleDays);
/** Cycle length: Flexible uses its own chosen term, everything else a fixed 30-day cycle. */
export const cycleDaysFor = (loan: Loan) => (loan.type === 'FLEXIBLE' ? loan.numDays ?? 30 : 30);
/** Number of instalments to repay a principal at a given instalment amount = ceil(principal ÷ instalment). */
export const instalmentTerm = (principal: number, instalment: number) => (instalment > 0 ? Math.ceil(principal / instalment) : 0);
/** Daily Collection retains this many months of interest upfront (deduction = months × interest). */
export const DAILY_COLLECTION_RETAINED_MONTHS = 3;
/** Upfront deduction for a loan: Daily Collection keeps 3× interest; other
 *  instalment loans keep 1× interest; interest-only & flexible keep nothing. */
export const upfrontDeduction = (type: LoanType, interest: number) =>
  type === 'DAILY_COLLECTION' ? interest * DAILY_COLLECTION_RETAINED_MONTHS
  : isInstalmentLoan(type) ? interest
  : 0;
export type PayMode = 'CASH' | 'UPI' | 'BANK' | 'CHEQUE';

export const LOAN_LABELS: Record<LoanType, string> = {
  DAILY_COLLECTION: 'Daily Collection',
  VEHICLE: 'Vehicle Loan',
  PROPERTY: 'Property Loan',
  DAILY_INTEREST: 'Daily Interest',
  MONTHLY_INTEREST: 'Monthly Interest',
  FLEXIBLE: 'Flexible Loan',
};

export interface Customer {
  id: number; code: string; name: string; fatherName?: string; mobile: string; altMobile?: string;
  email?: string; dateOfBirth?: string;
  address?: string; city?: string; state?: string; pincode?: string; occupation?: string;
  monthlyIncome?: number; referenceName?: string; referenceMobile?: string; createdAt: string;
  // KYC. On create/update we send the raw aadhaar/pan; on read the backend
  // returns only masked values + presence flags (never the full number).
  aadhaar?: string; pan?: string;
  aadhaarMasked?: string; panMasked?: string; hasAadhaar?: boolean; hasPan?: boolean;
}
export interface Loan {
  id: number; loanNumber: string; customerId: number; type: LoanType; repaymentMode?: RepaymentMode; principal: number; rate: number;
  interest: number; deduction?: number; disbursed?: number; loanDate: string; contact?: string; remarks?: string; dailyAmount?: number;
  numDays?: number; nextDueDate?: string; vehicleNumber?: string; vehicleBrand?: string; vehicleName?: string;
  status: 'ACTIVE' | 'CLOSED';
}
/** A payment's nature. INTEREST = income (interest-only loans keep principal
 *  outstanding); PRINCIPAL = repayment/settlement that reduces principal. Only
 *  interest-only loans distinguish the two. */
export type CollectionKind = 'INTEREST' | 'PRINCIPAL';
export interface Collection { id: number; receiptNo: string; loanId: number; date: string; amount: number; mode: PayMode; kind?: CollectionKind; remarks?: string; }
export interface Expense { id: number; date: string; category: string; subCategory?: string; name: string; amount: number; mode: PayMode; remarks?: string; }
export interface DocItem { id: number; customerId: number; type: string; fileName: string; size: string; dataUrl: string | null; mime: string | null; date: string; }

export const EXPENSE_CATEGORIES = ['Personal', 'Office', 'Savings'];
export const EXPENSE_SUB_CATEGORIES = ['Office Rent', 'Electricity Bill', 'Office Boy Salary', 'Petrol', 'Diesel', 'Internet', 'Stationery', 'Marketing', 'Maintenance', 'Tea', 'Travel', 'Courier', 'Miscellaneous'];

let _uidSeq = 1000;
const uid = () => ++_uidSeq;
const monthAgo = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() - n); return isoLocal(d); };
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return isoLocal(d); };
const calcInterest = (principal: number, rate: number) => Math.round((principal * rate) / 100);

// ─────────────── Seed ───────────────
const seedCustomers: Customer[] = [
  { id: 1, code: 'CUST-1001', name: 'Rohan Sharma', fatherName: 'Suresh Sharma', mobile: '9812345670', address: 'MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001', occupation: 'Shopkeeper', monthlyIncome: 45000, referenceName: 'Amit', referenceMobile: '9800011111', createdAt: monthAgo(6) },
  { id: 2, code: 'CUST-1002', name: 'Ananya Iyer', fatherName: 'Raghav Iyer', mobile: '9898989812', address: 'Anna Nagar', city: 'Chennai', state: 'Tamil Nadu', pincode: '600040', occupation: 'Business', monthlyIncome: 120000, createdAt: monthAgo(4) },
  { id: 3, code: 'CUST-1003', name: 'Vikram Nair', fatherName: 'Mohan Nair', mobile: '9745612300', address: 'Marine Drive', city: 'Kochi', state: 'Kerala', pincode: '682001', occupation: 'Driver', monthlyIncome: 28000, createdAt: monthAgo(3) },
  { id: 4, code: 'CUST-1004', name: 'Meera Joshi', mobile: '9900011223', address: 'FC Road', city: 'Pune', state: 'Maharashtra', pincode: '411004', occupation: 'Tailor', monthlyIncome: 22000, createdAt: monthAgo(2) },
  { id: 5, code: 'CUST-1005', name: 'Arjun Reddy', mobile: '9012345678', address: 'Banjara Hills', city: 'Hyderabad', state: 'Telangana', pincode: '500034', occupation: 'Contractor', monthlyIncome: 90000, createdAt: monthAgo(1) },
];

const L = (o: Partial<Loan> & { id: number; customerId: number; type: LoanType; principal: number; rate: number; loanDate: string }): Loan => ({
  loanNumber: 'LN-' + (4000 + o.id), interest: calcInterest(o.principal, o.rate), status: 'ACTIVE', ...o,
} as Loan);

const seedLoans: Loan[] = [
  // Daily Collection: fixed 100-day term; daily auto = 300000 ÷ 100 = 3000/day.
  L({ id: 1, loanNumber: 'LN-4001', customerId: 1, type: 'DAILY_COLLECTION', principal: 300000, rate: 0.25, loanDate: daysAgo(9), dailyAmount: 3000, numDays: 100, nextDueDate: addDays(daysAgo(9), 1), contact: '9812345670' }),
  // Vehicle EMI: ₹6,80,000 @ 12% overall = ₹81,600 interest; total ₹7,61,600 ÷ 10 months = ₹76,160 EMI.
  L({ id: 3, loanNumber: 'LN-4003', customerId: 3, type: 'VEHICLE', principal: 680000, rate: 12, loanDate: monthAgo(4), dailyAmount: 76160, numDays: 10, vehicleNumber: 'KL-07-AB-1234', vehicleBrand: 'Maruti', vehicleName: 'Ertiga', nextDueDate: addDays(todayISO(), -3), contact: '9745612300' }),
  L({ id: 4, loanNumber: 'LN-4004', customerId: 4, type: 'FLEXIBLE', principal: 150000, rate: 3, loanDate: monthAgo(1), numDays: 30, nextDueDate: addDays(todayISO(), 4) }),
  // Property EMI: ₹45,00,000 @ 12% overall = ₹5,40,000 interest; total ₹50,40,000 ÷ 15 months = ₹3,36,000 EMI.
  L({ id: 5, loanNumber: 'LN-4005', customerId: 5, type: 'PROPERTY', principal: 4500000, rate: 12, loanDate: monthAgo(2), dailyAmount: 336000, numDays: 15, nextDueDate: addDays(todayISO(), 12) }),
  // Monthly Interest (interest-only): ₹1,00,000 at 5%/month → interest auto = ₹5,000/month; principal fixed until settled.
  L({ id: 6, loanNumber: 'LN-4006', customerId: 2, type: 'MONTHLY_INTEREST', principal: 100000, rate: 5, loanDate: monthAgo(2), nextDueDate: addDays(todayISO(), 8), contact: '9898989812' }),
  // Daily Interest (interest-only): ₹50,000 at 0.2%/day → interest auto = ₹100/day; principal fixed until settled.
  L({ id: 7, loanNumber: 'LN-4007', customerId: 3, type: 'DAILY_INTEREST', principal: 50000, rate: 0.2, loanDate: daysAgo(15), nextDueDate: addDays(todayISO(), 1), contact: '9745612300' }),
];

let receiptCounter = 100001;
const R = () => 'RCPT-' + receiptCounter++;
const seedCollections: Collection[] = [
  // Daily loan l1 — realistic ₹750/day payments over the last 9 days (mix of paid, partial, missed)
  { id: uid(), receiptNo: R(), loanId: 1, date: daysAgo(9), amount: 750, mode: 'CASH' },
  { id: uid(), receiptNo: R(), loanId: 1, date: daysAgo(8), amount: 750, mode: 'UPI' },
  { id: uid(), receiptNo: R(), loanId: 1, date: daysAgo(7), amount: 500, mode: 'CASH' }, // partial
  // daysAgo(6): no payment → Due
  { id: uid(), receiptNo: R(), loanId: 1, date: daysAgo(5), amount: 750, mode: 'CASH' },
  { id: uid(), receiptNo: R(), loanId: 1, date: daysAgo(4), amount: 750, mode: 'UPI' },
  { id: uid(), receiptNo: R(), loanId: 1, date: daysAgo(2), amount: 300, mode: 'CASH' }, // partial
  { id: uid(), receiptNo: R(), loanId: 1, date: todayISO(), amount: 750, mode: 'UPI' },
  // Other loans — one payment each, keeps the dataset light
  { id: uid(), receiptNo: R(), loanId: 2, date: daysAgo(20), amount: 24000, mode: 'BANK' },
  { id: uid(), receiptNo: R(), loanId: 3, date: daysAgo(30), amount: 10200, mode: 'UPI' },
  { id: uid(), receiptNo: R(), loanId: 5, date: daysAgo(10), amount: 54000, mode: 'BANK' },
  { id: uid(), receiptNo: R(), loanId: 4, date: todayISO(), amount: 4500, mode: 'UPI' },
];
const seedExpenses: Expense[] = [
  { id: uid(), date: monthAgo(1), category: 'Office Rent', name: 'Monthly office rent', amount: 85000, mode: 'BANK' },
  { id: uid(), date: monthAgo(1), category: 'Petrol', name: 'Field visits fuel', amount: 12000, mode: 'CASH' },
  { id: uid(), date: todayISO(), category: 'Internet', name: 'Broadband', amount: 2200, mode: 'UPI' },
  { id: uid(), date: todayISO(), category: 'Tea', name: 'Pantry', amount: 1800, mode: 'CASH' },
];
const seedDocs: DocItem[] = [
  { id: uid(), customerId: 1, type: 'Aadhaar', fileName: 'aadhaar_rohan.pdf', size: '2.1 MB', dataUrl: null, mime: null, date: monthAgo(6) },
  { id: uid(), customerId: 1, type: 'PAN', fileName: 'pan_rohan.pdf', size: '1.3 MB', dataUrl: null, mime: null, date: monthAgo(6) },
  { id: uid(), customerId: 3, type: 'RC', fileName: 'rc_vikram.pdf', size: '0.8 MB', dataUrl: null, mime: null, date: monthAgo(4) },
];

// ─────────────── Context ───────────────
interface DataShape {
  customers: Customer[]; loans: Loan[]; collections: Collection[]; expenses: Expense[]; documents: DocItem[];
  nextCode: () => string; nextLoanNo: () => string;
  addCustomer: (c: Omit<Customer, 'id' | 'code' | 'createdAt'>) => void;
  /** Insert an already-created customer (from the API) into local state without a second API call. */
  addCustomerRecord: (c: Customer) => void;
  /** Replace an existing customer with an authoritative record (from the API) without a second call. */
  updateCustomerRecord: (c: Customer) => void;
  updateCustomer: (id: number, c: Partial<Customer>) => void;
  deleteCustomer: (id: number) => void;
  addLoan: (l: Omit<Loan, 'id' | 'loanNumber' | 'interest' | 'status'>) => void;
  /** Prepend an authoritative loan record (from the API) without a second call. */
  addLoanRecord: (l: Loan) => void;
  /** Replace an existing loan with an authoritative record (from the API). */
  updateLoanRecord: (l: Loan) => void;
  updateLoan: (id: number, l: Partial<Loan>) => void;
  deleteLoan: (id: number) => void;
  closeLoan: (id: number) => void;
  addCollection: (c: Omit<Collection, 'id' | 'receiptNo'>) => Promise<void> | void;
  updateCollection: (id: number, c: Partial<Collection>) => Promise<void> | void;
  deleteCollection: (id: number) => Promise<void> | void;
  addExpense: (e: Omit<Expense, 'id'>) => Promise<void> | void;
  updateExpense: (id: number, e: Partial<Expense>) => Promise<void> | void;
  deleteExpense: (id: number) => Promise<void> | void;
  addDocument: (d: Omit<DocItem, 'id'>) => void;
  deleteDocument: (id: number) => void;
  collectedFor: (loanId: number) => number;
  interestCollectedFor: (loanId: number) => number;
  principalCollectedFor: (loanId: number) => number;
  totalDueForDaily: (loan: Loan) => number;
  totalDueForMonthly: (loan: Loan) => number;
  totalDueForInterestOnly: (loan: Loan) => number;
  outstandingFor: (loan: Loan) => number;
  nextDueForDaily: (loan: Loan) => string | null;
  /** Amount-based live next-due for ANY loan type (mirrors backend Loan.NextDue). */
  nextDueFor: (loan: Loan) => string | null;
}
const DataCtx = createContext<DataShape | null>(null);
export const useData = () => {
  const c = useContext(DataCtx);
  if (!c) throw new Error('useData must be used within DataProvider');
  return c;
};

export function DataProvider({ children }: { children: ReactNode }) {
  // In API mode, customers come from the backend (start empty, load on mount).
  // Loans/collections/etc. remain seeded until their backend phases land.
  const [customers, setCustomers] = useState<Customer[]>(config.useApi ? [] : seedCustomers);
  const [loans, setLoans] = useState<Loan[]>(config.useApi ? [] : seedLoans);
  const [collections, setCollections] = useState<Collection[]>(config.useApi ? [] : seedCollections);
  const [expenses, setExpenses] = useState<Expense[]>(config.useApi ? [] : seedExpenses);
  const [documents, setDocuments] = useState<DocItem[]>(seedDocs);
  const [codeSeq, setCodeSeq] = useState(1006);
  const [loanSeq, setLoanSeq] = useState(4006);
  const [rcptSeq, setRcptSeq] = useState(100010);

  // Load customers from the backend in API mode. Keyed off the access token so
  // the fetch runs AFTER login (the provider mounts before auth exists; a fetch
  // at mount would 401). Re-runs whenever the token changes (login / restore).
  const accessToken = useSelector((s: RootState) => s.auth.accessToken);
  useEffect(() => {
    if (!config.useApi || !accessToken) return;
    customerApi.list().then(setCustomers).catch(() => { /* surfaced per-action */ });
    loanApi.list().then(setLoans).catch(() => { /* surfaced per-action */ });
    collectionApi.list().then(setCollections).catch(() => { /* surfaced per-action */ });
    expenseApi.list().then(setExpenses).catch(() => { /* surfaced per-action */ });
  }, [accessToken]);

  // Mock-mode auto-close: when a loan's outstanding reaches 0 it is marked
  // CLOSED, and a CLOSED loan whose balance reappears (edited/deleted payment)
  // is reopened. In API mode the server owns this (and reloads loans), so this
  // effect only runs against local state. Kept in an effect so it reacts to any
  // collection change without duplicating the logic in each mutation.
  useEffect(() => {
    if (config.useApi) return;
    setLoans((prev) => {
      let changed = false;
      const next = prev.map((l) => {
        // Recompute outstanding directly (avoids depending on the memoised value).
        const interestPaid = collections.filter((c) => c.loanId === l.id && c.kind !== 'PRINCIPAL').reduce((s, c) => s + c.amount, 0);
        const principalPaid = collections.filter((c) => c.loanId === l.id && c.kind === 'PRINCIPAL').reduce((s, c) => s + c.amount, 0);
        const totalPaid = interestPaid + principalPaid;
        let outstanding: number;
        if (isInstalmentLoan(l.type)) outstanding = Math.max(0, l.principal - totalPaid);
        else if (behavesEmi(l)) outstanding = Math.max(0, l.principal + l.interest - totalPaid);
        else if (behavesInterestOnly(l)) {
          const cadence = cadenceDaysForLoan(l);
          // Flexible: 1st cycle on the loan date → cycles + 1; Daily: elapsed − 1;
          // Monthly Interest & monthly-mode Vehicle/Property: completed cycles.
          const periods = l.type === 'FLEXIBLE' ? monthlyCyclesElapsed(l.loanDate, cadence) + 1
            : cadence === 1 ? Math.max(0, elapsedDaysSinceLoan(l.loanDate) - 1)
            : monthlyCyclesElapsed(l.loanDate, cadence);
          const interestDue = Math.max(0, periods * l.interest - interestPaid);
          outstanding = Math.max(0, l.principal - principalPaid) + interestDue;
        } else outstanding = Math.max(0, l.principal + l.interest - totalPaid);

        if (outstanding <= 0 && l.status === 'ACTIVE') { changed = true; return { ...l, status: 'CLOSED' as const }; }
        if (outstanding > 0 && l.status === 'CLOSED') { changed = true; return { ...l, status: 'ACTIVE' as const }; }
        return l;
      });
      return changed ? next : prev;
    });
  }, [collections]);

  const value = useMemo<DataShape>(() => {
    const collectedFor = (loanId: number) => collections.filter((c) => c.loanId === loanId).reduce((s, c) => s + c.amount, 0);
    // Split by kind — interest-only loans settle principal separately. A payment
    // with no explicit kind counts as interest (the historical default).
    const interestCollectedFor = (loanId: number) => collections.filter((c) => c.loanId === loanId && c.kind !== 'PRINCIPAL').reduce((s, c) => s + c.amount, 0);
    const principalCollectedFor = (loanId: number) => collections.filter((c) => c.loanId === loanId && c.kind === 'PRINCIPAL').reduce((s, c) => s + c.amount, 0);
    /** Scheduled shortfall for a DAILY_COLLECTION loan: instalments expected by
     *  today × daily amount, less what's been collected. Collection starts the
     *  DAY AFTER disbursement, so expected count = (elapsed − 1), capped at term.
     *  Measures whether the borrower is on schedule — not the total owed. */
    const totalDueForDaily = (loan: Loan) => {
      const elapsed = Math.max(0, elapsedDaysSinceLoan(loan.loanDate) - 1);
      const billable = Math.min(elapsed, loan.numDays ?? Infinity);
      return Math.max(0, billable * (loan.dailyAmount ?? 0) - collectedFor(loan.id));
    };
    /** Scheduled shortfall for an EMI loan (Vehicle/Property): EMIs due by today
     *  (completed 30-day cycles, capped at tenure) × EMI, less what's been collected.
     *  EMI is stored in dailyAmount; tenure (months) in numDays. */
    const totalDueForMonthly = (loan: Loan) => {
      const cyclesElapsed = monthlyCyclesElapsed(loan.loanDate, 30);
      const billable = Math.min(cyclesElapsed, loan.numDays ?? Infinity);
      const emi = loan.dailyAmount ?? 0;
      return Math.max(0, billable * emi - collectedFor(loan.id));
    };
    /** Accrued-but-unpaid interest for an interest-only loan: periods elapsed
     *  (daily or 30-day, UNCAPPED — the loan runs until settled) × interest per
     *  period, less what's been collected. Interest per period is auto-computed:
     *  loan.interest = principal × rate/100 (per day for Daily Interest, per
     *  month for Monthly Interest). */
    // Interest cycles accrued by today (mirrors backend Loan.AccruedInterest):
    //  • Daily Interest: from the DAY AFTER disbursement (elapsed − 1).
    //  • Monthly Interest: completed 30-day cycles.
    //  • Flexible: FIRST cycle on the loan date itself → completed cycles + 1.
    const interestPeriodsElapsed = (loan: Loan) => {
      const cadence = cadenceDaysForLoan(loan);
      if (loan.type === 'FLEXIBLE') return monthlyCyclesElapsed(loan.loanDate, cadence) + 1;
      if (cadence === 1) return Math.max(0, elapsedDaysSinceLoan(loan.loanDate) - 1);
      return monthlyCyclesElapsed(loan.loanDate, cadence);
    };
    const totalDueForInterestOnly = (loan: Loan) => {
      // Only interest-kind payments cover accrued interest; principal payments settle separately.
      return Math.max(0, interestPeriodsElapsed(loan) * loan.interest - interestCollectedFor(loan.id));
    };
    /** Outstanding balance still owed.
     *  Instalment loans (Daily/Monthly Collection, Vehicle, Property): interest is
     *    deducted upfront, so only the principal is payable and it shrinks with every
     *    collection → principal − collected.
     *  Interest-only loans (Daily/Monthly Interest): principal stays fixed until
     *    settled → principal + accrued-but-unpaid interest.
     *  Flexible: single cycle → principal + interest − collected. */
    const outstandingFor = (loan: Loan) => {
      const collected = collectedFor(loan.id);
      if (isInstalmentLoan(loan.type)) {
        // Daily Collection: interest deducted upfront; principal shrinks as collected.
        // Keeps a meaningful residual even after closing.
        return Math.max(0, loan.principal - collected);
      }
      if (behavesEmi(loan)) {
        // Vehicle/Property (EMI mode): full principal + flat interest, repaid by EMIs.
        // Outstanding = total payable − collected.
        return loan.status === 'CLOSED' ? 0 : Math.max(0, loan.principal + loan.interest - collected);
      }
      // Interest-accruing (Daily/Monthly Interest, Flexible, monthly-mode Vehicle/
      // Property): remaining principal (settled via PRINCIPAL payments) + accrued
      // unpaid interest.
      const remainingPrincipal = Math.max(0, loan.principal - principalCollectedFor(loan.id));
      return loan.status === 'CLOSED' ? 0 : remainingPrincipal + totalDueForInterestOnly(loan);
    };
    /** Live next-due date, derived from what has actually been PAID — mirrors
     *  the backend's Loan.NextDue exactly. One formula covers every state:
     *  nextDue = loanDate + (fullyPaidInstalments + 1) × step, where
     *  fullyPaidInstalments = floor(collected ÷ instalment).
     *  Fresh loan → first scheduled day; partial payment → due date does NOT
     *  advance; overdue → the OLDEST unpaid slot (a past date); paid ahead →
     *  advances past today. CLOSED / fully-collected → null. */
    const nextDueFor = (loan: Loan): string | null => {
      if (loan.status === 'CLOSED') return null;
      // Interest-accruing (Daily/Monthly Interest, Flexible, monthly-mode Vehicle/
      // Property): interest bucket ÷ per-period × its cadence (Flexible = numDays).
      if (behavesInterestOnly(loan)) {
        const per = loan.dailyAmount ?? loan.interest;
        if (per <= 0) return loan.nextDueDate ?? null;
        const paid = Math.floor(interestCollectedFor(loan.id) / per);
        // Flexible's first cycle is due on the loan date (day 0), so its steps
        // are one earlier than Daily/Monthly Interest (first due at +cadence).
        const step = loan.type === 'FLEXIBLE' ? paid : paid + 1;
        return addDays(loan.loanDate, step * cadenceDaysForLoan(loan));
      }
      const inst = loan.dailyAmount ?? 0;
      if (inst <= 0) return loan.nextDueDate ?? null;
      const paid = Math.floor(collectedFor(loan.id) / inst);
      if (loan.numDays != null && paid >= loan.numDays) return null; // every instalment collected
      const step = isDailyLoan(loan.type) ? 1 : 30;
      return addDays(loan.loanDate, (paid + 1) * step);
    };
    // Superseded by the amount-based nextDueFor (the old version advanced on the
    // last payment's DATE, so a partial payment wrongly moved the due date).
    const nextDueForDaily = nextDueFor;
    return {
      customers, loans, collections, expenses, documents,
      nextCode: () => 'CUST-' + codeSeq,
      nextLoanNo: () => 'LN-' + loanSeq,
      addCustomer: (c) => {
        if (config.useApi) {
          // Server mints the code/id; prepend the authoritative record it returns.
          customerApi.create(c).then((created) => setCustomers((s) => [created, ...s]));
          return;
        }
        setCustomers((s) => [{ ...c, id: uid(), code: 'CUST-' + codeSeq, createdAt: todayISO() }, ...s]);
        setCodeSeq((n) => n + 1);
      },
      addCustomerRecord: (c) => setCustomers((s) => [c, ...s.filter((x) => x.id !== c.id)]),
      updateCustomerRecord: (c) => setCustomers((s) => s.map((x) => (x.id === c.id ? c : x))),
      updateCustomer: (id, patch) => {
        if (config.useApi) {
          customerApi.update(id, patch).then((updated) =>
            setCustomers((s) => s.map((c) => (c.id === id ? updated : c))));
          return;
        }
        setCustomers((s) => s.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      },
      deleteCustomer: (id) => {
        if (config.useApi) {
          // Backend cascades loans/collections/documents; mirror locally.
          customerApi.remove(id).then(() => setCustomers((s) => s.filter((c) => c.id !== id)));
          return;
        }
        const loanIds = new Set(loans.filter((l) => l.customerId === id).map((l) => l.id));
        setCustomers((s) => s.filter((c) => c.id !== id));
        setLoans((s) => s.filter((l) => l.customerId !== id));
        setCollections((s) => s.filter((c) => !loanIds.has(c.loanId)));
        setDocuments((s) => s.filter((doc) => doc.customerId !== id));
      },
      addLoan: (l) => {
        if (config.useApi) {
          // Server mints the number/id and derives all money math; prepend the
          // authoritative record it returns.
          loanApi.create(l).then((created) => setLoans((s) => [created, ...s]));
          return;
        }
        const interest = calcInterest(l.principal, l.rate);
        // Daily Collection retains 3 months of interest upfront; other instalment
        // loans retain 1× interest; interest-only & flexible retain nothing.
        const ded = upfrontDeduction(l.type, interest);
        setLoans((s) => [{ ...l, id: uid(), loanNumber: 'LN-' + loanSeq, interest, deduction: ded || undefined, status: 'ACTIVE' }, ...s]);
        setLoanSeq((n) => n + 1);
      },
      addLoanRecord: (l) => setLoans((s) => [l, ...s.filter((x) => x.id !== l.id)]),
      updateLoanRecord: (l) => setLoans((s) => s.map((x) => (x.id === l.id ? l : x))),
      closeLoan: (id) => {
        if (config.useApi) {
          loanApi.close(id).then((updated) => setLoans((s) => s.map((l) => (l.id === id ? updated : l))));
          return;
        }
        setLoans((s) => s.map((l) => (l.id === id ? { ...l, status: 'CLOSED' } : l)));
      },
      updateLoan: (id, patch) => {
        if (config.useApi) {
          // Reopen is a dedicated endpoint; a plain status→ACTIVE patch maps to it.
          if (patch.status === 'ACTIVE' && Object.keys(patch).length === 1) {
            loanApi.reopen(id).then((updated) => setLoans((s) => s.map((l) => (l.id === id ? updated : l))));
            return;
          }
          loanApi.update(id, patch).then((updated) => setLoans((s) => s.map((l) => (l.id === id ? updated : l))));
          return;
        }
        setLoans((s) => s.map((l) => {
          if (l.id !== id) return l;
          const merged = { ...l, ...patch };
          const interest = patch.principal != null || patch.rate != null ? calcInterest(merged.principal, merged.rate) : merged.interest;
          const ded = upfrontDeduction(merged.type, interest);
          return { ...merged, interest, deduction: ded || undefined };
        }));
      },
      deleteLoan: (id) => {
        if (config.useApi) {
          loanApi.remove(id).then(() => setLoans((s) => s.filter((l) => l.id !== id)));
          return;
        }
        setLoans((s) => s.filter((l) => l.id !== id));
        setCollections((s) => s.filter((c) => c.loanId !== id));
      },
      // Collection mutations return a promise in API mode so callers can await
      // and surface failures (no false success). The loan list is refreshed
      // afterwards so outstanding/status (server-computed) stay in sync.
      addCollection: (c) => {
        if (config.useApi) {
          return collectionApi.record(c.loanId, c).then((created) => {
            setCollections((s) => [created, ...s]);
            loanApi.list().then(setLoans).catch(() => {});
          });
        }
        setCollections((s) => [{ ...c, id: uid(), receiptNo: 'RCPT-' + rcptSeq }, ...s]);
        setRcptSeq((n) => n + 1);
      },
      updateCollection: (id, patch) => {
        if (config.useApi) {
          return collectionApi.update(id, patch).then((updated) => {
            setCollections((s) => s.map((c) => (c.id === id ? updated : c)));
            loanApi.list().then(setLoans).catch(() => {});
          });
        }
        setCollections((s) => s.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      },
      deleteCollection: (id) => {
        if (config.useApi) {
          return collectionApi.remove(id).then(() => {
            setCollections((s) => s.filter((c) => c.id !== id));
            loanApi.list().then(setLoans).catch(() => {});
          });
        }
        setCollections((s) => s.filter((c) => c.id !== id));
      },
      // Expense mutations return a promise in API mode so the page can await
      // and surface failures (server mints the id and validates every field).
      addExpense: (e) => {
        if (config.useApi) {
          return expenseApi.create(e).then((created) => setExpenses((s) => [created, ...s]));
        }
        setExpenses((s) => [{ ...e, id: uid() }, ...s]);
      },
      updateExpense: (id, patch) => {
        if (config.useApi) {
          return expenseApi.update(id, patch).then((updated) =>
            setExpenses((s) => s.map((e) => (e.id === id ? updated : e))));
        }
        setExpenses((s) => s.map((e) => (e.id === id ? { ...e, ...patch } : e)));
      },
      deleteExpense: (id) => {
        if (config.useApi) {
          return expenseApi.remove(id).then(() => setExpenses((s) => s.filter((e) => e.id !== id)));
        }
        setExpenses((s) => s.filter((e) => e.id !== id));
      },
      addDocument: (d) => setDocuments((s) => [{ ...d, id: uid() }, ...s]),
      deleteDocument: (id) => setDocuments((s) => s.filter((d) => d.id !== id)),
      collectedFor, interestCollectedFor, principalCollectedFor, outstandingFor, nextDueForDaily, nextDueFor, totalDueForDaily, totalDueForMonthly, totalDueForInterestOnly,
    };
  }, [customers, loans, collections, expenses, documents, codeSeq, loanSeq, rcptSeq]);

  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}
