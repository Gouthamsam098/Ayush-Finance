import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { todayISO, isoLocal, addDays } from '@/lib/format';

// ─────────────── Types ───────────────
export type LoanType = 'DAILY_COLLECTION' | 'MONTHLY_INTEREST' | 'DAILY_INTEREST' | 'VEHICLE' | 'PROPERTY' | 'FLEXIBLE';
/** Daily Collection and Daily Interest share the same economics: interest deducted upfront, daily payment repays principal. */
export const isDailyLoan = (t: LoanType) => t === 'DAILY_COLLECTION' || t === 'DAILY_INTEREST';
/** Monthly Interest, Vehicle, and Property all share the 30-day interest-cycle model (principal fixed, recurring interest due). */
export const isMonthlyLike = (t: LoanType) => t === 'MONTHLY_INTEREST' || t === 'VEHICLE' || t === 'PROPERTY' || t === 'FLEXIBLE';
/** Calendar days elapsed since the loan date, Day 1 = loan date, uncapped. */
export const elapsedDaysSinceLoan = (loanDate: string) => {
  const [ly, lm, ld] = loanDate.split('-').map(Number);
  const [ty, tm, td] = todayISO().split('-').map(Number);
  const start = new Date(ly, lm - 1, ld);
  const today = new Date(ty, tm - 1, td);
  return Math.max(0, Math.round((today.getTime() - start.getTime()) / 86400000) + 1);
};
/** Number of completed 30-day interest cycles since the loan date (e.g. day 30 = 1 cycle, day 59 = 1, day 60 = 2). */
export const monthlyCyclesElapsed = (loanDate: string, cycleDays = 30) => Math.floor(elapsedDaysSinceLoan(loanDate) / cycleDays);
/** Cycle length for the interest model: Flexible uses its own chosen term, everything else a fixed 30-day cycle. */
export const cycleDaysFor = (loan: Loan) => (loan.type === 'FLEXIBLE' ? loan.numDays ?? 30 : 30);
export type PayMode = 'CASH' | 'UPI' | 'BANK' | 'CHEQUE';

export const LOAN_LABELS: Record<LoanType, string> = {
  DAILY_COLLECTION: 'Daily Collection',
  MONTHLY_INTEREST: 'Monthly Interest',
  DAILY_INTEREST: 'Daily Interest',
  VEHICLE: 'Vehicle Loan',
  PROPERTY: 'Property Loan',
  FLEXIBLE: 'Flexible Loan',
};

export interface Customer {
  id: string; code: string; name: string; fatherName?: string; mobile: string; altMobile?: string;
  address?: string; city?: string; state?: string; pincode?: string; occupation?: string;
  monthlyIncome?: number; referenceName?: string; referenceMobile?: string; createdAt: string;
}
export interface Loan {
  id: string; loanNumber: string; customerId: string; type: LoanType; principal: number; rate: number;
  interest: number; deduction?: number; loanDate: string; contact?: string; remarks?: string; dailyAmount?: number;
  numDays?: number; nextDueDate?: string; vehicleNumber?: string; vehicleBrand?: string; vehicleName?: string;
  status: 'ACTIVE' | 'CLOSED';
}
export interface Collection { id: string; receiptNo: string; loanId: string; date: string; amount: number; mode: PayMode; remarks?: string; }
export interface Expense { id: string; date: string; category: string; subCategory?: string; name: string; amount: number; mode: PayMode; remarks?: string; }
export interface DocItem { id: string; customerId: string; type: string; fileName: string; size: string; dataUrl: string | null; mime: string | null; date: string; }

export const EXPENSE_CATEGORIES = ['Personal', 'Office', 'Savings'];
export const EXPENSE_SUB_CATEGORIES = ['Office Rent', 'Electricity Bill', 'Office Boy Salary', 'Petrol', 'Diesel', 'Internet', 'Stationery', 'Marketing', 'Maintenance', 'Tea', 'Travel', 'Courier', 'Miscellaneous'];

const uid = () => Math.random().toString(36).slice(2, 10);
const monthAgo = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() - n); return isoLocal(d); };
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return isoLocal(d); };
const calcInterest = (principal: number, rate: number) => Math.round((principal * rate) / 100);

// ─────────────── Seed ───────────────
const seedCustomers: Customer[] = [
  { id: 'c1', code: 'CUST-1001', name: 'Rohan Sharma', fatherName: 'Suresh Sharma', mobile: '9812345670', address: 'MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001', occupation: 'Shopkeeper', monthlyIncome: 45000, referenceName: 'Amit', referenceMobile: '9800011111', createdAt: monthAgo(6) },
  { id: 'c2', code: 'CUST-1002', name: 'Ananya Iyer', fatherName: 'Raghav Iyer', mobile: '9898989812', address: 'Anna Nagar', city: 'Chennai', state: 'Tamil Nadu', pincode: '600040', occupation: 'Business', monthlyIncome: 120000, createdAt: monthAgo(4) },
  { id: 'c3', code: 'CUST-1003', name: 'Vikram Nair', fatherName: 'Mohan Nair', mobile: '9745612300', address: 'Marine Drive', city: 'Kochi', state: 'Kerala', pincode: '682001', occupation: 'Driver', monthlyIncome: 28000, createdAt: monthAgo(3) },
  { id: 'c4', code: 'CUST-1004', name: 'Meera Joshi', mobile: '9900011223', address: 'FC Road', city: 'Pune', state: 'Maharashtra', pincode: '411004', occupation: 'Tailor', monthlyIncome: 22000, createdAt: monthAgo(2) },
  { id: 'c5', code: 'CUST-1005', name: 'Arjun Reddy', mobile: '9012345678', address: 'Banjara Hills', city: 'Hyderabad', state: 'Telangana', pincode: '500034', occupation: 'Contractor', monthlyIncome: 90000, createdAt: monthAgo(1) },
];

const L = (o: Partial<Loan> & { id: string; customerId: string; type: LoanType; principal: number; rate: number; loanDate: string }): Loan => ({
  loanNumber: 'LN-' + (4000 + parseInt(o.id.slice(1) || '1')), interest: calcInterest(o.principal, o.rate), status: 'ACTIVE', ...o,
} as Loan);

const seedLoans: Loan[] = [
  L({ id: 'l1', loanNumber: 'LN-4001', customerId: 'c1', type: 'DAILY_COLLECTION', principal: 300000, rate: 0.25, loanDate: daysAgo(9), dailyAmount: 750, numDays: 100, nextDueDate: addDays(daysAgo(9), 100), contact: '9812345670' }),
  L({ id: 'l2', loanNumber: 'LN-4002', customerId: 'c2', type: 'MONTHLY_INTEREST', principal: 1200000, rate: 2, loanDate: monthAgo(3), nextDueDate: addDays(todayISO(), 6), contact: '9898989812' }),
  L({ id: 'l3', loanNumber: 'LN-4003', customerId: 'c3', type: 'VEHICLE', principal: 680000, rate: 1.5, loanDate: monthAgo(4), vehicleNumber: 'KL-07-AB-1234', vehicleBrand: 'Maruti', vehicleName: 'Ertiga', nextDueDate: addDays(todayISO(), -3), contact: '9745612300' }),
  L({ id: 'l4', loanNumber: 'LN-4004', customerId: 'c4', type: 'FLEXIBLE', principal: 150000, rate: 3, loanDate: monthAgo(1), numDays: 30, nextDueDate: addDays(todayISO(), 4) }),
  L({ id: 'l5', loanNumber: 'LN-4005', customerId: 'c5', type: 'PROPERTY', principal: 4500000, rate: 1.2, loanDate: monthAgo(2), nextDueDate: addDays(todayISO(), 12) }),
];

let receiptCounter = 100001;
const R = () => 'RCPT-' + receiptCounter++;
const seedCollections: Collection[] = [
  // Daily loan l1 — realistic ₹750/day payments over the last 9 days (mix of paid, partial, missed)
  { id: uid(), receiptNo: R(), loanId: 'l1', date: daysAgo(9), amount: 750, mode: 'CASH' },
  { id: uid(), receiptNo: R(), loanId: 'l1', date: daysAgo(8), amount: 750, mode: 'UPI' },
  { id: uid(), receiptNo: R(), loanId: 'l1', date: daysAgo(7), amount: 500, mode: 'CASH' }, // partial
  // daysAgo(6): no payment → Due
  { id: uid(), receiptNo: R(), loanId: 'l1', date: daysAgo(5), amount: 750, mode: 'CASH' },
  { id: uid(), receiptNo: R(), loanId: 'l1', date: daysAgo(4), amount: 750, mode: 'UPI' },
  { id: uid(), receiptNo: R(), loanId: 'l1', date: daysAgo(2), amount: 300, mode: 'CASH' }, // partial
  { id: uid(), receiptNo: R(), loanId: 'l1', date: todayISO(), amount: 750, mode: 'UPI' },
  // Other loans — one payment each, keeps the dataset light
  { id: uid(), receiptNo: R(), loanId: 'l2', date: daysAgo(20), amount: 24000, mode: 'BANK' },
  { id: uid(), receiptNo: R(), loanId: 'l3', date: daysAgo(30), amount: 10200, mode: 'UPI' },
  { id: uid(), receiptNo: R(), loanId: 'l5', date: daysAgo(10), amount: 54000, mode: 'BANK' },
  { id: uid(), receiptNo: R(), loanId: 'l4', date: todayISO(), amount: 4500, mode: 'UPI' },
];
const seedExpenses: Expense[] = [
  { id: uid(), date: monthAgo(1), category: 'Office Rent', name: 'Monthly office rent', amount: 85000, mode: 'BANK' },
  { id: uid(), date: monthAgo(1), category: 'Petrol', name: 'Field visits fuel', amount: 12000, mode: 'CASH' },
  { id: uid(), date: todayISO(), category: 'Internet', name: 'Broadband', amount: 2200, mode: 'UPI' },
  { id: uid(), date: todayISO(), category: 'Tea', name: 'Pantry', amount: 1800, mode: 'CASH' },
];
const seedDocs: DocItem[] = [
  { id: uid(), customerId: 'c1', type: 'Aadhaar', fileName: 'aadhaar_rohan.pdf', size: '2.1 MB', dataUrl: null, mime: null, date: monthAgo(6) },
  { id: uid(), customerId: 'c1', type: 'PAN', fileName: 'pan_rohan.pdf', size: '1.3 MB', dataUrl: null, mime: null, date: monthAgo(6) },
  { id: uid(), customerId: 'c3', type: 'RC', fileName: 'rc_vikram.pdf', size: '0.8 MB', dataUrl: null, mime: null, date: monthAgo(4) },
];

// ─────────────── Context ───────────────
interface DataShape {
  customers: Customer[]; loans: Loan[]; collections: Collection[]; expenses: Expense[]; documents: DocItem[];
  nextCode: () => string; nextLoanNo: () => string;
  addCustomer: (c: Omit<Customer, 'id' | 'code' | 'createdAt'>) => void;
  updateCustomer: (id: string, c: Partial<Customer>) => void;
  deleteCustomer: (id: string) => void;
  addLoan: (l: Omit<Loan, 'id' | 'loanNumber' | 'interest' | 'status'>) => void;
  updateLoan: (id: string, l: Partial<Loan>) => void;
  deleteLoan: (id: string) => void;
  closeLoan: (id: string) => void;
  addCollection: (c: Omit<Collection, 'id' | 'receiptNo'>) => void;
  updateCollection: (id: string, c: Partial<Collection>) => void;
  deleteCollection: (id: string) => void;
  addExpense: (e: Omit<Expense, 'id'>) => void;
  updateExpense: (id: string, e: Partial<Expense>) => void;
  deleteExpense: (id: string) => void;
  addDocument: (d: Omit<DocItem, 'id'>) => void;
  deleteDocument: (id: string) => void;
  collectedFor: (loanId: string) => number;
  totalDueForDaily: (loan: Loan) => number;
  totalDueForMonthly: (loan: Loan) => number;
  outstandingFor: (loan: Loan) => number;
  nextDueForDaily: (loan: Loan) => string | null;
}
const DataCtx = createContext<DataShape | null>(null);
export const useData = () => {
  const c = useContext(DataCtx);
  if (!c) throw new Error('useData must be used within DataProvider');
  return c;
};

export function DataProvider({ children }: { children: ReactNode }) {
  const [customers, setCustomers] = useState<Customer[]>(seedCustomers);
  const [loans, setLoans] = useState<Loan[]>(seedLoans);
  const [collections, setCollections] = useState<Collection[]>(seedCollections);
  const [expenses, setExpenses] = useState<Expense[]>(seedExpenses);
  const [documents, setDocuments] = useState<DocItem[]>(seedDocs);
  const [codeSeq, setCodeSeq] = useState(1006);
  const [loanSeq, setLoanSeq] = useState(4006);
  const [rcptSeq, setRcptSeq] = useState(100010);

  const value = useMemo<DataShape>(() => {
    const collectedFor = (loanId: string) => collections.filter((c) => c.loanId === loanId).reduce((s, c) => s + c.amount, 0);
    /** Cumulative shortfall for a daily-cadence loan: elapsed days (capped at its term) × daily amount, less what's been collected. */
    const totalDueForDaily = (loan: Loan) => {
      const capped = Math.min(elapsedDaysSinceLoan(loan.loanDate), loan.numDays ?? 100);
      return Math.max(0, capped * (loan.dailyAmount ?? 0) - collectedFor(loan.id));
    };
    /** Cumulative interest shortfall for a Monthly Interest loan: completed 30-day cycles × monthly interest, less what's been collected. */
    const totalDueForMonthly = (loan: Loan) => Math.max(0, monthlyCyclesElapsed(loan.loanDate, cycleDaysFor(loan)) * loan.interest - collectedFor(loan.id));
    /** Daily Collection: interest deducted upfront, only the principal remains payable, decreasing as it's collected.
     *  Daily Interest: interest-only, daily cadence (like Monthly Interest but per day) — Principal stays fixed;
     *  Outstanding rises above Principal if payments fall behind what's owed by today.
     *  Monthly Interest: interest is also deducted upfront; Outstanding = Principal + any overdue interest shortfall.
     *  Vehicle / Property / Flexible: principal + interest less what's been collected. */
    const outstandingFor = (loan: Loan) => {
      const collected = collectedFor(loan.id);
      if (loan.type === 'DAILY_COLLECTION') return Math.max(0, loan.principal - collected);
      if (loan.type === 'DAILY_INTEREST') return loan.status === 'CLOSED' ? 0 : loan.principal + totalDueForDaily(loan);
      if (isMonthlyLike(loan.type)) return loan.status === 'CLOSED' ? 0 : loan.principal + totalDueForMonthly(loan);
      return Math.max(0, loan.principal + loan.interest - collected); // unreachable — every type above is covered
    };
    /** Next due date for a daily loan: the day after the latest recorded collection, or loanDate + 1 if none yet. Returns null once fully collected. */
    const nextDueForDaily = (loan: Loan) => {
      if (Math.max(0, loan.principal - collectedFor(loan.id)) <= 0) return null; // fully repaid
      const loanColls = collections.filter((c) => c.loanId === loan.id);
      const lastDate = loanColls.reduce((max, c) => (c.date > max ? c.date : max), loan.loanDate);
      const nextIso = addDays(lastDate, 1);
      const [ly, lm, ld] = loan.loanDate.split('-').map(Number);
      const termIso = isoLocal(new Date(ly, lm - 1, ld + (loan.numDays ?? 100) - 1));
      return nextIso > termIso ? termIso : nextIso;
    };
    return {
      customers, loans, collections, expenses, documents,
      nextCode: () => 'CUST-' + codeSeq,
      nextLoanNo: () => 'LN-' + loanSeq,
      addCustomer: (c) => {
        setCustomers((s) => [{ ...c, id: uid(), code: 'CUST-' + codeSeq, createdAt: todayISO() }, ...s]);
        setCodeSeq((n) => n + 1);
      },
      updateCustomer: (id, patch) => setCustomers((s) => s.map((c) => (c.id === id ? { ...c, ...patch } : c))),
      deleteCustomer: (id) => {
        const loanIds = new Set(loans.filter((l) => l.customerId === id).map((l) => l.id));
        setCustomers((s) => s.filter((c) => c.id !== id));
        setLoans((s) => s.filter((l) => l.customerId !== id));
        setCollections((s) => s.filter((c) => !loanIds.has(c.loanId)));
        setDocuments((s) => s.filter((doc) => doc.customerId !== id));
      },
      addLoan: (l) => {
        const interest = calcInterest(l.principal, l.rate);
        setLoans((s) => [{ ...l, id: uid(), loanNumber: 'LN-' + loanSeq, interest, deduction: isDailyLoan(l.type) ? interest : undefined, status: 'ACTIVE' }, ...s]);
        setLoanSeq((n) => n + 1);
      },
      closeLoan: (id) => setLoans((s) => s.map((l) => (l.id === id ? { ...l, status: 'CLOSED' } : l))),
      updateLoan: (id, patch) => setLoans((s) => s.map((l) => {
        if (l.id !== id) return l;
        const merged = { ...l, ...patch };
        const interest = patch.principal != null || patch.rate != null ? calcInterest(merged.principal, merged.rate) : merged.interest;
        return { ...merged, interest, deduction: isDailyLoan(merged.type) ? interest : undefined };
      })),
      deleteLoan: (id) => { setLoans((s) => s.filter((l) => l.id !== id)); setCollections((s) => s.filter((c) => c.loanId !== id)); },
      addCollection: (c) => {
        setCollections((s) => [{ ...c, id: uid(), receiptNo: 'RCPT-' + rcptSeq }, ...s]);
        setRcptSeq((n) => n + 1);
      },
      updateCollection: (id, patch) => setCollections((s) => s.map((c) => (c.id === id ? { ...c, ...patch } : c))),
      deleteCollection: (id) => setCollections((s) => s.filter((c) => c.id !== id)),
      addExpense: (e) => setExpenses((s) => [{ ...e, id: uid() }, ...s]),
      updateExpense: (id, patch) => setExpenses((s) => s.map((e) => (e.id === id ? { ...e, ...patch } : e))),
      deleteExpense: (id) => setExpenses((s) => s.filter((e) => e.id !== id)),
      addDocument: (d) => setDocuments((s) => [{ ...d, id: uid() }, ...s]),
      deleteDocument: (id) => setDocuments((s) => s.filter((d) => d.id !== id)),
      collectedFor, outstandingFor, nextDueForDaily, totalDueForDaily, totalDueForMonthly,
    };
  }, [customers, loans, collections, expenses, documents, codeSeq, loanSeq, rcptSeq]);

  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}
