import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useData, LOAN_LABELS, type Customer } from '@/mock/DataContext';
import { cashDisbursedFor } from '@/lib/funds';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Drawer } from '@/components/ui/drawer';
import { useToast } from '@/components/ui/toast';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { Button } from '@/components/ui/button';
import { inr, inrShort, fmtDate, initials, todayISO } from '@/lib/format';
import { config } from '@/lib/config';
import { validateCustomerForm, INDIAN_STATES, type FieldErrors } from '@/lib/customerValidation';
import { customerApi } from '@/services/customerApi';
import { documentApi, type DocumentType } from '@/services/documentApi';
import { ApiError } from '@/lib/api';
import { downloadCSV } from '@/lib/export';
import type { LoanType } from '@/mock/DataContext';
import { LOAN_LABELS as LOAN_TYPE_LABELS } from '@/mock/DataContext';
import { PageHeader, HeaderGhostButton, HeaderPrimaryButton } from '@/components/layout/PageHeader';
import { usePermissions } from '@/lib/permissions';
import {
  type CustomerFilters, defaultFilters, factsFor, passesFilters,
  countActive, numActive,
} from '@/lib/customerFilters';
import {
  FilterCard, SegGroup, Seg, ToggleRow, NumFilterRow, CityPill, MatchPreview, drawerSelectCls,
} from '@/components/ui/filter-kit';
import {
  Search, Plus, Eye, Pencil, Trash2, Download, Users,
  FileText, AlertTriangle, ArrowRight, AlertCircle, Clock, IndianRupee,
  User, MapPin, ShieldCheck, Upload, SlidersHorizontal, Activity,
  CreditCard, Check, X, Car, Home, RotateCcw, ChevronLeft, ChevronRight, ChevronDown,
} from 'lucide-react';

type FormState = Partial<Customer>;
const empty: FormState = { name: '', mobile: '' };
type KycKind = 'AADHAAR' | 'PAN';

/** Loan type drives which extra documents are collected. */
type LoanTypeOption = LoanType;
const LOAN_TYPE_OPTIONS: { value: LoanTypeOption; label: string }[] = (
  Object.entries(LOAN_TYPE_LABELS) as [LoanType, string][]
).map(([value, label]) => ({ value, label }));

/** Document tiles. Aadhaar + PAN are shown for every loan type; Vehicle adds
 *  License + RC, Property adds a Property document. ALL uploads are optional —
 *  the tiles indicate what to collect, but none blocks saving a customer. */
const DOC_TILES: { type: DocumentType; label: string; icon: React.ReactNode; color: SectionColor }[] = [
  { type: 'AADHAAR', label: 'Aadhaar Card', icon: <FileText size={18} />, color: 'blue' },
  { type: 'PAN', label: 'PAN Card', icon: <CreditCard size={18} />, color: 'amber' },
  { type: 'LICENSE', label: 'Driving License', icon: <Car size={18} />, color: 'violet' },
  { type: 'RC', label: 'RC (Registration)', icon: <Car size={18} />, color: 'violet' },
  { type: 'PROPERTY', label: 'Property Document', icon: <Home size={18} />, color: 'emerald' },
  { type: 'PHOTO', label: 'Photo', icon: <User size={18} />, color: 'blue' },
  { type: 'OTHER', label: 'Other Document', icon: <FileText size={18} />, color: 'amber' },
];

/** Documents that are ALWAYS offered but never required. */
const OPTIONAL_DOCS: DocumentType[] = ['PHOTO', 'OTHER'];

/** REQUIRED document types for a loan type (drives the missing-doc validation). */
function requiredDocsForLoan(loanType?: LoanTypeOption): DocumentType[] {
  const base: DocumentType[] = ['AADHAAR', 'PAN'];
  if (loanType === 'VEHICLE') return [...base, 'LICENSE', 'RC'];
  if (loanType === 'PROPERTY') return [...base, 'PROPERTY'];
  return base;
}

/** ALL document tiles shown for a loan type = required ones + the optional PHOTO/OTHER. */
function docTilesForLoan(loanType?: LoanTypeOption): DocumentType[] {
  return [...requiredDocsForLoan(loanType), ...OPTIONAL_DOCS];
}

// Backend field names (snake_case) → form field keys (camelCase) so a
// server-side validation error highlights the right input.
const API_FIELD_MAP: Record<string, string> = {
  father_name: 'fatherName', alt_mobile: 'altMobile', date_of_birth: 'dateOfBirth',
  monthly_income: 'monthlyIncome', reference_name: 'referenceName',
  reference_mobile: 'referenceMobile', aadhaar_number: 'aadhaar', pan_number: 'pan',
};

function mapApiErrorFields(e: unknown): FieldErrors {
  if (!(e instanceof ApiError) || !e.fields) return {};
  const out: FieldErrors = {};
  for (const [k, v] of Object.entries(e.fields)) out[API_FIELD_MAP[k] ?? k] = v;
  return out;
}

function apiErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message || fallback;
  return e instanceof Error ? e.message : fallback;
}

/**
 * Map a backend CONFLICT (duplicate mobile / Aadhaar / PAN) to the specific
 * form field and a clear message. The backend reports these as a plain conflict
 * message with no field map, so we key off the message text.
 */
function conflictField(e: unknown): { field: 'mobile' | 'aadhaar' | 'pan'; message: string } | null {
  if (!(e instanceof ApiError) || e.code !== 'CONFLICT') return null;
  const m = e.message.toLowerCase();
  if (m.includes('aadhaar')) return { field: 'aadhaar', message: 'Aadhaar number already exists' };
  if (m.includes('pan')) return { field: 'pan', message: 'PAN number already exists' };
  if (m.includes('mobile')) return { field: 'mobile', message: 'Mobile number already exists' };
  return null;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50];

export default function Customers() {
  const d = useData();
  const toast = useToast();
  const { canEdit } = usePermissions();
  const [q, setQ] = useState('');
  // Applied (live) filters drive the table; `draft` is edited in the drawer and
  // committed on Apply so numeric inputs don't re-filter on every keystroke.
  const [filters, setFilters] = useState<CustomerFilters>(defaultFilters);
  const [draft, setDraft] = useState<CustomerFilters>(defaultFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  // In-flight flag for the save round-trip (create also uploads documents).
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<Customer | null>(null);
  const [confirm, setConfirm] = useState<Customer | null>(null);
  const [kycKind, setKycKind] = useState<KycKind>('AADHAAR');
  // Loan type chosen in the form; decides which document tiles appear.
  const [loanType, setLoanType] = useState<LoanTypeOption>('DAILY_COLLECTION');
  // Files picked in the form, keyed by document type, uploaded on save.
  const [pendingDocs, setPendingDocs] = useState<Partial<Record<DocumentType, File>>>({});
  // Per-field validation errors, shown inline. Populated on save attempt and
  // cleared per-field as the user edits.
  const [errors, setErrors] = useState<FieldErrors>({});
  // Which required document tiles are missing (highlighted red on save attempt).
  const [docErrors, setDocErrors] = useState<DocumentType[]>([]);

  const cities = useMemo(
    () => Array.from(new Set(d.customers.map((c) => c.city).filter(Boolean))).sort() as string[],
    [d.customers],
  );
  const states = useMemo(
    () => Array.from(new Set(d.customers.map((c) => c.state).filter(Boolean))).sort() as string[],
    [d.customers],
  );

  // Derived KYC state for a customer — used by both the filters and the table
  // badges so they always agree.
  const kycOf = (c: Customer): 'VERIFIED' | 'PENDING' =>
    c.hasAadhaar || c.hasPan || (c.address && c.city) ? 'VERIFIED' : 'PENDING';

  const filtered = useMemo(() => {
    const t = q.toLowerCase().trim();
    // todayISO(), never toISOString(): the latter converts to UTC, which in IST
    // (UTC+5:30) returns YESTERDAY between 00:00 and 05:29 local — so an early
    // morning overdue filter would silently omit accounts that fell due today.
    const today = todayISO();
    return d.customers.filter((c) => {
      const matchesQuery = !t
        || c.name.toLowerCase().includes(t)
        || c.mobile.includes(t)
        || c.code.toLowerCase().includes(t)
        || (c.email?.toLowerCase().includes(t) ?? false);
      if (!matchesQuery) return false;
      const facts = factsFor(c, d.loans, d.outstandingFor, kycOf(c), today, d.nextDueFor);
      return passesFilters(c, facts, filters);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.customers, d.loans, q, filters]);

  // Live count of how many customers the *draft* would match (drawer preview).
  const draftMatchCount = useMemo(() => {
    const today = todayISO(); // local date — see `filtered` above
    return d.customers.filter((c) => passesFilters(c, factsFor(c, d.loans, d.outstandingFor, kycOf(c), today, d.nextDueFor), draft)).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.customers, d.loans, draft]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const rows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const activeFilterCount = countActive(filters);
  const filtersActive = !!q || activeFilterCount > 0;
  const resetFilters = () => { setQ(''); setFilters(defaultFilters()); setDraft(defaultFilters()); setPage(1); };
  // Apply the drawer draft to the live filters.
  const applyDraft = () => { setFilters(draft); setPage(1); setFilterOpen(false); };
  // Open the drawer, seeding the draft from the currently-applied filters.
  const openFilters = () => { setDraft(filters); setFilterOpen(true); };

  const openAdd = () => { setEditId(null); setKycKind('AADHAAR'); setLoanType('DAILY_COLLECTION'); setPendingDocs({}); setErrors({}); setDocErrors([]); setForm({ ...empty }); };
  const openEdit = (c: Customer) => {
    setEditId(c.id);
    setKycKind(c.hasPan && !c.hasAadhaar ? 'PAN' : 'AADHAAR');
    setLoanType('DAILY_COLLECTION');
    setPendingDocs({});
    setErrors({});
    setDocErrors([]);
    // Never prefill raw KYC (backend only returns masked); leave blank on edit.
    setForm({ ...c, aadhaar: undefined, pan: undefined });
  };
  const set = (k: keyof Customer, v: string) => {
    const upperFields: (keyof Customer)[] = ['name', 'fatherName', 'occupation', 'city', 'referenceName'];
    const value = upperFields.includes(k) ? v.toUpperCase() : v;
    setForm((f) => ({ ...f, [k]: k === 'monthlyIncome' ? Number(value) || undefined : value }));
    // Clear this field's error as the user edits it.
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  };

  // Phone fields accept digits only, capped at 10. A live red message shows
  // while the entry is a partial (1–9 digit) number.
  const MOBILE_LABELS: Record<'mobile' | 'altMobile' | 'referenceMobile', string> = {
    mobile: 'Mobile number',
    altMobile: 'Alternate mobile',
    referenceMobile: 'Reference mobile',
  };
  const setMobile = (k: 'mobile' | 'altMobile' | 'referenceMobile', v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 10);
    setForm((f) => ({ ...f, [k]: digits }));
    setErrors((e) => ({
      ...e,
      [k]: digits.length > 0 && digits.length < 10 ? `${MOBILE_LABELS[k]} must be 10 digits` : undefined,
    }));
  };

  // Upload every file the user picked, for the document types relevant to the
  // chosen loan type. In API mode this hits the backend; mock mode is a no-op.
  const uploadPendingDocs = async (customerId: number) => {
    if (!config.useApi) return;
    // Upload every attached tile (required + the optional PHOTO/OTHER).
    for (const type of docTilesForLoan(loanType)) {
      const file = pendingDocs[type];
      if (file) {
        try { await documentApi.upload(customerId, type, file); }
        catch { toast(`Failed to upload ${type} document`, 'error'); }
      }
    }
  };

  // DOUBLE-SUBMIT GUARD: `saveInner` has many early-return paths, so the
  // in-flight flag is released in a single finally around the whole body rather
  // than at each exit. Without it, a second click during the create round-trip
  // (which also uploads KYC documents) can create a duplicate customer.
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try { await saveInner(); } finally { setSaving(false); }
  };
  const saveInner = async () => {
    if (!form) return;
    // Only send the KYC field the user is currently entering; clear the other
    // so a stale value from a toggle switch isn't submitted.
    const payload: FormState = {
      ...form,
      aadhaar: kycKind === 'AADHAAR' ? form.aadhaar : undefined,
      pan: kycKind === 'PAN' ? form.pan : undefined,
    };

    // Full client-side validation (mirrors the backend). On edit, KYC may be
    // left blank to keep the existing value, so relax the required-KYC rule.
    const hasKyc = !!editId && (!!form.hasAadhaar || !!form.hasPan);
    const found = validateCustomerForm(payload, { hasKyc });

    // Documents are OPTIONAL — no upload blocks saving a customer. The tiles
    // still show which documents are EXPECTED for the chosen loan type (see
    // requiredDocsForLoan), so the operator knows what to collect, but a
    // customer can be created now and their paperwork attached later.
    //
    // Deliberately kept as an empty list rather than deleting the check, so the
    // error plumbing below stays intact if the rule is ever reinstated.
    const missingDocs: DocumentType[] = [];

    if (Object.keys(found).length > 0 || missingDocs.length > 0) {
      setErrors(found);
      setDocErrors(missingDocs);
      toast(
        missingDocs.length > 0 && Object.keys(found).length === 0
          ? 'Please upload all required documents'
          : 'Please fix the highlighted fields',
        'error',
      );
      return;
    }
    setErrors({});
    setDocErrors([]);

    // UI guard: block a mobile number that already belongs to another customer,
    // with an instant, clear message. The backend still enforces uniqueness.
    const enteredMobile = (payload.mobile ?? '').replace(/\D/g, '');
    if (
      enteredMobile.length === 10 &&
      d.customers.some((c) => c.mobile.replace(/\D/g, '') === enteredMobile && c.id !== editId)
    ) {
      setErrors((e) => ({ ...e, mobile: 'Mobile number already exists' }));
      toast('Mobile number already exists', 'error');
      return;
    }

    if (editId && config.useApi) {
      // Update via API and await it so failures surface (no false success).
      try {
        const updated = await customerApi.update(editId, payload);
        await uploadPendingDocs(editId);
        d.updateCustomerRecord(updated); // reflect the authoritative record
        toast('Customer updated');
      } catch (e) {
        const conflict = conflictField(e);
        if (conflict) {
          setErrors((prev) => ({ ...prev, [conflict.field]: conflict.message }));
          toast(conflict.message, 'error');
          return;
        }
        setErrors(mapApiErrorFields(e));
        toast(apiErrorMessage(e, 'Failed to update customer'), 'error');
        return;
      }
    } else if (editId) {
      d.updateCustomer(editId, payload);
      toast('Customer updated');
    } else if (config.useApi) {
      // Create via API so we get the new ID, then attach documents to it.
      try {
        const created = await customerApi.create(payload);
        await uploadPendingDocs(created.id);
        d.addCustomerRecord(created); // reflect in list without a refetch
        toast('Customer added');
      } catch (e) {
        const conflict = conflictField(e);
        if (conflict) {
          setErrors((prev) => ({ ...prev, [conflict.field]: conflict.message }));
          toast(conflict.message, 'error');
          return;
        }
        setErrors(mapApiErrorFields(e));
        toast(apiErrorMessage(e, 'Failed to add customer'), 'error');
        return;
      }
    } else {
      d.addCustomer(payload as Omit<Customer, 'id' | 'code' | 'createdAt'>);
      toast('Customer added');
    }
    setForm(null);
  };

  const loansOf = (id: number) => d.loans.filter((l) => l.customerId === id);
  const today = todayISO(); // local date — never toISOString() (UTC shifts the day)
  // Live overdue — same rule as Collections/Dashboard (amount-based next due),
  // not the stored loan.nextDueDate which stays frozen after payments.
  const loanIsOverdue = (l: (typeof d.loans)[number]) => {
    if (l.status !== 'ACTIVE' || d.outstandingFor(l) <= 0) return false;
    const nd = d.nextDueFor(l);
    return !!nd && nd < today;
  };
  const customerIsOverdue = (cLoans: typeof d.loans) => cLoans.some(loanIsOverdue);

  const handleExport = () => {
    const headers = [
      'Customer Code', 'Name', 'Mobile', 'Alt. Mobile', 'City', 'State',
      'Occupation', 'Monthly Income', 'KYC', 'Active Loans', 'Outstanding', 'Status', 'Since',
    ];

    const rows = filtered.map((c) => {
      const cLoans = loansOf(c.id);
      const activeCount = cLoans.filter((l) => l.status === 'ACTIVE').length;
      const outstanding = cLoans.reduce((s, l) => s + d.outstandingFor(l), 0);
      const kyc = kycOf(c);

      const hasOverdue = customerIsOverdue(cLoans);

      const status = hasOverdue
        ? 'Overdue'
        : activeCount > 0
          ? 'Active'
          : 'Inactive';

      return [
        c.code,
        c.name,
        c.mobile,
        c.altMobile || '',
        c.city || '',
        c.state || '',
        c.occupation || '',
        c.monthlyIncome ?? '',
        kyc === 'VERIFIED' ? 'Verified' : 'Pending',
        activeCount,
        outstanding,
        status,
        c.createdAt,
      ];
    });

    const stamp = today;
    downloadCSV(headers, rows, `Customers_Export_${stamp}.csv`);
  };
  const totalCustomers = d.customers.length;
  const activeCustomers = d.customers.filter((c) => loansOf(c.id).some((l) => l.status === 'ACTIVE')).length;
  const totalOutstanding = d.loans.reduce((sum, l) => sum + d.outstandingFor(l), 0);

  // Customers with at least one overdue active loan — drives the red alert bar + chip.
  const overdueCustomers = d.customers.filter((c) => customerIsOverdue(loansOf(c.id)));
  const overdueLead = overdueCustomers[0];
  const overdueLeadLoan = overdueLead
    ? loansOf(overdueLead.id)
        .filter(loanIsOverdue)
        .sort((a, b) => d.outstandingFor(b) - d.outstandingFor(a))[0]
    : undefined;

  // Customers awaiting KYC — drives the "pending KYC" meta chip.
  const pendingKycCustomers = d.customers.filter((c) => kycOf(c) === 'PENDING');

  return (
    // Full-height column: dark header (full-bleed) + padded, scroll-managed body.
    <div className="flex h-[100dvh] flex-col">
      {/* Dark page header */}
      <PageHeader
        icon={<Users size={20} />}
        title="Customers"
        subtitle="Manage profiles, KYC and loan accounts"
        actions={
          <>
            <HeaderGhostButton icon={<Download size={14} />} onClick={handleExport}>Export</HeaderGhostButton>
            {canEdit('Customers') && <HeaderPrimaryButton beam icon={<Plus size={14} />} onClick={openAdd}>Add customer</HeaderPrimaryButton>}
          </>
        }
      />

      {/* Overdue alert bar */}
      {overdueLead && (
        <button
          onClick={() => setView(overdueLead)}
          className="flex items-center gap-2.5 border-b-[0.5px] border-red-200 bg-red-50 px-5 py-2.5 text-left dark:border-red-500/20 dark:bg-red-500/10"
        >
          <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400">
            <AlertTriangle size={14} />
          </span>
          <span className="flex-1 text-[13px] font-medium text-red-700 dark:text-red-300">
            {overdueCustomers.length} customer{overdueCustomers.length > 1 ? 's' : ''} overdue
            {overdueLeadLoan && (
              <span className="ml-1.5 font-normal text-red-600/80 dark:text-red-400/80">
                · {overdueLead.name} · {inr(d.outstandingFor(overdueLeadLoan))} outstanding
                {(() => { const nd = d.nextDueFor(overdueLeadLoan); return nd ? ` · due ${fmtDate(nd)}` : ''; })()}
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[13px] font-medium text-red-600 dark:text-red-400">
            View loan <ArrowRight size={13} />
          </span>
        </button>
      )}

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3.5 sm:px-4">
        {/* Toolbar — result count + chips on the left, search/filter on the right */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Left: count + real chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] text-muted">
              Showing <strong className="font-semibold text-ink">{filtered.length}</strong> customer{filtered.length === 1 ? '' : 's'}
            </span>
            {overdueCustomers.length > 0 && (
              <MetaTag tone="danger" icon={<AlertCircle size={13} />}>{overdueCustomers.length} overdue</MetaTag>
            )}
            {pendingKycCustomers.length > 0 && (
              <MetaTag tone="warn" icon={<Clock size={13} />}>{pendingKycCustomers.length} pending KYC</MetaTag>
            )}
            <MetaTag tone="info" icon={<Users size={13} />}>{activeCustomers} active</MetaTag>
            <MetaTag icon={<IndianRupee size={13} />}>{inrShort(totalOutstanding)} outstanding</MetaTag>
          </div>

          {/* Right: compact search + filters */}
          <div className="flex items-center gap-2">
            {/* Expandable search */}
            <div
              className={`flex items-center gap-2 rounded-lg border-[0.5px] transition-all duration-200 focus-within:border-blue-500 ${
                searchOpen || q
                  ? 'w-56 border-slate-200/70 bg-white px-3 py-2.5 dark:border-white/[.06] dark:bg-surface'
                  : 'w-9 justify-center border-transparent'
              }`}
            >
              <button
                onClick={() => setSearchOpen((o) => !o)}
                aria-label="Search"
                className={`shrink-0 ${searchOpen || q ? 'text-muted' : 'grid h-9 w-9 place-items-center rounded-lg border-[0.5px] border-slate-200/70 bg-white text-ink/70 hover:bg-slate-50 dark:border-white/[.06] dark:bg-surface dark:hover:bg-white/[.03]'}`}
              >
                <Search size={18} />
              </button>
              {(searchOpen || q) && (
                <>
                  <input
                    autoFocus
                    value={q}
                    onChange={(e) => { setQ(e.target.value); setPage(1); }}
                    placeholder="Search customers…"
                    className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-muted"
                  />
                  {q && (
                    <button onClick={() => { setQ(''); setPage(1); }} aria-label="Clear search" className="shrink-0 text-muted hover:text-ink">
                      <X size={15} />
                    </button>
                  )}
                </>
              )}
            </div>

            <button
              onClick={openFilters}
              className={`relative inline-flex items-center gap-2 rounded-lg border-[0.5px] px-4 py-2.5 text-[14px] font-semibold transition-colors ${
                activeFilterCount > 0
                  ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-400/40 dark:bg-blue-500/15 dark:text-blue-300'
                  : 'border-slate-200/70 bg-white text-ink/80 hover:bg-slate-50 dark:border-white/[.06] dark:bg-surface dark:hover:bg-white/[.03]'
              }`}
            >
              <SlidersHorizontal size={16} /> Filters
              {activeFilterCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1.5 text-[11px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {filtersActive && (
              <button
                onClick={resetFilters}
                title="Reset all filters"
                className="grid h-[42px] w-[42px] place-items-center rounded-lg border-[0.5px] border-slate-200/70 bg-white text-muted transition-colors hover:bg-slate-50 dark:border-white/[.06] dark:bg-surface dark:hover:bg-white/[.03]"
              >
                <RotateCcw size={16} />
              </button>
            )}
          </div>
        </div>

        {/* ── Mobile / tablet: card list ────────────────────────────────────
            The desktop table is 9 columns at min-w-[800px], so below lg the two
            columns that actually drive a decision — Outstanding and Status —
            sat off-screen behind a horizontal drag (and the drag-release fired
            the row's onClick, opening the wrong customer). Cards lead with
            those instead. Same data, same row-tap target; mirrors the
            CollectionCard pattern already used on the Collections page. */}
        <div className="flex flex-col gap-3 lg:hidden">
          {/* Empty state — the desktop copy lives inside the table card, which
              is hidden below lg, so mobile needs its own. */}
          {rows.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200/90 bg-white px-6 py-16 text-center shadow-card dark:border-white/[.07] dark:bg-surface">
              <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 text-blue-500 dark:bg-blue-500/15">
                <Users size={26} />
              </div>
              <h3 className="text-base font-semibold text-ink">
                {filtersActive ? 'No matching customers' : 'No customers yet'}
              </h3>
              <p className="mt-1 max-w-xs text-sm text-muted">
                {filtersActive ? 'Try adjusting your search or filters.' : 'Add your first customer to get started.'}
              </p>
              {!filtersActive && canEdit('Customers') && (
                <Button onClick={openAdd} className="mt-5 !min-h-[44px]"><Plus size={16} /> Add first customer</Button>
              )}
            </div>
          )}
          {rows.map((c) => {
            const cLoans = loansOf(c.id);
            const outstanding = cLoans.reduce((s, l) => s + d.outstandingFor(l), 0);
            const hasOverdue = customerIsOverdue(cLoans);
            const activeLoan = cLoans.some((l) => l.status === 'ACTIVE');
            return (
              <div
                key={c.id}
                onClick={() => setView(c)}
                className={`anim-pop rounded-2xl border bg-white p-4 shadow-card transition-colors dark:bg-surface ${
                  hasOverdue ? 'border-red-200 dark:border-red-500/25' : 'border-slate-200/90 dark:border-white/[.07]'
                }`}
              >
                {/* Identity */}
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary-400 to-primary text-[13px] font-bold text-white">
                    {initials(c.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-ink">{c.name}</div>
                    <div className="truncate text-[12.5px] text-muted">{c.code} · {c.mobile}</div>
                  </div>
                  <StatusBadge overdue={hasOverdue} active={activeLoan} />
                </div>
                {/* The decision-driving figures, always visible */}
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 dark:border-white/[.06]">
                  <div>
                    <div className="text-[11px] text-muted">Outstanding</div>
                    <div className={`font-display text-[15px] font-bold tabular-nums ${outstanding > 0 && hasOverdue ? 'text-red-600 dark:text-red-400' : 'text-ink'}`}>
                      {inr(outstanding)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted">Loans</div>
                    <div className="font-display text-[15px] font-bold tabular-nums text-ink">{cLoans.length}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted">KYC</div>
                    <div className="mt-0.5"><KycBadge status={kycOf(c)} /></div>
                  </div>
                </div>
                {/* Actions: 44px targets for touch. Edit/Delete respect RBAC,
                    exactly as the desktop row does. */}
                <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" onClick={() => setView(c)} className="!min-h-[44px] flex-1 !text-[13px]">
                    <Eye size={15} /> View
                  </Button>
                  {canEdit('Customers') && <>
                    <Button variant="ghost" onClick={() => openEdit(c)} aria-label={`Edit ${c.name}`} title="Edit" className="!min-h-[44px] !min-w-[44px] !px-3">
                      <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirm(c)} aria-label={`Delete ${c.name}`} title="Delete" className="!min-h-[44px] !min-w-[44px] !px-3 !text-danger">
                      <Trash2 size={15} />
                    </Button>
                  </>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Table card — desktop only (lg+); flexes to fill remaining height,
            only its body scrolls. Markup below is unchanged. */}
        <div className="hidden min-h-0 flex-1 flex-col overflow-hidden rounded-xl border-[0.5px] border-slate-200/70 bg-white lg:flex dark:border-white/[.06] dark:bg-surface">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[800px] text-[15px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gradient-to-r from-[#022999] via-[#0538cc] to-[#0AA8F8] text-left text-[12px] font-bold uppercase tracking-[0.06em] text-white">
                  <th className="border-b border-slate-200 px-5 py-4 dark:border-white/10">Customer</th>
                  <th className="border-b border-slate-200 px-5 py-4 dark:border-white/10">Customer ID</th>
                  <th className="border-b border-slate-200 px-5 py-4 dark:border-white/10">Mobile</th>
                  <th className="border-b border-slate-200 px-5 py-4 dark:border-white/10">City</th>
                  <th className="border-b border-slate-200 px-5 py-4 dark:border-white/10">Loans</th>
                  <th className="border-b border-slate-200 px-5 py-4 dark:border-white/10">Given</th>
                  <th className="border-b border-slate-200 px-5 py-4 dark:border-white/10">Outstanding</th>
                  <th className="border-b border-slate-200 px-5 py-4 dark:border-white/10">KYC</th>
                  <th className="border-b border-slate-200 px-5 py-4 dark:border-white/10">Status</th>
                  <th className="border-b border-slate-200 px-5 py-4 text-right dark:border-white/10">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/[.05]">
                {rows.map((c, i) => {
                  const cLoans = loansOf(c.id);
                  const activeLoans = cLoans.filter((l) => l.status === 'ACTIVE');
                  const outstanding = cLoans.reduce((s, l) => s + d.outstandingFor(l), 0);
                  // Cash this customer actually received. cashDisbursedFor()
                  // covers every loan type — only Daily Collection deducts
                  // upfront, so for the rest this equals their full principal.
                  const given = cLoans.reduce((s, l) => s + cashDisbursedFor(l), 0);
                  const hasOverdue = customerIsOverdue(cLoans);
                  const kyc = kycOf(c);
                  const activeLoan = cLoans.some((l) => l.status === 'ACTIVE');
                  return (
                    <motion.tr
                      key={c.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(i * 0.03, 0.3) }}
                      className={`group cursor-pointer transition-colors hover:bg-blue-50/50 dark:hover:bg-blue-500/[.06] ${hasOverdue ? 'bg-red-500/[.03]' : 'odd:bg-slate-50/40 dark:odd:bg-white/[.015]'}`}
                      onClick={() => setView(c)}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sm font-bold text-white shadow-sm" style={{ background: `linear-gradient(135deg, ${avatarColor(c.name)}, ${avatarColor(c.name)}cc)` }}>
                            {initials(c.name)}
                            {(hasOverdue || kyc === 'PENDING') && (
                              <span
                                className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white dark:ring-surface"
                                style={{ background: hasOverdue ? '#ef4444' : '#f59e0b' }}
                              />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-[15px] font-semibold text-ink">{c.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[12px] font-medium text-slate-600 dark:bg-white/[.06] dark:text-slate-300">{c.code}</span>
                      </td>
                      <td className="px-5 py-4 text-[14px] font-medium text-ink/85 tabular-nums">{c.mobile}</td>
                      <td className="px-5 py-4 text-[14px] text-ink/85">{c.city || '—'}</td>
                      <td className="px-5 py-4">
                        {activeLoans.length > 0 ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1 text-[12px] font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                            {activeLoans.length} {activeLoans.length === 1 ? 'loan' : 'loans'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border-[0.5px] border-slate-200 bg-slate-50 px-2.5 py-1 text-[12px] font-medium text-muted dark:border-white/[.08] dark:bg-white/[.03]">
                            0 loans
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-[15px] font-semibold tabular-nums text-ink">
                        {inr(given)}
                      </td>
                      <td className={`px-5 py-4 text-[15px] font-bold tabular-nums ${outstanding > 0 && hasOverdue ? 'text-red-600 dark:text-red-400' : 'text-ink'}`}>
                        {inr(outstanding)}
                      </td>
                      <td className="px-5 py-4"><KycBadge status={kyc} /></td>
                      <td className="px-5 py-4"><StatusBadge overdue={hasOverdue} active={activeLoan} /></td>
                      <td className="px-5 py-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                          <RowAction icon={<Eye size={16} />} title="View" onClick={() => setView(c)} hover="hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-500/15" />
                          {/* Mutations only for edit access — view-only users get an honest read-only row (backend 403s regardless). */}
                          {canEdit('Customers') && <>
                            <RowAction icon={<Pencil size={16} />} title="Edit" onClick={() => openEdit(c)} hover="hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-500/15" />
                          </>}
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>

            {/* Empty state */}
            {rows.length === 0 && (
              <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
                <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-blue-50 text-blue-500 dark:bg-blue-500/15">
                  <Users size={28} />
                </div>
                <h3 className="text-base font-semibold text-ink">
                  {filtersActive ? 'No matching customers' : 'No customers yet'}
                </h3>
                <p className="mt-1 max-w-xs text-sm text-muted">
                  {filtersActive ? 'Try adjusting your search or filters.' : 'Add your first customer to get started.'}
                </p>
                {!filtersActive && canEdit('Customers') && (
                  <button
                    onClick={openAdd}
                    className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-600"
                  >
                    <Plus size={16} /> Add first customer
                  </button>
                )}
              </div>
            )}
          </div>

        </div>

        {/* Pagination footer — OUTSIDE the desktop-only table card so the card
            list below lg gets the same controls (it previously lived inside the
            table and would have disappeared on mobile). Rounded on its own at
            small widths; visually joined to the table card at lg. */}
        {filtered.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-[0.5px] border-slate-200/70 bg-slate-50 px-5 py-3.5 lg:-mt-px lg:rounded-t-none dark:border-white/[.06] dark:bg-white/[.02]">
              <p className="text-[14px] text-muted">
                Showing <span className="font-semibold text-ink">{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)}</span> of{' '}
                <span className="font-semibold text-ink">{filtered.length}</span> customers
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="grid h-9 w-9 place-items-center rounded-lg border-[0.5px] border-slate-200 bg-white text-muted transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-white/10 dark:bg-white/5"
                >
                  <ChevronLeft size={16} />
                </button>
                {pageNumbers(currentPage, totalPages).map((p, idx) =>
                  p === '…' ? (
                    <span key={`e${idx}`} className="px-1 text-muted">…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p as number)}
                      className={`grid h-9 min-w-9 place-items-center rounded-lg px-2.5 text-[14px] font-semibold transition-colors ${
                        p === currentPage
                          ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30'
                          : 'border-[0.5px] border-slate-200 bg-white text-ink/70 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5'
                      }`}
                    >
                      {p}
                    </button>
                  ),
                )}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="grid h-9 w-9 place-items-center rounded-lg border-[0.5px] border-slate-200 bg-white text-muted transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-white/10 dark:bg-white/5"
                >
                  <ChevronRight size={16} />
                </button>
                <div className="relative ml-1">
                  <select
                    value={pageSize}
                    onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                    className="h-9 appearance-none rounded-lg border-[0.5px] border-slate-200 bg-white pl-2.5 pr-8 text-[14px] text-muted outline-none [color-scheme:light] dark:border-white/10 dark:bg-white/5 dark:[color-scheme:dark]"
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

      {/* Add / Edit — right-side slide-over */}
      <Drawer
        open={!!form}
        onClose={() => setForm(null)}
        width="xl"
        icon={<User size={18} />}
        title={editId ? 'Edit Customer' : 'Add New Customer'}
        subtitle="Enter customer details and KYC information"
        closeOnScrimClick={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setForm(null)} disabled={saving}>Cancel</Button>
            <Button onClick={save} loading={saving}>{editId ? 'Save Changes' : 'Save Customer'}</Button>
          </>
        }
      >
        {form && (
          <div className="space-y-8">
            {/* Personal Information */}
            <section>
              <SectionHeader icon={<User size={16} />} title="Personal Information" color="blue" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Full Name *" placeholder="Enter full name" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} error={errors.name} />
                <Input label="Father's Name" placeholder="Enter father's name" value={form.fatherName ?? ''} onChange={(e) => set('fatherName', e.target.value)} error={errors.fatherName} />
                <Input label="Mobile Number *" placeholder="Enter mobile number" inputMode="numeric" maxLength={10} value={form.mobile ?? ''} onChange={(e) => setMobile('mobile', e.target.value)} error={errors.mobile} />
                <Input label="Alternate Mobile" placeholder="Enter alternate number" inputMode="numeric" maxLength={10} value={form.altMobile ?? ''} onChange={(e) => setMobile('altMobile', e.target.value)} error={errors.altMobile} />
                <Input label="Email" type="email" placeholder="Enter email address" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} error={errors.email} />
                <Input label="Occupation" placeholder="Enter occupation" value={form.occupation ?? ''} onChange={(e) => set('occupation', e.target.value)} error={errors.occupation} />
                <Input label="Monthly Income" type="number" placeholder="Enter monthly income" value={form.monthlyIncome ?? ''} onChange={(e) => set('monthlyIncome', e.target.value)} error={errors.monthlyIncome} />
                <DatePicker label="Date of Birth" value={form.dateOfBirth ?? ''} onChange={(e) => set('dateOfBirth', e.target.value)} error={errors.dateOfBirth} />
              </div>
            </section>

            {/* Address Information */}
            <section>
              <SectionHeader icon={<MapPin size={16} />} title="Address Information" color="violet" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2"><Input label="Address *" placeholder="Enter complete address" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} error={errors.address} /></div>
                <Input label="City *" placeholder="Enter city" value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} error={errors.city} />
                <div>
                  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">State *</span>
                  <select
                    value={form.state ?? ''}
                    onChange={(e) => set('state', e.target.value)}
                    className={`w-full rounded-xl border bg-white dark:bg-surface px-3 py-2.5 text-sm outline-none cursor-pointer transition-shadow focus:ring-4 ${
                      errors.state
                        ? 'border-danger focus:border-danger focus:ring-danger/10'
                        : 'border-slate-200 dark:border-white/[.08] focus:border-primary focus:ring-primary/10'
                    }`}
                  >
                    <option value="" disabled>Select state</option>
                    {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {errors.state && <span className="mt-1 block text-xs font-medium text-danger">{errors.state}</span>}
                </div>
                <Input label="Pincode *" placeholder="Enter pincode" value={form.pincode ?? ''} onChange={(e) => set('pincode', e.target.value)} error={errors.pincode} />
                <Input label="Reference Name" placeholder="Enter reference name" value={form.referenceName ?? ''} onChange={(e) => set('referenceName', e.target.value)} error={errors.referenceName} />
                <Input label="Reference Mobile" placeholder="Enter reference mobile" inputMode="numeric" maxLength={10} value={form.referenceMobile ?? ''} onChange={(e) => setMobile('referenceMobile', e.target.value)} error={errors.referenceMobile} />
              </div>
            </section>

            {/* KYC Information */}
            <section>
              <SectionHeader icon={<ShieldCheck size={16} />} title="KYC Information" color="emerald" />

              {/* Loan type first — it drives which documents are required below */}
              <div className="mb-5">
                <Select
                  label="Loan Type *"
                  value={loanType}
                  onChange={(e) => { setLoanType(e.target.value as LoanTypeOption); setDocErrors([]); }}
                  options={LOAN_TYPE_OPTIONS}
                />
                <p className="mt-1.5 text-xs text-muted">
                  {loanType === 'VEHICLE'
                    ? 'Vehicle loans also require Driving License and RC.'
                    : loanType === 'PROPERTY'
                      ? 'Property loans also require a Property document.'
                      : 'Aadhaar and PAN are required for all loan types.'}
                </p>
              </div>

              {/* Aadhaar / PAN toggle */}
              <div className="mb-4 flex gap-6">
                {(['AADHAAR', 'PAN'] as KycKind[]).map((kind) => (
                  <label key={kind} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="kycKind"
                      checked={kycKind === kind}
                      onChange={() => setKycKind(kind)}
                      className="h-4 w-4 text-primary focus:ring-primary"
                    />
                    <span className="font-medium">{kind === 'AADHAAR' ? 'Aadhaar Card' : 'PAN Card'}</span>
                  </label>
                ))}
              </div>

              {kycKind === 'AADHAAR' ? (
                <Input
                  label="Aadhaar Number"
                  placeholder="XXXX XXXX XXXX"
                  value={form.aadhaar ?? ''}
                  onChange={(e) => set('aadhaar', e.target.value.replace(/\D/g, '').slice(0, 12))}
                  error={errors.aadhaar}
                />
              ) : (
                <Input
                  label="PAN Number"
                  placeholder="ABCDE1234F"
                  value={form.pan ?? ''}
                  onChange={(e) => set('pan', e.target.value.toUpperCase().slice(0, 10))}
                  error={errors.pan}
                />
              )}
              {editId && (
                <p className="mt-2 text-xs text-muted">
                  {kycKind === 'AADHAAR'
                    ? (form.hasAadhaar ? `On file: ${form.aadhaarMasked}. Leave blank to keep unchanged.` : 'No Aadhaar on file yet.')
                    : (form.hasPan ? `On file: ${form.panMasked}. Leave blank to keep unchanged.` : 'No PAN on file yet.')}
                </p>
              )}

              {/* Document uploads — required docs per loan type + optional Photo/Other */}
              <div className="mt-6">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Upload Documents</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {DOC_TILES.filter((t) => docTilesForLoan(loanType).includes(t.type)).map((tile) => (
                    <UploadTile
                      key={tile.type}
                      label={tile.label}
                      icon={tile.icon}
                      color={tile.color}
                      file={pendingDocs[tile.type] ?? null}
                      missing={docErrors.includes(tile.type)}
                      optional={OPTIONAL_DOCS.includes(tile.type)}
                      onPick={(f) => {
                        setPendingDocs((p) => {
                          const next = { ...p };
                          if (f) next[tile.type] = f;
                          else delete next[tile.type];
                          return next;
                        });
                        setDocErrors((prev) => prev.filter((t) => t !== tile.type));
                      }}
                    />
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted">
                  {editId
                    ? 'Upload to add or replace a document. Photo and Other are optional. JPEG, PNG, WebP or PDF, up to 5 MB each.'
                    : 'Aadhaar/PAN (and loan-specific docs) are required; Photo and Other are optional. JPEG, PNG, WebP or PDF, up to 5 MB each.'}
                </p>
              </div>
            </section>
          </div>
        )}
      </Drawer>

      {/* Filters — rich right-side slide-over (draft, applied on button) */}
      <Drawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        width="md"
        icon={<SlidersHorizontal size={18} />}
        title="Filter customers"
        subtitle="Combine account, portfolio and profile criteria"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(defaultFilters())}>Clear all</Button>
            <Button onClick={applyDraft}>Apply filters</Button>
          </>
        }
      >
        <div className="space-y-5">
          {/* Sticky live match preview with ratio bar */}
          <MatchPreview
            matched={draftMatchCount}
            total={d.customers.length}
            activeCount={countActive(draft)}
            itemLabel="customers"
            onClear={() => setDraft(defaultFilters())}
          />

          {/* ── Portfolio ── */}
          <FilterCard icon={<IndianRupee size={16} />} title="Portfolio" color="violet" active={numActive(draft.outstanding) || numActive(draft.loanCount) || draft.loanTypes.length > 0}>
            <div className="space-y-3">
              <NumFilterRow label="Total outstanding" unit="₹" value={draft.outstanding} onChange={(outstanding) => setDraft({ ...draft, outstanding })} />
              <NumFilterRow label="Number of loans" value={draft.loanCount} onChange={(loanCount) => setDraft({ ...draft, loanCount })} />
            </div>
            <div className="mt-4">
              <div className="mb-2 text-[12px] font-semibold text-muted">Holds loan type</div>
              <div className="flex flex-wrap gap-2">
                {LOAN_TYPE_OPTIONS.map((opt) => {
                  const on = draft.loanTypes.includes(opt.value);
                  return (
                    <CityPill
                      key={opt.value}
                      active={on}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          loanTypes: on ? draft.loanTypes.filter((t) => t !== opt.value) : [...draft.loanTypes, opt.value],
                        })
                      }
                    >
                      {opt.label}
                    </CityPill>
                  );
                })}
              </div>
            </div>
          </FilterCard>

          {/* ── Account & KYC ── */}
          <FilterCard icon={<ShieldCheck size={16} />} title="Account & KYC" color="emerald" active={!!draft.status || !!draft.kyc || draft.overdueOnly}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-muted">
                  <Activity size={13} className="text-blue-500" /> Account
                </div>
                <SegGroup>
                  <Seg active={draft.status === ''} onClick={() => setDraft({ ...draft, status: '' })}>All</Seg>
                  <Seg active={draft.status === 'ACTIVE'} onClick={() => setDraft({ ...draft, status: 'ACTIVE' })} tone="emerald">Active</Seg>
                  <Seg active={draft.status === 'INACTIVE'} onClick={() => setDraft({ ...draft, status: 'INACTIVE' })}>Inactive</Seg>
                </SegGroup>
              </div>
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-muted">
                  <ShieldCheck size={13} className="text-emerald-500" /> KYC
                </div>
                <SegGroup>
                  <Seg active={draft.kyc === ''} onClick={() => setDraft({ ...draft, kyc: '' })}>All</Seg>
                  <Seg active={draft.kyc === 'VERIFIED'} onClick={() => setDraft({ ...draft, kyc: 'VERIFIED' })} tone="emerald">Verified</Seg>
                  <Seg active={draft.kyc === 'PENDING'} onClick={() => setDraft({ ...draft, kyc: 'PENDING' })} tone="amber">Pending</Seg>
                </SegGroup>
              </div>
            </div>
            <ToggleRow
              active={draft.overdueOnly}
              onToggle={() => setDraft({ ...draft, overdueOnly: !draft.overdueOnly })}
              icon={<AlertTriangle size={16} />}
              label="Overdue only"
              hint="Customers with at least one past-due loan"
              tone="danger"
            />
          </FilterCard>

          {/* ── Profile ── */}
          <FilterCard icon={<User size={16} />} title="Profile" color="blue" active={numActive(draft.income) || !!draft.city || !!draft.state || !!draft.occupation.trim()}>
            <NumFilterRow label="Monthly income" unit="₹" value={draft.income} onChange={(income) => setDraft({ ...draft, income })} />
            <div className="mt-3.5 grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1.5 text-[12px] font-semibold text-muted">City</div>
                <select value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} className={drawerSelectCls + ' w-full'}>
                  <option value="">Any city</option>
                  {cities.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <div className="mb-1.5 text-[12px] font-semibold text-muted">State</div>
                <select value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value })} className={drawerSelectCls + ' w-full'}>
                  <option value="">Any state</option>
                  {states.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-3.5">
              <div className="mb-1.5 text-[12px] font-semibold text-muted">Occupation contains</div>
              <input
                value={draft.occupation}
                onChange={(e) => setDraft({ ...draft, occupation: e.target.value })}
                placeholder="e.g. Driver, Business…"
                className={drawerSelectCls + ' w-full'}
              />
            </div>
          </FilterCard>
        </div>
      </Drawer>

      {/* View detail */}
      <Dialog open={!!view} onClose={() => setView(null)} title={view?.name ?? ''} subtitle={view?.code} wide>
        {view && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              {([['Mobile', view.mobile], ['Alt. mobile', view.altMobile], ['Occupation', view.occupation],
                 ['Monthly income', view.monthlyIncome ? inr(view.monthlyIncome) : undefined], ['City', view.city], ['State', view.state],
                 ['Pincode', view.pincode], ['Reference', view.referenceName], ['Ref. mobile', view.referenceMobile],
                 ['Address', view.address], ['Since', fmtDate(view.createdAt)]] as [string, string | undefined][])
                .map(([k, v]) => (
                  <div key={k}><div className="text-[11px] uppercase tracking-wide text-slate-600">{k}</div><div className="font-medium">{v || '—'}</div></div>
                ))}
            </div>
            <div>
              {(() => {
                // View card shows ACTIVE loans only — closed loans are hidden here.
                const activeLoans = loansOf(view.id).filter((l) => l.status === 'ACTIVE');
                return (
                  <>
                    <div className="mb-2 text-sm font-semibold">Loans ({activeLoans.length})</div>
                    <div className="space-y-2">
                      {activeLoans.map((l) => (
                        <div key={l.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-sm hover:bg-slate-50">
                          <div className="flex items-center gap-2"><span className="font-mono text-xs text-slate-600">{l.loanNumber}</span><Badge tone="info">{LOAN_LABELS[l.type]}</Badge></div>
                          <div className="flex items-center gap-4"><span className="text-slate-600">{inr(l.principal)}</span><span className="font-semibold">Out: {inr(d.outstandingFor(l))}</span></div>
                        </div>
                      ))}
                      {activeLoans.length === 0 && <p className="text-sm text-slate-600">No active loans.</p>}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} title="Delete customer?"
        subtitle={confirm ? `${confirm.name} (${confirm.code})` : ''}
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { if (confirm) { d.deleteCustomer(confirm.id); toast('Customer and related records deleted', 'info'); } setConfirm(null); }}>Delete everything</Button></>}>
        {confirm && (() => {
          const custLoanList = d.loans.filter((l) => l.customerId === confirm.id);
          const loanIds = new Set(custLoanList.map((l) => l.id));
          const colCount = d.collections.filter((c) => loanIds.has(c.loanId)).length;
          const docCount = d.documents.filter((doc) => doc.customerId === confirm.id).length;
          const activeLoanCount = custLoanList.filter((l) => l.status === 'ACTIVE').length;
          const closedLoanCount = custLoanList.length - activeLoanCount;
          const loanParts: string[] = [];
          if (activeLoanCount) loanParts.push(`${activeLoanCount} active loan${activeLoanCount === 1 ? '' : 's'}`);
          if (closedLoanCount) loanParts.push(`${closedLoanCount} closed loan${closedLoanCount === 1 ? '' : 's'}`);
          const parts = [loanParts.join(', ') || `${custLoanList.length} loan${custLoanList.length === 1 ? '' : 's'}`, `${colCount} payment record${colCount === 1 ? '' : 's'}`];
          if (docCount) parts.push(`${docCount} document${docCount === 1 ? '' : 's'}`);
          return (
            <div className="space-y-2 text-sm text-slate-600">
              <p>This permanently removes <span className="font-semibold text-slate-900">{confirm.name}</span> and <span className="font-semibold text-red-600">all their linked records</span> from every screen (Loans, Collections, Documents, Reports).</p>
              <p>Will also delete: <span className="font-semibold">{parts.join(', ')}</span>.</p>
              <p className="text-xs text-slate-500">Payment records include the full history for both active and closed loans.</p>
              <p className="text-xs text-slate-500">Business expenses are not linked to customers — clear them separately on the Expenses page if needed.</p>
              <p>This cannot be undone.</p>
            </div>
          );
        })()}
      </Dialog>
    </div>
  );
}

// ─────────────── meta chip ───────────────
type MetaTone = 'danger' | 'warn' | 'info' | 'neutral';
const metaToneCls: Record<MetaTone, string> = {
  danger: 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300',
  warn: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300',
  info: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-300',
  neutral: 'border-slate-200/70 bg-white text-ink/70 dark:border-white/[.06] dark:bg-surface',
};
function MetaTag({ tone = 'neutral', icon, children }: { tone?: MetaTone; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border-[0.5px] px-3 py-1.5 text-[12px] font-semibold ${metaToneCls[tone]}`}>
      {icon}{children}
    </span>
  );
}

// Deterministic solid color per name so avatars are colourful but stable.
const AVATAR_COLORS = ['#6366f1', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#f59e0b', '#0ea5e9', '#ef4444'];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// Page-number list with ellipses for the pagination footer.
function pageNumbers(current: number, total: number): (number | '…')[] {
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

function KycBadge({ status }: { status: 'VERIFIED' | 'PENDING' | 'REJECTED' }) {
  const map = {
    VERIFIED: { cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', dot: 'bg-emerald-500', label: 'Verified' },
    PENDING: { cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300', dot: 'bg-amber-500', label: 'Pending' },
    REJECTED: { cls: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300', dot: 'bg-rose-500', label: 'Rejected' },
  }[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold ${map.cls}`}>
      <span className={`h-2 w-2 rounded-full ${map.dot}`} /> {map.label}
    </span>
  );
}

function StatusBadge({ overdue, active }: { overdue: boolean; active: boolean }) {
  const map = overdue
    ? { cls: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300', dot: 'bg-rose-500', label: 'Overdue' }
    : active
      ? { cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', dot: 'bg-emerald-500', label: 'Active' }
      : { cls: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300', dot: 'bg-slate-400', label: 'Inactive' };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold ${map.cls}`}>
      <span className={`h-2 w-2 rounded-full ${map.dot}`} /> {map.label}
    </span>
  );
}

function RowAction({ icon, title, onClick, hover }: { icon: React.ReactNode; title: string; onClick: () => void; hover: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`grid h-9 w-9 place-items-center rounded-lg border-[0.5px] border-slate-200/70 bg-white text-slate-500 transition-all dark:border-white/[.06] dark:bg-white/[.03] ${hover}`}
    >
      {icon}
    </button>
  );
}

type SectionColor = 'blue' | 'violet' | 'emerald' | 'amber';
const sectionColorClasses: Record<SectionColor, string> = {
  blue: 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
  violet: 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
  emerald: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
  amber: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
};

/** Section divider with a colored icon chip, used inside the customer slide-over. */
function SectionHeader({ icon, title, color }: { icon: React.ReactNode; title: string; color: SectionColor }) {
  return (
    <div className="mb-4 flex items-center gap-2.5 border-b border-slate-100 dark:border-white/[.06] pb-2">
      <span className={`grid h-8 w-8 place-items-center rounded-lg ${sectionColorClasses[color]}`}>{icon}</span>
      <h4 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h4>
    </div>
  );
}

/** A single click-to-upload tile. Opens a file picker and shows the chosen
 *  file's name with a remove button. `missing` highlights it red when a
 *  required document was not provided on save. */
function UploadTile({
  label,
  icon,
  color,
  file,
  missing,
  optional,
  onPick,
}: {
  label: string;
  icon: React.ReactNode;
  color: SectionColor;
  file: File | null;
  missing?: boolean;
  optional?: boolean;
  onPick: (f: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const picked = !!file;
  return (
    <div
      className={`rounded-xl border px-4 py-3 transition-colors ${
        picked
          ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-500/30 dark:bg-emerald-500/10'
          : missing
            ? 'border-danger bg-danger/5'
            : 'border-dashed border-slate-300 dark:border-white/[.12] hover:border-primary hover:bg-primary-50/40'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => inputRef.current?.click()}>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${sectionColorClasses[color]}`}>
          {picked ? <Check size={18} /> : icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-slate-900 dark:text-white">
            {label}
            {optional && <span className="ml-1.5 text-[11px] font-normal text-muted">(Optional)</span>}
          </div>
          <div className={`truncate text-xs ${missing ? 'text-danger' : 'text-muted'}`}>
            {picked ? file!.name : missing ? 'Required — click to upload' : optional ? 'Optional — click to upload' : 'Click to upload'}
          </div>
        </div>
        {picked ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onPick(null); if (inputRef.current) inputRef.current.value = ''; }}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-red-100 hover:text-red-600"
            title="Remove"
          >
            <X size={15} />
          </span>
        ) : (
          <Upload size={16} className="shrink-0 text-muted" />
        )}
      </button>
    </div>
  );
}
