import { useEffect, useMemo, useState } from 'react';
import { useData, LOAN_LABELS, isDailyLoan, isEmiLoan, isInstalmentLoan, isInterestOnly, emiFor, upfrontDeduction, DAILY_COLLECTION_RETAINED_MONTHS, type Loan, type LoanType, type RepaymentMode } from '@/mock/DataContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { Drawer } from '@/components/ui/drawer';
import { PageHeader, HeaderPrimaryButton } from '@/components/layout/PageHeader';
import { inr, inrShort, fmtDate, todayISO, addDays, initials, DAILY_TERM } from '@/lib/format';
import { emptyNum, matchNum, numActive, type NumFilter } from '@/lib/customerFilters';
import { FilterCard, SegGroup, Seg, NumFilterRow, MatchPreview } from '@/components/ui/filter-kit';
import { StatCard } from '@/components/ui/stat-card';
import { config } from '@/lib/config';
import { ApiError } from '@/lib/api';
import { loanApi } from '@/services/loanApi';
import {
  Search, Plus, FileText, Pencil, Trash2, CheckCircle2, SlidersHorizontal, MoreVertical,
  Wallet, AlertTriangle, CalendarClock, Layers, Lock, RotateCcw, ArrowUpDown, Activity, IndianRupee,
  User, Calendar, Car, Phone, Calculator, Percent, X, ChevronLeft, ChevronRight, ChevronDown,
} from 'lucide-react';
import { LedgerDialog } from '@/components/LedgerDialog';
import { DatePicker } from '@/components/ui/date-picker';

const TYPE_OPTS = (Object.keys(LOAN_LABELS) as LoanType[]).map((v) => ({ value: v, label: LOAN_LABELS[v] }));

// Type chip colors — tuned for a light canvas (from the approved design).
const TYPE_META: Record<LoanType, { bg: string; fg: string; bd: string; dot: string }> = {
  DAILY_COLLECTION:   { bg: '#e7f6ef', fg: '#15803d', bd: '#c3ead6', dot: '#22c55e' },
  VEHICLE:            { bg: '#fdf3e0', fg: '#b45309', bd: '#f5e0b8', dot: '#f59e0b' },
  PROPERTY:           { bg: '#fdece2', fg: '#c2410c', bd: '#f7d5c1', dot: '#f97316' },
  DAILY_INTEREST:     { bg: '#f3ebfd', fg: '#7c3aed', bd: '#e0cffb', dot: '#a855f7' },
  MONTHLY_INTEREST:   { bg: '#e0f2f1', fg: '#0f766e', bd: '#b8e0dc', dot: '#14b8a6' },
  FLEXIBLE:           { bg: '#eceefe', fg: '#4f46e5', bd: '#d5d9fb', dot: '#818cf8' },
};

// One-line plain-English explanation of each product's economics.
const TYPE_EXPLAINER: Record<LoanType, string> = {
  DAILY_COLLECTION: '3 months of interest retained upfront (net = principal − 3× interest); daily instalments repay the full principal. Term = principal ÷ daily amount.',
  VEHICLE: 'Vehicle-secured EMI. Full principal disbursed; repaid in equal monthly EMIs including interest.',
  PROPERTY: 'Property-secured EMI. Full principal disbursed; repaid in equal monthly EMIs including interest.',
  DAILY_INTEREST: 'Interest-only. Customer pays the interest amount every day; the principal stays until separately settled.',
  MONTHLY_INTEREST: 'Interest-only. Customer pays the interest amount every month; the principal stays until separately settled.',
  FLEXIBLE: 'Custom term — one interest cycle over the chosen number of days; principal settled at the end.',
};

/** Signed calendar days from today to a YYYY-MM-DD date (negative = past). */
const daysUntil = (iso: string) => {
  const [y, m, dd] = iso.split('-').map(Number);
  const [ty, tm, td] = todayISO().split('-').map(Number);
  return Math.round((new Date(y, m - 1, dd).getTime() - new Date(ty, tm - 1, td).getTime()) / 86400000);
};

interface LoanForm {
  id?: number; customerId: string; type: LoanType; repaymentMode: RepaymentMode; principal: string; rate: string; loanDate: string;
  contact: string; remarks: string; dailyAmount: string; numDays: string;
  vehicleNumber: string; vehicleBrand: string; vehicleName: string;
}
const blank = (): LoanForm => ({
  customerId: '', type: 'DAILY_COLLECTION', repaymentMode: 'EMI', principal: '', rate: '', loanDate: todayISO(),
  contact: '', remarks: '', dailyAmount: '', numDays: '30', vehicleNumber: '', vehicleBrand: '', vehicleName: '',
});

/** Vehicle/Property repayment behavior: Tenure (EMI) or open-ended monthly interest. */
const REPAY_OPTS: { value: RepaymentMode; label: string }[] = [
  { value: 'EMI', label: 'Tenure (EMI)' },
  { value: 'MONTHLY_INTEREST', label: 'Monthly interest' },
];

/** Per-field validation errors for the loan form. */
type LoanErrors = Partial<Record<keyof LoanForm, string>>;

/** Map the backend's snake_case field errors onto the form's camelCase fields. */
const API_FIELD_TO_FORM: Record<string, keyof LoanForm> = {
  customer_id: 'customerId', type: 'type', principal: 'principal', rate: 'rate',
  loan_date: 'loanDate', num_days: 'numDays', contact: 'contact', remarks: 'remarks',
  vehicle_number: 'vehicleNumber', vehicle_brand: 'vehicleBrand', vehicle_name: 'vehicleName',
};
function mapLoanApiErrors(e: unknown): LoanErrors {
  if (!(e instanceof ApiError) || !e.fields) return {};
  const out: LoanErrors = {};
  for (const [k, msg] of Object.entries(e.fields)) {
    const formKey = API_FIELD_TO_FORM[k];
    if (formKey) out[formKey] = msg;
  }
  return out;
}

// ── Industrial-standard field limits ──
const MAX_PRINCIPAL = 100_000_000;   // ₹10 crore sanity cap
const MIN_PRINCIPAL = 100;           // ₹100 floor
const MAX_RATE = 100;                // percent
const MAX_EMI_MONTHS = 360;          // 30 years
const MAX_FLEX_DAYS = 3650;          // ~10 years
const MOBILE_RE = /^[6-9]\d{9}$/;    // Indian mobile
const VEHICLE_RE = /^[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{0,3}[ -]?\d{1,4}$/i; // lenient Indian plate
const MAX_REMARKS = 300;

const isIntStr = (s: string) => /^\d+$/.test(s.trim());
const isNumStr = (s: string) => /^\d+(\.\d+)?$/.test(s.trim());

/** Validate the whole loan form to industrial standard. Returns per-field errors. */
function validateLoanForm(f: LoanForm): LoanErrors {
  const e: LoanErrors = {};
  const P = Number(f.principal);
  const R = Number(f.rate);
  // EMI = Vehicle/Property in Tenure mode. In Monthly-interest mode they behave
  // interest-only (open-ended), so no tenure is required.
  const emi = isEmiLoan(f.type) && f.repaymentMode !== 'MONTHLY_INTEREST';
  const flex = f.type === 'FLEXIBLE';

  // Customer
  if (!f.customerId) e.customerId = 'Select a customer';

  // Principal — whole rupees only (no paise/decimals).
  if (!f.principal.trim()) e.principal = 'Principal is required';
  else if (!isNumStr(f.principal)) e.principal = 'Enter a valid amount';
  else if (!isIntStr(f.principal)) e.principal = 'Enter a whole rupee amount';
  else if (P < MIN_PRINCIPAL) e.principal = `Minimum ${inr(MIN_PRINCIPAL)}`;
  else if (P > MAX_PRINCIPAL) e.principal = `Cannot exceed ${inrShort(MAX_PRINCIPAL)}`;

  // Rate — up to 2 decimals (0.25, 1.5, 12).
  if (!f.rate.trim()) e.rate = 'Interest rate is required';
  else if (!isNumStr(f.rate)) e.rate = 'Enter a valid rate';
  else if (R <= 0) e.rate = 'Rate must be greater than 0';
  else if (R > MAX_RATE) e.rate = `Rate cannot exceed ${MAX_RATE}%`;
  else if (Math.round(R * 100) !== R * 100) e.rate = 'Rate can have at most 2 decimals';

  // Tenure — EMI (months) / Flexible (days)
  if (emi) {
    if (!f.numDays.trim()) e.numDays = 'Tenure is required';
    else if (!isIntStr(f.numDays)) e.numDays = 'Enter whole months';
    else if (Number(f.numDays) < 1) e.numDays = 'At least 1 month';
    else if (Number(f.numDays) > MAX_EMI_MONTHS) e.numDays = `Max ${MAX_EMI_MONTHS} months`;
  } else if (flex) {
    if (!f.numDays.trim()) e.numDays = 'Number of days is required';
    else if (!isIntStr(f.numDays)) e.numDays = 'Enter whole days';
    else if (Number(f.numDays) < 1) e.numDays = 'At least 1 day';
    else if (Number(f.numDays) > MAX_FLEX_DAYS) e.numDays = `Max ${MAX_FLEX_DAYS} days`;
  }

  // Loan date — required, valid, not future, not absurdly old
  if (!f.loanDate) e.loanDate = 'Loan date is required';
  else {
    const dd = daysUntil(f.loanDate);
    if (Number.isNaN(dd)) e.loanDate = 'Invalid date';
    else if (dd > 0) e.loanDate = 'Loan date cannot be in the future';
    else if (dd < -3650) e.loanDate = 'Date is too far in the past';
  }

  // Contact — optional, but must be a valid mobile if provided
  if (f.contact.trim() && !MOBILE_RE.test(f.contact.trim()))
    e.contact = 'Enter a valid 10-digit mobile';

  // Vehicle number — required for Vehicle loans, format-checked
  if (f.type === 'VEHICLE') {
    if (!f.vehicleNumber.trim()) e.vehicleNumber = 'Vehicle number is required';
    else if (!VEHICLE_RE.test(f.vehicleNumber.trim())) e.vehicleNumber = 'Format e.g. KL-07-AB-1234';
  }

  // Remarks — optional, length-capped
  if (f.remarks.trim().length > MAX_REMARKS) e.remarks = `Max ${MAX_REMARKS} characters`;

  return e;
}

type Urgency = 'all' | 'overdue' | 'soon';
type SortMode = 'newest' | 'urgency' | 'amount';

/** Drawer-managed loan filters (draft is edited in the drawer, applied on button). */
interface LoanFilters {
  status: '' | 'ACTIVE' | 'CLOSED';
  types: LoanType[];        // loan is one of these (empty = any)
  outstanding: NumFilter;   // rupees
  principal: NumFilter;     // rupees
  sort: SortMode;
}
const defaultLoanFilters = (): LoanFilters => ({
  status: '', types: [], outstanding: emptyNum(), principal: emptyNum(), sort: 'newest',
});

const PAGE_SIZE_OPTIONS = [6, 10, 25, 50];

/** Page-number list with ellipses for the pagination footer. */
function loanPageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push('…');
  for (let p = start; p <= end; p++) out.push(p);
  if (end < total - 1) out.push('…');
  out.push(total);
  return out;
}
/** How many drawer dimensions are constraining the list (sort excluded). */
const countLoanFilters = (f: LoanFilters) =>
  (f.status ? 1 : 0) + (f.types.length ? 1 : 0) + (numActive(f.outstanding) ? 1 : 0) + (numActive(f.principal) ? 1 : 0);

export default function Loans() {
  const d = useData();
  const toast = useToast();
  const [form, setForm] = useState<LoanForm | null>(null);
  const [ledger, setLedger] = useState<Loan | null>(null);
  const [confirm, setConfirm] = useState<Loan | null>(null);
  const [closeTarget, setCloseTarget] = useState<Loan | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null); // row whose ⋮ menu is open
  const [urgency, setUrgency] = useState<Urgency>('all');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<LoanFilters>(defaultLoanFilters);
  const [draft, setDraft] = useState<LoanFilters>(defaultLoanFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [errors, setErrors] = useState<LoanErrors>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);

  const custName = (id: number) => d.customers.find((c) => c.id === id)?.name ?? '—';
  const set = <K extends keyof LoanForm>(k: K, v: string) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e)); // clear this field's error as the user edits
  };

  // ── Live loan preview — the single source of truth for every auto-calc shown
  //    in the form. Mirrors backend/internal/domain/loan.go economics exactly. ──
  const preview = useMemo(() => {
    const principal = form ? Number(form.principal) || 0 : 0;
    const rate = form ? Number(form.rate) || 0 : 0;
    const type = form?.type ?? 'DAILY_COLLECTION';
    const loanDate = form?.loanDate ?? todayISO();

    // Vehicle/Property in Monthly-interest mode behaves exactly like Monthly
    // Interest (30-day recurring interest, open-ended) rather than as an EMI.
    const monthlyMode = isEmiLoan(type) && (form?.repaymentMode === 'MONTHLY_INTEREST');
    const instalment = isInstalmentLoan(type);      // Daily Collection — upfront interest
    const emi = isEmiLoan(type) && !monthlyMode;     // Vehicle / Property — flat-interest EMI
    const interestOnly = isInterestOnly(type) || monthlyMode; // Daily/Monthly Interest, Flexible, monthly-mode Vehicle/Property
    // Interest cadence in days: Daily=1, Flexible=entered days, else 30.
    const cadenceDays = isDailyLoan(type) || type === 'DAILY_INTEREST' ? 1
      : type === 'FLEXIBLE' ? (form ? Number(form.numDays) || 30 : 30)
      : 30;

    // Overall interest = round(principal × rate / 100), once. Upfront deduction:
    // Daily Collection retains 3× interest; EMI / interest-only / Flexible take nothing.
    const interest = Math.round((principal * rate) / 100);
    const deduction = upfrontDeduction(type, interest);
    const netDisbursed = Math.max(0, principal - deduction);

    // Term, per-period amount, EMI.
    //  • DAILY_COLLECTION: term FIXED 100 days; daily AUTO = principal ÷ 100.
    //  • EMI (Vehicle/Property): tenure = entered months; EMI AUTO = (principal + interest) ÷ months.
    //  • Flexible: user-entered day-count. Interest-only: OPEN-ENDED.
    const months = form ? Number(form.numDays) || 0 : 0;
    const emiAmount = emi ? emiFor(principal, interest, months) : 0;
    const daily = type === 'DAILY_COLLECTION' ? (principal > 0 ? Math.round(principal / DAILY_TERM) : 0)
      : emi ? emiAmount
      : 0;
    const term = type === 'DAILY_COLLECTION' ? (principal > 0 ? DAILY_TERM : 0)
      : type === 'FLEXIBLE' ? months
      : emi ? months
      : 0;
    const numDays = term;

    // First due + maturity. Collection starts the DAY AFTER disbursement, so
    // with `term` instalments the last one falls on start + term × cadence.
    //  • Daily Collection: 1st = +1 day, last (100th) = start + 100 days.
    //  • EMI: 1st = +30 days, last (nth) = start + term × 30 days.
    //  • Flexible: single cycle ends at start + term days.
    const firstDue = addDays(loanDate, cadenceDays); // daily +1, monthly +30, Flexible +N, EMI +30
    const maturity = instalment && term > 0 ? addDays(loanDate, term * cadenceDays)  // daily: +term days
      : emi && term > 0 ? addDays(loanDate, term * 30)                  // EMI: +term months
      : null; // interest-only (incl. Flexible) → open-ended

    // Expected total collection: Daily Collection repays principal; EMI repays
    // principal + interest; interest-accruing (incl. Flexible) is open-ended → null.
    const totalRepayable = instalment ? principal
      : emi ? principal + interest
      : null;

    // Per-period figure label/value.
    const perLabel = cadenceDays === 1 ? 'Per day' : emi ? 'EMI / month'
      : type === 'MONTHLY_INTEREST' || monthlyMode ? 'Per month'
      : type === 'FLEXIBLE' ? `Every ${cadenceDays} days` : 'One cycle';
    const perValue = interestOnly ? interest : instalment ? daily : emi ? emiAmount : interest;

    // Effective annualized rate (display-only).
    const annualPct = interestOnly
      ? rate * (365 / cadenceDays)
      : emi
        ? (principal > 0 && months > 0 ? (interest / principal) * 100 * (12 / months) : 0)
        : (() => {
            const termDaysTotal = term * cadenceDays;
            return principal > 0 && termDaysTotal > 0 ? (interest / principal) * 100 * (365 / termDaysTotal) : 0;
          })();

    return { principal, rate, interest, deduction, netDisbursed, numDays, emi, months, emiAmount, instalment, interestOnly, cadenceDays, startDate: loanDate, firstDue, maturity, totalRepayable, perLabel, perValue, annualPct, type, daily };
  }, [form]);
  const { interest, deduction, netDisbursed } = preview;

  /** Effective next-due date — the live amount-based figure for EVERY loan type
   *  (mirrors backend Loan.NextDue): advances only when instalments/periods are
   *  actually funded, so overdue detection is truthful in both mock and API mode. */
  const nextDueOf = (l: Loan): string | null => d.nextDueFor(l);

  /** End/maturity date. Collection starts the day after disbursement, so the
   *  last of `term` instalments lands on start + term × cadence. Interest-accruing
   *  loans (Daily/Monthly Interest, Flexible) are open-ended → null. */
  const endDateOf = (l: Loan): string | null => {
    if (isInterestOnly(l.type)) return null; // includes Flexible (recurring interest, no fixed end)
    if (isInstalmentLoan(l.type) && l.numDays) return addDays(l.loanDate, l.numDays); // daily: +term days
    if (isEmiLoan(l.type) && l.numDays) return addDays(l.loanDate, l.numDays * 30);    // EMI: +term months
    return null;
  };

  /** Signed days until due; null when there is no upcoming due (completed/closed). */
  const dueInDaysOf = (l: Loan): number | null => {
    if (l.status !== 'ACTIVE') return null;
    const nd = nextDueOf(l);
    return nd ? daysUntil(nd) : null;
  };

  const stats = useMemo(() => ({
    count: d.loans.length,
    outstanding: d.loans.reduce((s, l) => s + d.outstandingFor(l), 0),
    overdue: d.loans.filter((l) => { const dd = dueInDaysOf(l); return dd != null && dd < 0; }).length,
    soon: d.loans.filter((l) => { const dd = dueInDaysOf(l); return dd != null && dd >= 0 && dd <= 3; }).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [d.loans, d.collections]);

  /** Does a loan pass the toolbar state (urgency, query) plus a filter set? */
  const loanPasses = (l: Loan, f: LoanFilters): boolean => {
    if (urgency === 'overdue') { const dd = dueInDaysOf(l); if (dd == null || dd >= 0) return false; }
    if (urgency === 'soon') { const dd = dueInDaysOf(l); if (dd == null || dd < 0 || dd > 3) return false; }
    if (query.trim()) {
      const q = query.toLowerCase();
      if (!custName(l.customerId).toLowerCase().includes(q)
        && !l.loanNumber.toLowerCase().includes(q)
        && !LOAN_LABELS[l.type].toLowerCase().includes(q)) return false;
    }
    if (f.status && l.status !== f.status) return false;
    if (f.types.length && !f.types.includes(l.type)) return false;
    if (!matchNum(d.outstandingFor(l), f.outstanding)) return false;
    if (!matchNum(l.principal, f.principal)) return false;
    return true;
  };

  const rows = useMemo(() => {
    const r = d.loans.filter((l) => loanPasses(l, filters));
    if (filters.sort === 'newest') r.sort((a, b) => b.id - a.id); // latest-created first
    if (filters.sort === 'urgency') r.sort((a, b) => (dueInDaysOf(a) ?? 9999) - (dueInDaysOf(b) ?? 9999));
    if (filters.sort === 'amount') r.sort((a, b) => d.outstandingFor(b) - d.outstandingFor(a));
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.loans, d.collections, d.customers, filters, urgency, query]);

  // Pagination (mirrors Customers). Reset to page 1 whenever the result set changes.
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(1); }, [query, urgency, filters, pageSize]);

  // Live count of what the drawer draft would match (respects urgency + search).
  const draftMatchCount = useMemo(
    () => d.loans.filter((l) => loanPasses(l, draft)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d.loans, d.collections, d.customers, draft, urgency, query],
  );

  const activeFilterCount = countLoanFilters(filters);
  const filtersOn = activeFilterCount > 0 || urgency !== 'all' || !!query;
  const activeLabel = urgency === 'overdue' ? 'overdue' : urgency === 'soon' ? 'due soon' : 'loans';
  const openFilters = () => { setDraft(filters); setFilterOpen(true); };
  const applyDraft = () => { setFilters(draft); setFilterOpen(false); };

  const save = async () => {
    if (!form) return;
    // Industrial-standard validation — every field asserted before save.
    const found = validateLoanForm(form);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      toast('Please fix the highlighted fields', 'error');
      return;
    }
    setErrors({});
    // Vehicle/Property in Monthly-interest mode behaves like Monthly Interest:
    // open-ended, per-period = interest, next due +30 days (no EMI term).
    const monthlyMode = isEmiLoan(form.type) && form.repaymentMode === 'MONTHLY_INTEREST';
    const instalment = isInstalmentLoan(form.type);
    const interestOnly = isInterestOnly(form.type) || monthlyMode;
    const emi = isEmiLoan(form.type) && !monthlyMode;
    const principalNum = Number(form.principal);
    const monthsNum = Number(form.numDays);
    const cadenceDays = isDailyLoan(form.type) || form.type === 'DAILY_INTEREST' ? 1 : 30;
    const autoInterest = Math.round((principalNum * Number(form.rate)) / 100);
    // Term:
    //  • DAILY_COLLECTION: fixed 100-day term.  • EMI: tenure in months.
    //  • Flexible: entered days.  • Interest-only (incl. monthly-mode): open-ended.
    const term = form.type === 'DAILY_COLLECTION' ? DAILY_TERM
      : form.type === 'FLEXIBLE' ? monthsNum
      : emi ? monthsNum
      : undefined;
    // dailyAmount = per-period amount: auto principal÷100 for Daily Collection,
    // auto EMI for Vehicle/Property, auto interest for interest-only.
    const dailyAmount = form.type === 'DAILY_COLLECTION' ? Math.round(principalNum / DAILY_TERM)
      : emi ? emiFor(principalNum, autoInterest, monthsNum)
      : interestOnly ? autoInterest
      : undefined;
    const payload = {
      customerId: Number(form.customerId), type: form.type,
      repaymentMode: isEmiLoan(form.type) ? form.repaymentMode : undefined,
      principal: principalNum, rate: Number(form.rate),
      loanDate: form.loanDate, contact: form.contact || undefined, remarks: form.remarks || undefined,
      dailyAmount,
      numDays: term,
      nextDueDate: form.type === 'FLEXIBLE' ? addDays(form.loanDate, monthsNum)
        : instalment || interestOnly || emi ? addDays(form.loanDate, cadenceDays) : undefined,
      vehicleNumber: form.type === 'VEHICLE' ? form.vehicleNumber : undefined,
      vehicleBrand: form.type === 'VEHICLE' ? form.vehicleBrand : undefined,
      vehicleName: form.type === 'VEHICLE' ? form.vehicleName : undefined,
    };
    // In API mode call the backend directly and AWAIT it so failures surface
    // (the server derives all money math and validates the date/fields). Only
    // toast success and close the form when the write actually succeeds.
    if (config.useApi) {
      try {
        if (form.id) {
          const updated = await loanApi.update(form.id, payload);
          d.updateLoanRecord(updated);
          toast('Loan updated');
        } else {
          const created = await loanApi.create(payload);
          d.addLoanRecord(created);
          toast('Loan created');
        }
      } catch (e) {
        setErrors(mapLoanApiErrors(e));
        toast(e instanceof ApiError ? e.message : 'Failed to save loan', 'error');
        return; // keep the form open so the user can correct it
      }
    } else {
      if (form.id) { d.updateLoan(form.id, payload); toast('Loan updated'); }
      else { d.addLoan(payload); toast('Loan created'); }
    }
    setForm(null);
  };

  const editLoan = (l: Loan) => {
    setErrors({});
    setForm({
      id: l.id, customerId: String(l.customerId), type: l.type, repaymentMode: l.repaymentMode ?? 'EMI', principal: String(l.principal), rate: String(l.rate), loanDate: l.loanDate,
      contact: l.contact ?? '', remarks: l.remarks ?? '', dailyAmount: String(l.dailyAmount ?? ''), numDays: String(l.numDays ?? 30),
      vehicleNumber: l.vehicleNumber ?? '', vehicleBrand: l.vehicleBrand ?? '', vehicleName: l.vehicleName ?? '',
    });
  };
  const openCreate = () => { setErrors({}); setForm(blank()); };

  // Desktop-only table grid. Below lg, rows fall back to a stacked card layout.
  const GRID = 'lg:grid lg:grid-cols-[1.55fr_1.2fr_1fr_0.95fr_1.2fr_1.05fr_1fr_92px] lg:items-center lg:gap-4';

  return (
    <div className="flex min-h-full flex-col">
      {/* Dark page header */}
      <PageHeader
        icon={<Layers size={20} />}
        title="Loans"
        subtitle={`${stats.count} loans across ${TYPE_OPTS.length} types · automatic interest`}
        actions={<HeaderPrimaryButton beam icon={<Plus size={14} />} onClick={openCreate}>Create Loan</HeaderPrimaryButton>}
      />

      <div className="flex flex-1 flex-col gap-4 p-3.5 sm:px-5">
        {/* Stat cards / triage filters */}
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <StatCard label="Total loans" value={String(stats.count)} accent="#6366f1" icon={<Layers size={16} />}
            active={urgency === 'all'} onClick={() => setUrgency('all')} />
          <StatCard label="Total outstanding" value={inr(stats.outstanding)} accent="#8b5cf6" icon={<Wallet size={16} />} countUp={stats.outstanding} />
          <StatCard label="Overdue" value={String(stats.overdue)} accent="#ef4444" icon={<AlertTriangle size={16} />}
            active={urgency === 'overdue'} onClick={() => setUrgency('overdue')} />
          <StatCard label="Due within 3 days" value={String(stats.soon)} accent="#f59e0b" icon={<CalendarClock size={16} />}
            active={urgency === 'soon'} onClick={() => setUrgency('soon')} />
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[14px]">
            <span className="text-muted">Showing</span>
            <span className="font-bold text-ink">{rows.length}</span>
            <span className="text-muted">{activeLabel}</span>
            {filtersOn && (
              <button
                onClick={() => { setFilters(defaultLoanFilters()); setDraft(defaultLoanFilters()); setUrgency('all'); setQuery(''); }}
                className="ml-1 text-[13px] font-semibold text-blue-500 hover:underline"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search */}
            <div className="flex w-full sm:w-60 items-center gap-2 rounded-[11px] border-[0.5px] border-slate-200/80 bg-white px-3.5 py-[9px] focus-within:border-blue-400 dark:border-white/[.08] dark:bg-surface">
              <Search size={16} className="shrink-0 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search loan, borrower…"
                className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-muted"
              />
            </div>

            {/* Filters — opens the premium drawer (same pattern as Customers) */}
            <button
              onClick={openFilters}
              className={`relative inline-flex items-center gap-2 rounded-[11px] border-[0.5px] px-4 py-[9px] text-[14px] font-semibold transition-colors ${
                activeFilterCount > 0
                  ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-400/40 dark:bg-blue-500/15 dark:text-blue-300'
                  : 'border-slate-200/80 bg-white text-ink/80 hover:bg-slate-50 dark:border-white/[.08] dark:bg-surface dark:hover:bg-white/[.03]'
              }`}
            >
              <SlidersHorizontal size={16} /> Filters
              {activeFilterCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1.5 text-[11px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Column header — solid full-color band */}
        <div className={`${GRID} hidden rounded-xl bg-gradient-to-r from-blue-800 via-blue-700 to-blue-600 px-5 py-3.5 text-[12px] font-bold uppercase tracking-[0.08em] text-white shadow-[0_4px_14px_rgba(37,99,235,.35)] lg:grid`}>
          <div>Borrower</div>
          <div>Loan</div>
          <div>Principal</div>
          <div>Instalment</div>
          <div>Collected</div>
          <div>Outstanding</div>
          <div>End date</div>
          <div className="text-right">Status</div>
        </div>

        {/* Rows */}
        <div className="flex flex-col gap-2">
          {pageRows.map((l) => {
            const t = TYPE_META[l.type];
            const dd = dueInDaysOf(l);
            const endDate = endDateOf(l);
            const closed = l.status !== 'ACTIVE';
            // Live repayment figures for this row (all real, never fabricated).
            const rowCollected = d.collectedFor(l.id);
            const perSuffix = l.type === 'FLEXIBLE' ? '' : isDailyLoan(l.type) || l.type === 'DAILY_INTEREST' ? '/day' : '/mo';
            return (
              <div
                key={l.id}
                className={`${GRID} group flex flex-col gap-2.5 rounded-[14px] border-[0.5px] border-slate-200/90 bg-white px-5 py-4 transition-all hover:border-slate-300 hover:shadow-[0_6px_20px_rgba(30,39,64,.08)] lg:hover:-translate-y-px dark:border-white/[.07] dark:bg-surface dark:hover:border-white/[.14] ${
                  menuFor === l.id ? 'relative z-50' : ''
                } ${closed && menuFor !== l.id ? 'opacity-70' : ''}`}
              >
                {/* Borrower — hover reveals the ⋮ actions menu */}
                <div className="flex min-w-0 items-center gap-3">
                  <div className="relative shrink-0">
                    <div
                      className="flex h-[46px] w-[46px] items-center justify-center rounded-2xl border text-[15px] font-bold tracking-tight shadow-sm"
                      style={{ background: t.bg, borderColor: t.bd, color: t.fg }}
                    >
                      {initials(custName(l.customerId))}
                    </div>
                    {/* Loan-type accent dot */}
                    <span
                      className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-surface"
                      style={{ background: t.dot }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold text-ink">{custName(l.customerId)}</div>
                  </div>
                  <div className="relative shrink-0">
                    <button
                      onClick={() => setMenuFor(menuFor === l.id ? null : l.id)}
                      title="Actions" aria-label="Loan actions"
                      className={`grid h-8 w-8 place-items-center rounded-lg text-muted transition-all hover:bg-slate-100 hover:text-ink dark:hover:bg-white/[.08] ${
                        menuFor === l.id ? 'bg-slate-100 opacity-100 dark:bg-white/[.08]' : 'opacity-100'
                      }`}
                    >
                      <MoreVertical size={16} />
                    </button>
                    {menuFor === l.id && (
                      <div className="absolute left-0 top-9 z-50 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-[0_12px_32px_rgba(30,39,64,.18)] dark:border-white/[.12] dark:bg-slate-900">
                          <MenuItem icon={<FileText size={14} />} label="Statement" onClick={() => { setMenuFor(null); setLedger(l); }} />
                          <MenuItem icon={<Pencil size={14} />} label="Edit" onClick={() => { setMenuFor(null); editLoan(l); }} />
                          {l.status === 'ACTIVE' ? (
                            <MenuItem icon={<CheckCircle2 size={14} />} label="Close loan" onClick={() => {
                              setMenuFor(null);
                              const outstanding = d.outstandingFor(l);
                              if (outstanding > 0) { toast(`Cannot close — outstanding balance of ${inr(outstanding)} remains`, 'error'); return; }
                              setCloseTarget(l);
                            }} />
                          ) : (
                            <MenuItem icon={<RotateCcw size={14} />} label="Reopen loan" onClick={() => { setMenuFor(null); d.updateLoan(l.id, { status: 'ACTIVE' }); toast('Loan reopened'); }} />
                          )}
                          <MenuItem danger icon={<Trash2 size={14} />} label="Delete" onClick={() => { setMenuFor(null); setConfirm(l); }} />
                        </div>
                    )}
                  </div>
                </div>

                {/* Loan number + type */}
                <div className="min-w-0">
                  <div className="text-[14.5px] font-semibold tabular-nums text-ink">{l.loanNumber}</div>
                  <div className="mt-[3px] truncate text-[12.5px] font-semibold" style={{ color: t.fg }}>{LOAN_LABELS[l.type]}</div>
                </div>

                {/* Principal */}
                <div className="flex items-center justify-between text-[14.5px] tabular-nums text-ink/75 lg:block">
                  <span className="text-[12.5px] font-medium text-muted lg:hidden">Principal</span>
                  <span className="font-bold text-[13px] sm:text-[14.5px]">{inr(l.principal)}</span>
                </div>

                {/* Instalment (per-period amount) */}
                <div className="flex items-center justify-between tabular-nums lg:block">
                  <span className="text-[12.5px] font-medium text-muted lg:hidden">Instalment</span>
                  <span>
                    <span className="text-[14.5px] font-semibold text-ink">{l.dailyAmount ? inr(l.dailyAmount) : '—'}</span>
                    {l.dailyAmount ? <span className="text-[11px] text-muted">{perSuffix}</span> : null}
                  </span>
                </div>

                {/* Collected + mini progress */}
                <div className="min-w-0">
                  <div className="flex items-center justify-between lg:block">
                    <span className="text-[12.5px] font-medium text-muted lg:hidden">Collected</span>
                    <div className="text-[14.5px] font-semibold tabular-nums text-[#15803d] dark:text-emerald-400">{inr(rowCollected)}</div>
                  </div>
                </div>

                {/* Outstanding */}
                <div className="flex items-center justify-between text-[15.5px] font-bold tabular-nums text-ink lg:block">
                  <span className="text-[12.5px] font-medium text-muted lg:hidden">Outstanding</span>
                  <span className="font-bold">{inr(d.outstandingFor(l))}</span>
                </div>

                {/* End date + urgency */}
                <div className="flex items-center justify-between lg:block">
                  <span className="text-[12.5px] font-medium text-muted lg:hidden">End date</span>
                  <div className="flex items-center gap-2 lg:block">
                    <div className="text-[14px] tabular-nums font-bold text-ink">
                      {endDate ? fmtDate(endDate) : isInterestOnly(l.type) ? <span className="text-muted">Open-ended</span> : '—'}
                    </div>
                    {dd != null && <DueBadge days={dd} />}
                  </div>
                </div>

                {/* Status — Overdue (red) if an active loan's due date has passed,
                    else Active (green) / Closed (grey). */}
                <div className="flex items-center justify-between lg:justify-end">
                  <span className="text-[12.5px] font-medium text-muted lg:hidden">Status</span>
                  {(() => {
                    const overdue = !closed && dd != null && dd < 0;
                    // Closed = settled (indigo), Overdue = red, Active = green.
                    const tone = closed
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                      : overdue
                        ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
                    const dot = closed ? 'bg-blue-500' : overdue ? 'bg-red-500' : 'bg-emerald-500';
                    return (
                      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold ${tone}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                        {closed ? 'Closed' : overdue ? 'Overdue' : 'Active'}
                      </span>
                    );
                  })()}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="rounded-[14px] border-[0.5px] border-slate-200/80 bg-white p-12 text-center text-slate-400 dark:border-white/[.08] dark:bg-surface">
              No loans match that. Try a different search or clear the filter.
            </div>
          )}
        </div>

        {/* Global click-outside overlay for row action menus — rendered outside motion.tr so fixed positioning works correctly */}
        {menuFor !== null && (
          <div className="fixed inset-0 z-40" onClick={() => setMenuFor(null)} />
        )}

        {/* Footer — pagination (matches Customers) */}
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-[14px] text-muted">
            <span>
              Showing <span className="font-semibold text-ink">{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, rows.length)}</span> of{' '}
              <span className="font-semibold text-ink">{rows.length}</span> loans
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="grid h-9 w-9 place-items-center rounded-lg border-[0.5px] border-slate-200 bg-white text-muted transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-white/10 dark:bg-surface"
              >
                <ChevronLeft size={16} />
              </button>
              {loanPageNumbers(currentPage, totalPages).map((p, idx) =>
                p === '…' ? (
                  <span key={`e${idx}`} className="px-1 text-muted">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p as number)}
                    className={`grid h-9 min-w-9 place-items-center rounded-lg px-2.5 text-[14px] font-semibold transition-colors ${
                      p === currentPage
                        ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30'
                        : 'border-[0.5px] border-slate-200 bg-white text-ink/70 hover:bg-slate-50 dark:border-white/10 dark:bg-surface'
                    }`}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="grid h-9 w-9 place-items-center rounded-lg border-[0.5px] border-slate-200 bg-white text-muted transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-white/10 dark:bg-surface"
              >
                <ChevronRight size={16} />
              </button>
              <div className="relative ml-1">
                <select
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                  className="h-9 appearance-none rounded-lg border-[0.5px] border-slate-200 bg-white pl-2.5 pr-8 text-[14px] text-muted outline-none [color-scheme:light] dark:border-white/10 dark:bg-surface dark:[color-scheme:dark]"
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n} style={{ backgroundColor: 'rgb(var(--surface))', color: 'rgb(var(--ink))' }}>{n} / page</option>
                  ))}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Filters — premium right-side drawer (draft, applied on button) */}
      <Drawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        width="md"
        icon={<SlidersHorizontal size={18} />}
        title="Filter loans"
        subtitle="Combine type, portfolio and status criteria"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(defaultLoanFilters())}>Clear all</Button>
            <Button onClick={applyDraft}>Apply filters</Button>
          </>
        }
      >
        <div className="space-y-5">
          <MatchPreview
            matched={draftMatchCount}
            total={d.loans.length}
            activeCount={countLoanFilters(draft)}
            itemLabel="loans"
            onClear={() => setDraft(defaultLoanFilters())}
          />

          {/* Sort */}
          <FilterCard icon={<ArrowUpDown size={16} />} title="Sort by" color="amber" active={draft.sort !== 'newest'}>
            <SegGroup>
              <Seg active={draft.sort === 'newest'} onClick={() => setDraft({ ...draft, sort: 'newest' })} tone="amber">Newest</Seg>
              <Seg active={draft.sort === 'urgency'} onClick={() => setDraft({ ...draft, sort: 'urgency' })} tone="amber">Due next</Seg>
              <Seg active={draft.sort === 'amount'} onClick={() => setDraft({ ...draft, sort: 'amount' })} tone="amber">Largest first</Seg>
            </SegGroup>
          </FilterCard>

          {/* Loan type — exact palette pills */}
          <FilterCard icon={<Layers size={16} />} title="Loan type" color="violet" active={draft.types.length > 0}>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(LOAN_LABELS) as LoanType[]).map((t) => {
                const meta = TYPE_META[t];
                const on = draft.types.includes(t);
                return (
                  <button
                    key={t}
                    onClick={() =>
                      setDraft({ ...draft, types: on ? draft.types.filter((x) => x !== t) : [...draft.types, t] })
                    }
                    className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-all ${
                      on ? '' : 'border-slate-200/70 bg-white text-ink/70 hover:bg-slate-50 dark:border-white/[.08] dark:bg-surface2 dark:text-slate-300 dark:hover:bg-white/[.05]'
                    }`}
                    style={on ? { background: meta.bg, color: meta.fg, borderColor: meta.bd } : undefined}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: meta.dot }} />
                    {LOAN_LABELS[t]}
                  </button>
                );
              })}
            </div>
            {draft.types.length > 0 && (
              <p className="mt-2.5 text-[11px] text-muted">Showing loans of the selected type{draft.types.length > 1 ? 's' : ''}.</p>
            )}
          </FilterCard>

          {/* Portfolio */}
          <FilterCard icon={<IndianRupee size={16} />} title="Amounts" color="emerald" active={numActive(draft.outstanding) || numActive(draft.principal)}>
            <div className="space-y-3">
              <NumFilterRow label="Outstanding" unit="₹" value={draft.outstanding} onChange={(outstanding) => setDraft({ ...draft, outstanding })} />
              <NumFilterRow label="Principal" unit="₹" value={draft.principal} onChange={(principal) => setDraft({ ...draft, principal })} />
            </div>
          </FilterCard>

          {/* Status */}
          <FilterCard icon={<Activity size={16} />} title="Loan status" color="blue" active={!!draft.status}>
            <SegGroup>
              <Seg active={draft.status === ''} onClick={() => setDraft({ ...draft, status: '' })}>All</Seg>
              <Seg active={draft.status === 'ACTIVE'} onClick={() => setDraft({ ...draft, status: 'ACTIVE' })} tone="emerald">Active</Seg>
              <Seg active={draft.status === 'CLOSED'} onClick={() => setDraft({ ...draft, status: 'CLOSED' })}>Closed</Seg>
            </SegGroup>
          </FilterCard>
        </div>
      </Drawer>

      {/* Create / Edit loan — card-based drawer */}
      <Drawer
        open={!!form}
        onClose={() => setForm(null)}
        width="xl"
        icon={<Layers size={18} />}
        title={form?.id ? 'Edit loan' : 'Create loan'}
        subtitle={form && !form.id ? `New loan number: ${d.nextLoanNo()}` : 'Update loan details'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="ghost" onClick={() => setSummaryOpen(true)}>
              <Calculator size={15} /> Preview summary
            </Button>
            <Button onClick={save}>{form?.id ? 'Save changes' : 'Create loan'}</Button>
          </>
        }
      >
        {form && (
          <div className="space-y-4">
            {/* 1 — Borrower & product */}
            <FormCard icon={<User size={16} />} title="Borrower & product" color="blue">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Select label="Customer *" value={form.customerId} onChange={(e) => {
                    const custId = e.target.value;
                    set('customerId', custId);
                    if (custId) {
                      const customer = d.customers.find((c) => c.id === Number(custId));
                      if (customer?.mobile) set('contact', customer.mobile);
                    }
                  }} error={errors.customerId}
                  options={[{ value: '', label: 'Select customer…' }, ...d.customers.map((c) => ({ value: String(c.id), label: `${c.name} (${c.code})` }))]} />
                <Select label="Loan type *" value={form.type} onChange={(e) => set('type', e.target.value)} options={TYPE_OPTS} />
                {/* Repayment mode — Vehicle/Property only. Tenure = EMI; Monthly = interest-only. */}
                {isEmiLoan(form.type) && (
                  <Select label="Repayment *" value={form.repaymentMode} onChange={(e) => set('repaymentMode', e.target.value)} options={REPAY_OPTS} />
                )}
              </div>
              {/* type explainer chip */}
              <div className="mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]"
                style={{ background: TYPE_META[form.type].bg, color: TYPE_META[form.type].fg }}>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_META[form.type].dot }} />
                {TYPE_EXPLAINER[form.type]}
              </div>
            </FormCard>

            {/* 2 — Amounts & interest */}
            <FormCard icon={<IndianRupee size={16} />} title="Amounts & interest" color="emerald">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Principal amount *" type="number" placeholder="0" value={form.principal} onChange={(e) => set('principal', e.target.value)} error={errors.principal} />
                <Input label={preview.emi ? 'Interest rate (% overall) *' : 'Interest rate (%) *'} type="number" step="0.01" placeholder="0" value={form.rate} onChange={(e) => set('rate', e.target.value)} error={errors.rate} />
                {preview.emi && (
                  <Input label="Tenure (months) *" type="number" min="1" placeholder="e.g. 12" value={form.numDays} onChange={(e) => set('numDays', e.target.value)} error={errors.numDays} />
                )}
                {form.type === 'FLEXIBLE' && (
                  <Input label="Number of days *" type="number" min="1" placeholder="e.g. 30" value={form.numDays} onChange={(e) => set('numDays', e.target.value)} error={errors.numDays} />
                )}
              </div>

              {/* auto-calc chips */}
              <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {preview.interestOnly ? (
                  <>
                    <CalcChip label={`${preview.perLabel} interest (auto)`} value={inr(preview.interest)} hint={`${form.rate || 0}% of principal`} />
                    <CalcChip label="Principal disbursed" value={inr(netDisbursed)} tone="success" hint="Full amount given" />
                  </>
                ) : preview.emi ? (
                  <>
                    <CalcChip label="Interest (overall)" value={inr(interest)} hint={`${form.rate || 0}% of principal`} />
                    <CalcChip label="EMI / month (auto)" value={inr(preview.emiAmount)} hint={`(principal + interest) ÷ ${preview.months || 0}`} />
                    <CalcChip label="Total payable" value={inr(preview.principal + interest)} hint="principal + interest" />
                    <CalcChip label="Disbursed" value={inr(netDisbursed)} tone="success" hint="Full principal given" />
                  </>
                ) : (
                  <>
                    <CalcChip label={isDailyLoan(form.type) ? 'Interest / month (auto)' : 'Interest (auto)'} value={inr(interest)} />
                    {isDailyLoan(form.type) && <CalcChip label="Daily collection (auto)" value={inr(preview.daily)} hint={`principal ÷ ${DAILY_TERM}`} />}
                    {preview.instalment && <CalcChip label="Deduction (auto)" value={inr(deduction)} hint={isDailyLoan(form.type) ? `${DAILY_COLLECTION_RETAINED_MONTHS} months × interest, upfront` : 'Deducted upfront'} />}
                    <CalcChip label="Net disbursed" value={inr(netDisbursed)} tone="success" hint="Given to customer" />
                  </>
                )}
              </div>
            </FormCard>

            {/* 3 — Schedule */}
            <FormCard icon={<Calendar size={16} />} title="Schedule" color="violet">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <DatePicker label="Loan date" value={form.loanDate} onChange={(e) => set('loanDate', e.target.value)} error={errors.loanDate} />
                <div>
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">Term (auto)</span>
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-semibold dark:border-white/[.08] dark:bg-white/[.04]">
                    <Lock size={13} className="text-muted" />
                    {preview.interestOnly
                      ? 'Open-ended (until settled)'
                      : preview.numDays > 0
                        ? `${preview.numDays} ${isDailyLoan(form.type) ? 'days' : preview.emi ? 'months' : 'days'}`
                        : preview.emi ? 'Enter tenure' : 'Enter principal'}
                  </div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <CalcChip label="Start date" value={fmtDate(preview.startDate)} />
                <CalcChip
                  label={preview.interestOnly ? 'First due' : preview.maturity ? 'End date' : 'First due'}
                  value={preview.interestOnly ? fmtDate(preview.firstDue) : fmtDate(preview.maturity ?? preview.firstDue)}
                />
              </div>
            </FormCard>

            {/* 4 — Vehicle details (VEHICLE only) */}
            {form.type === 'VEHICLE' && (
              <FormCard icon={<Car size={16} />} title="Vehicle details" color="amber"
                hint="Collateral information for the vehicle loan.">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input label="Vehicle number *" placeholder="KL-07-AB-1234" value={form.vehicleNumber} onChange={(e) => set('vehicleNumber', e.target.value)} error={errors.vehicleNumber} />
                  <Input label="Vehicle brand" placeholder="Maruti" value={form.vehicleBrand} onChange={(e) => set('vehicleBrand', e.target.value)} />
                  <Input label="Vehicle name" placeholder="Ertiga" value={form.vehicleName} onChange={(e) => set('vehicleName', e.target.value)} />
                </div>
              </FormCard>
            )}

            {/* 5 — Contact & notes */}
            <FormCard icon={<Phone size={16} />} title="Contact & notes" color="blue"
              hint="Optional reference details.">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Contact number" placeholder="10-digit mobile" value={form.contact} onChange={(e) => set('contact', e.target.value)} error={errors.contact} />
                <Input label="Remarks" placeholder="Any notes about this loan" value={form.remarks} onChange={(e) => set('remarks', e.target.value)} error={errors.remarks} />
              </div>
            </FormCard>

          </div>
        )}
      </Drawer>

      {/* Loan summary popup */}
      <LoanSummaryPopup open={summaryOpen} onClose={() => setSummaryOpen(false)} p={preview} customer={form ? custName(Number(form.customerId)) : '—'} />

      {ledger && <LedgerDialog loan={ledger} onClose={() => setLedger(null)} statementOnly />}

      <Dialog open={!!confirm} onClose={() => setConfirm(null)} title="Delete loan?" subtitle={confirm ? `${confirm.loanNumber} · ${custName(confirm.customerId)}` : ''}
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { if (confirm) { d.deleteLoan(confirm.id); toast('Loan deleted', 'info'); } setConfirm(null); }}>Delete</Button></>}>
        <p className="text-sm text-muted">This removes the loan from the demo dataset. Its collections remain in history.</p>
      </Dialog>

      <Dialog open={!!closeTarget} onClose={() => setCloseTarget(null)} title="Close this loan?" subtitle={closeTarget ? `${closeTarget.loanNumber} · ${custName(closeTarget.customerId)}` : ''}
        footer={<><Button variant="ghost" onClick={() => setCloseTarget(null)}>Cancel</Button>
          <Button variant="success" onClick={() => { if (closeTarget) { d.closeLoan(closeTarget.id); toast('Loan closed'); } setCloseTarget(null); }}>Close Loan</Button></>}>
        {closeTarget && (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted">Customer</span><span className="font-semibold">{custName(closeTarget.customerId)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Loan Number</span><span className="font-mono font-semibold">{closeTarget.loanNumber}</span></div>
            <div className="flex justify-between"><span className="text-muted">Principal</span><span className="font-semibold">{inr(closeTarget.principal)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Outstanding</span><span className="font-semibold text-success">{inr(d.outstandingFor(closeTarget))}</span></div>
            <p className="pt-2 text-xs text-muted">This loan will be marked as Closed and hidden from active collections. You can reopen it later if needed.</p>
          </div>
        )}
      </Dialog>
    </div>
  );
}

/** Due-date urgency badge — exact tones from the approved design. */
function DueBadge({ days }: { days: number }) {
  let tone: { bg: string; fg: string; bd: string; dot: string };
  let label: string;
  if (days < 0) { tone = { bg: '#fdeaea', fg: '#dc2626', bd: '#f7cfcf', dot: '#ef4444' }; label = `${Math.abs(days)}d overdue`; }
  else if (days === 0) { tone = { bg: '#fdf3e0', fg: '#b45309', bd: '#f5e0b8', dot: '#f59e0b' }; label = 'Due today'; }
  else if (days <= 3) { tone = { bg: '#fdf3e0', fg: '#b45309', bd: '#f5e0b8', dot: '#f59e0b' }; label = `Due in ${days}d`; }
  else { tone = { bg: '#f1f3f8', fg: '#6b7591', bd: '#e2e6ef', dot: '#94a3b8' }; label = `In ${days}d`; }
  return (
    <span
      className="mt-[5px] inline-flex items-center gap-1.5 rounded-full border px-[9px] py-[3px] text-[11.5px] font-semibold"
      style={{ background: tone.bg, color: tone.fg, borderColor: tone.bd }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.dot }} />
      {label}
    </span>
  );
}

/** Borderless icon action button used on each loan row. */
/** One row of the ⋮ actions dropdown on a loan row. */
function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] font-semibold transition-colors ${
        danger
          ? 'text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10'
          : 'text-ink/80 hover:bg-slate-50 hover:text-blue-600 dark:hover:bg-white/[.05] dark:hover:text-blue-400'
      }`}
    >
      {icon} {label}
    </button>
  );
}

// ─────────────── loan form pieces ───────────────
type FormCardColor = 'blue' | 'emerald' | 'violet' | 'amber';
const formCardIcon: Record<FormCardColor, string> = {
  blue: 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
  emerald: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
  violet: 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
  amber: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
};
const formCardAccent: Record<FormCardColor, string> = {
  blue: 'before:bg-blue-500', emerald: 'before:bg-emerald-500', violet: 'before:bg-blue-500', amber: 'before:bg-amber-500',
};

/** Self-documenting section card for the loan form: icon + title + hint. */
function FormCard({ icon, title, hint, color, children }: { icon: React.ReactNode; title: string; hint?: string; color: FormCardColor; children: React.ReactNode }) {
  return (
    <section
      className={`relative overflow-hidden rounded-2xl border-[0.5px] border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)] dark:border-white/[.06] dark:bg-surface2
        before:absolute before:inset-y-0 before:left-0 before:w-1 ${formCardAccent[color]}`}
    >
      <div className="mb-3.5 flex items-center gap-2.5">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${formCardIcon[color]}`}>{icon}</span>
        <div className="min-w-0">
          <h4 className="text-[14px] font-bold tracking-tight text-ink">{title}</h4>
          {hint && <p className="text-[11.5px] text-muted">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** A read-only auto-calculated value chip. */
function CalcChip({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'success' }) {
  return (
    <div className={`rounded-xl border-[0.5px] px-3 py-2.5 ${
      tone === 'success'
        ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/25 dark:bg-emerald-500/10'
        : 'border-slate-200/70 bg-slate-50 dark:border-white/[.06] dark:bg-white/[.03]'
    }`}>
      <div className="flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide text-muted">
        <Lock size={10} /> {label}
      </div>
      <div className={`mt-0.5 font-display text-[16px] font-bold tabular-nums ${tone === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink'}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted">{hint}</div>}
    </div>
  );
}

type LoanPreview = {
  principal: number; rate: number; interest: number; deduction: number; netDisbursed: number;
  numDays: number; emi: boolean; months: number; emiAmount: number; instalment: boolean; interestOnly: boolean; cadenceDays: number;
  startDate: string; firstDue: string; maturity: string | null;
  totalRepayable: number | null; perLabel: string; perValue: number; annualPct: number;
  type: LoanType; daily: number;
};

/** A label/value line inside a summary section. */
function SumRow({ k, v, tone, strong, icon }: { k: string; v: string; tone?: 'success' | 'muted' | 'danger'; strong?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="flex items-center gap-2 text-[13px] text-muted">{icon}{k}</span>
      <span className={`tabular-nums ${strong ? 'text-[16px] font-bold' : 'text-[14px] font-semibold'} ${
        tone === 'success' ? 'text-emerald-600 dark:text-emerald-400'
          : tone === 'danger' ? 'text-red-600 dark:text-red-400'
          : tone === 'muted' ? 'text-ink/70' : 'text-ink'
      }`}>{v}</span>
    </div>
  );
}

/** A titled section card in the summary popup. */
function SumSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border-[0.5px] border-slate-200/70 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,.04)] dark:border-white/[.06] dark:bg-surface2">
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-muted">
        <span className="text-blue-500 dark:text-blue-400">{icon}</span>{title}
      </div>
      <div className="divide-y divide-slate-100 dark:divide-white/[.05]">{children}</div>
    </section>
  );
}

/** Professional loan-summary popup — gradient hero, key-figure tiles, grouped sections. */
function LoanSummaryPopup({ open, onClose, p, customer }: { open: boolean; onClose: () => void; p: LoanPreview; customer: string }) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);
  if (!open) return null;

  const meta = TYPE_META[p.type];
  const lastDayRemainder = p.instalment && p.daily > 0 ? p.principal % p.daily : 0;
  const termLabel = p.interestOnly ? 'Open-ended'
    : p.numDays > 0 ? `${p.numDays} ${isDailyLoan(p.type) ? 'days' : p.emi ? 'months' : 'days'}`
    : '—';

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-md" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[92vh] w-full max-w-lg sm:max-w-md flex-col overflow-hidden rounded-3xl bg-slate-50 shadow-[0_30px_80px_-20px_rgba(0,0,0,.55)] dark:bg-[#0c1220] animate-rise"
      >
        {/* Gradient hero header */}
        <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-blue-800 via-blue-700 to-blue-600 px-6 pb-7 pt-5 text-white">
          <span className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full bg-white/10 blur-2xl" />
          <span className="pointer-events-none absolute -bottom-14 right-14 h-32 w-32 rounded-full border border-white/15" />
          <span className="pointer-events-none absolute -bottom-8 -left-6 h-24 w-24 rounded-full bg-blue-400/20 blur-2xl" />
          <div className="relative flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 ring-1 ring-white/20 backdrop-blur">
                <Calculator size={20} />
              </span>
              <div>
                <div className="text-[15px] font-bold">Loan summary</div>
                <div className="text-[12px] text-white/70">{customer}</div>
              </div>
            </div>
            <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-white/70 transition-colors hover:bg-white/15 hover:text-white">
              <X size={18} />
            </button>
          </div>

          {/* Headline: net disbursed */}
          <div className="relative mt-6">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-white/70">
              {p.instalment ? 'Net disbursed to customer' : 'Disbursed to customer'}
            </div>
            <div className="mt-1 font-display text-[36px] font-extrabold leading-none tabular-nums">{inr(p.netDisbursed)}</div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11.5px] font-semibold ring-1 ring-white/20">
                <span className="h-2 w-2 rounded-full" style={{ background: meta.dot }} /> {LOAN_LABELS[p.type]}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11.5px] font-semibold ring-1 ring-white/20">
                <Percent size={11} /> {p.rate}% interest
              </span>
            </div>
          </div>
        </div>

        {/* Key-figure tiles overlapping the hero */}
        <div className="relative z-10 -mt-4 grid grid-cols-3 gap-2.5 px-5">
          <MiniStat label="Principal" value={inr(p.principal)} />
          <MiniStat label={p.perLabel} value={inr(p.perValue)} />
          <MiniStat label="Term" value={termLabel} small />
        </div>

        {/* Body */}
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {/* Money breakdown */}
          <SumSection icon={<IndianRupee size={13} />} title="Money breakdown">
            <SumRow k="Principal" v={inr(p.principal)} />
            {p.interestOnly
              ? <SumRow k={`${p.perLabel} interest (auto)`} v={inr(p.interest)} />
              : <SumRow k={p.emi ? 'Interest (overall)' : 'Interest'} v={inr(p.interest)} />}
            {p.emi && <SumRow k="Total payable" v={inr(p.principal + p.interest)} />}
            {p.emi && <SumRow k="EMI / month" v={inr(p.emiAmount)} strong />}
            {p.instalment && <SumRow k="Deduction (upfront)" v={`− ${inr(p.deduction)}`} tone="danger" />}
            <SumRow k={p.instalment ? 'Net disbursed' : 'Disbursed'} v={inr(p.netDisbursed)} tone="success" strong />
          </SumSection>

          {/* Schedule */}
          <SumSection icon={<Calendar size={13} />} title="Schedule">
            <SumRow k="Start date" v={fmtDate(p.startDate)} />
            {p.interestOnly ? (
              <>
                <SumRow k="Term" v="Open-ended (until settled)" tone="muted" />
                <SumRow k="First due" v={fmtDate(p.firstDue)} strong />
              </>
            ) : (
              <>
                {p.numDays > 0 && <SumRow k="Term" v={termLabel} tone="muted" />}
                <SumRow k={p.maturity ? 'End date' : 'First due'} v={fmtDate(p.maturity ?? p.firstDue)} strong />
                {p.totalRepayable != null && <SumRow k="Total collection" v={inr(p.totalRepayable)} tone="muted" />}
              </>
            )}
          </SumSection>

          {/* Remainder note */}
          {lastDayRemainder > 0 && (
            <div className="flex items-start gap-2 rounded-xl border-[0.5px] border-blue-200 bg-blue-50 px-3 py-2.5 text-[12px] text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
              <AlertTriangle size={15} className="mt-px shrink-0" />
              <span>
                The final instalment collects <b>{inr(lastDayRemainder)}</b> instead of {inr(p.daily)} (principal isn't an exact multiple).
              </span>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-200/70 bg-white/60 px-5 py-3.5 dark:border-white/[.06] dark:bg-white/[.02]">
          <Button className="w-full justify-center" onClick={onClose}>Got it</Button>
        </div>
      </div>
    </div>
  );
}

/** A compact key-figure tile shown between the hero and the detail sections. */
function MiniStat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-xl border-[0.5px] border-slate-200/70 bg-white p-2.5 text-center shadow-[0_4px_14px_-8px_rgba(15,23,42,.25)] dark:border-white/[.08] dark:bg-surface2">
      <div className={`font-display font-bold tabular-nums text-ink ${small ? 'text-[13px]' : 'text-[15px]'}`}>{value}</div>
      <div className="mt-0.5 truncate text-[10px] font-medium uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}
