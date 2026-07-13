import { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useData, LOAN_LABELS, type Customer } from '@/mock/DataContext';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Drawer } from '@/components/ui/drawer';
import { useToast } from '@/components/ui/toast';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { inr, fmtDate, initials } from '@/lib/format';
import { config } from '@/lib/config';
import { validateCustomerForm, INDIAN_STATES, type FieldErrors } from '@/lib/customerValidation';
import { customerApi } from '@/services/customerApi';
import { documentApi, type DocumentType } from '@/services/documentApi';
import { ApiError } from '@/lib/api';
import type { LoanType } from '@/mock/DataContext';
import { LOAN_LABELS as LOAN_TYPE_LABELS } from '@/mock/DataContext';
import {
  Search, Plus, Eye, Pencil, Trash2, Download, Users, UserCheck,
  FileText, IndianRupee, AlertTriangle, User, MapPin, ShieldCheck, Upload,
  CreditCard, Check, X, Car, Home, RotateCcw, ChevronLeft, ChevronRight,
  type LucideIcon,
} from 'lucide-react';

type FormState = Partial<Customer>;
const empty: FormState = { name: '', mobile: '' };
type KycKind = 'AADHAAR' | 'PAN';

/** Loan type drives which extra documents are collected. */
type LoanTypeOption = LoanType;
const LOAN_TYPE_OPTIONS: { value: LoanTypeOption; label: string }[] = (
  Object.entries(LOAN_TYPE_LABELS) as [LoanType, string][]
).map(([value, label]) => ({ value, label }));

/** Document tiles required per loan type. Aadhaar + PAN are always required;
 *  Vehicle adds License + RC, Property adds a Property document. */
const DOC_TILES: { type: DocumentType; label: string; icon: React.ReactNode; color: SectionColor }[] = [
  { type: 'AADHAAR', label: 'Aadhaar Card', icon: <FileText size={18} />, color: 'blue' },
  { type: 'PAN', label: 'PAN Card', icon: <CreditCard size={18} />, color: 'amber' },
  { type: 'LICENSE', label: 'Driving License', icon: <Car size={18} />, color: 'violet' },
  { type: 'RC', label: 'RC (Registration)', icon: <Car size={18} />, color: 'violet' },
  { type: 'PROPERTY', label: 'Property Document', icon: <Home size={18} />, color: 'emerald' },
];

function docTypesForLoan(loanType?: LoanTypeOption): DocumentType[] {
  const base: DocumentType[] = ['AADHAAR', 'PAN'];
  if (loanType === 'VEHICLE') return [...base, 'LICENSE', 'RC'];
  if (loanType === 'PROPERTY') return [...base, 'PROPERTY'];
  return base;
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

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const filterSelectCls =
  'h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition-all focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:border-white/10 dark:bg-white/5 dark:text-slate-200';

export default function Customers() {
  const d = useData();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [kycFilter, setKycFilter] = useState('');      // '', 'VERIFIED', 'PENDING'
  const [statusFilter, setStatusFilter] = useState(''); // '', 'ACTIVE', 'INACTIVE'
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [form, setForm] = useState<FormState | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
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

  // Derived KYC / activity state for a customer — used by both the filters and
  // the table badges so they always agree.
  const kycOf = (c: Customer): 'VERIFIED' | 'PENDING' =>
    c.hasAadhaar || c.hasPan || (c.address && c.city) ? 'VERIFIED' : 'PENDING';
  const isActive = (c: Customer) => d.loans.some((l) => l.customerId === c.id && l.status === 'ACTIVE');

  const filtered = useMemo(() => {
    const t = q.toLowerCase().trim();
    return d.customers.filter((c) => {
      const matchesQuery = !t
        || c.name.toLowerCase().includes(t)
        || c.mobile.includes(t)
        || c.code.toLowerCase().includes(t)
        || (c.email?.toLowerCase().includes(t) ?? false);
      const matchesCity = !cityFilter || c.city === cityFilter;
      const matchesKyc = !kycFilter || kycOf(c) === kycFilter;
      const matchesStatus = !statusFilter
        || (statusFilter === 'ACTIVE' ? isActive(c) : !isActive(c));
      return matchesQuery && matchesCity && matchesKyc && matchesStatus;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.customers, d.loans, q, cityFilter, kycFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const rows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const resetFilters = () => { setQ(''); setCityFilter(''); setKycFilter(''); setStatusFilter(''); setPage(1); };
  const filtersActive = !!(q || cityFilter || kycFilter || statusFilter);

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
    setForm((f) => ({ ...f, [k]: k === 'monthlyIncome' ? Number(v) || undefined : v }));
    // Clear this field's error as the user edits it.
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  };

  // Upload every file the user picked, for the document types relevant to the
  // chosen loan type. In API mode this hits the backend; mock mode is a no-op.
  const uploadPendingDocs = async (customerId: string) => {
    if (!config.useApi) return;
    for (const type of docTypesForLoan(loanType)) {
      const file = pendingDocs[type];
      if (file) {
        try { await documentApi.upload(customerId, type, file); }
        catch { toast(`Failed to upload ${type} document`, 'error'); }
      }
    }
  };

  const save = async () => {
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

    // Documents are mandatory. On create, every required doc for the loan type
    // must be attached. On edit, documents may already exist server-side, so we
    // only require any tile the user has newly opened but left empty is skipped.
    const required = docTypesForLoan(loanType);
    const missingDocs = editId ? [] : required.filter((t) => !pendingDocs[t]);

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

    if (editId && config.useApi) {
      // Update via API and await it so failures surface (no false success).
      try {
        const updated = await customerApi.update(editId, payload);
        await uploadPendingDocs(editId);
        d.updateCustomerRecord(updated); // reflect the authoritative record
        toast('Customer updated');
      } catch (e) {
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

  const loansOf = (id: string) => d.loans.filter((l) => l.customerId === id);
  const totalCustomers = d.customers.length;
  const kycVerified = d.customers.filter((c) => c.hasAadhaar || c.hasPan || (c.address && c.city)).length;
  const activeCustomers = d.customers.filter((c) => loansOf(c.id).some((l) => l.status === 'ACTIVE')).length;
  const pendingKyc = totalCustomers - kycVerified;
  const totalOutstanding = d.loans.reduce((sum, l) => sum + d.outstandingFor(l), 0);
  const overdue = d.loans.filter((l) => l.nextDueDate && l.nextDueDate < new Date().toISOString().split('T')[0] && l.status === 'ACTIVE').length;

  const stats: StatCard[] = [
    { label: 'Total Customers', value: totalCustomers.toLocaleString('en-IN'), icon: Users, color: 'blue', trend: '+12% vs last month' },
    { label: 'Active Customers', value: activeCustomers.toLocaleString('en-IN'), icon: UserCheck, color: 'emerald', trend: '+8% vs last month' },
    { label: 'Pending KYC', value: pendingKyc.toLocaleString('en-IN'), icon: FileText, color: 'amber', trend: 'awaiting review' },
    { label: 'Total Outstanding', value: inr(totalOutstanding), icon: IndianRupee, color: 'violet', trend: 'across all loans' },
    { label: 'Overdue Customers', value: overdue.toLocaleString('en-IN'), icon: AlertTriangle, color: 'rose', trend: 'need follow-up' },
  ];

  return (
    // Height is pinned to the viewport (minus the 64px header and main's
    // padding) so the page itself never scrolls — only the table body does.
    // 7rem ≈ header (4rem) + top/bottom padding (~3rem at lg).
    <div className="flex flex-col gap-6 h-[calc(100dvh-7rem)]">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Customers</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Manage customer profiles, KYC and loan accounts</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
            <Download size={16} /> Export
          </button>
          <button
            onClick={openAdd}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:shadow-xl hover:shadow-blue-500/30 hover:brightness-110 active:scale-[.98]"
          >
            <Plus size={16} /> Add Customer
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid shrink-0 grid-cols-2 gap-4 lg:grid-cols-5">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
            whileHover={{ y: -3 }}
            className={`relative overflow-hidden rounded-[20px] border p-5 shadow-sm backdrop-blur-xl transition-shadow hover:shadow-lg ${statCardBg[s.color]}`}
          >
            <div className={`mb-3 inline-flex h-11 w-11 items-center justify-center rounded-2xl ${statIconBg[s.color]}`}>
              <s.icon size={20} strokeWidth={2.2} />
            </div>
            <div className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{s.value}</div>
            <div className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">{s.label}</div>
            <div className={`mt-2 text-[11px] font-semibold ${statTrend[s.color]}`}>{s.trend}</div>
          </motion.div>
        ))}
      </div>

      {/* Table card — flexes to fill remaining height; only its body scrolls. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px] border border-slate-200/70 bg-white shadow-sm dark:border-white/10 dark:bg-surface">
        {/* Filter toolbar */}
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-100 p-4 dark:border-white/[.06]">
          <div className="relative min-w-[240px] flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder="Search by name, mobile, email or customer ID…"
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-10 pr-4 text-sm placeholder-slate-400 outline-none transition-all focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 dark:border-white/10 dark:bg-white/5"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className={filterSelectCls}
          >
            <option value="">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
          <select
            value={cityFilter}
            onChange={(e) => { setCityFilter(e.target.value); setPage(1); }}
            className={filterSelectCls}
          >
            <option value="">All Cities</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={kycFilter}
            onChange={(e) => { setKycFilter(e.target.value); setPage(1); }}
            className={filterSelectCls}
          >
            <option value="">All KYC</option>
            <option value="VERIFIED">Verified</option>
            <option value="PENDING">Pending</option>
          </select>
          <button
            onClick={resetFilters}
            disabled={!filtersActive}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-600 transition-all hover:bg-slate-50 disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
          >
            <RotateCcw size={14} /> Reset
          </button>
        </div>

        {/* Scrollable table body (page stays static) */}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-white/[.04]">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="px-6 py-3.5">Customer</th>
                <th className="px-6 py-3.5">Customer ID</th>
                <th className="px-6 py-3.5">Mobile</th>
                <th className="px-6 py-3.5">City</th>
                <th className="px-6 py-3.5">Loans</th>
                <th className="px-6 py-3.5">Outstanding</th>
                <th className="px-6 py-3.5">KYC</th>
                <th className="px-6 py-3.5">Status</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/[.05]">
              {rows.map((c, i) => {
                const cLoans = loansOf(c.id);
                const outstanding = cLoans.reduce((s, l) => s + d.outstandingFor(l), 0);
                const hasOverdue = cLoans.some((l) => l.nextDueDate && l.nextDueDate < new Date().toISOString().split('T')[0] && l.status === 'ACTIVE');
                const kyc = kycOf(c);
                return (
                  <motion.tr
                    key={c.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.03, 0.3) }}
                    className="group cursor-pointer transition-colors hover:bg-blue-50/40 dark:hover:bg-white/[.03]"
                    onClick={() => setView(c)}
                  >
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${avatarGradient(c.name)} text-xs font-bold text-white shadow-sm`}>
                          {initials(c.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-slate-900 dark:text-white">{c.name}</div>
                          <div className="truncate text-xs text-slate-500">{c.occupation || c.email || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3.5 font-mono text-xs text-slate-500">{c.code}</td>
                    <td className="px-6 py-3.5 text-slate-600 dark:text-slate-300">{c.mobile}</td>
                    <td className="px-6 py-3.5 text-slate-600 dark:text-slate-300">{c.city || '—'}</td>
                    <td className="px-6 py-3.5">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                        {cLoans.length} {cLoans.length === 1 ? 'Loan' : 'Loans'}
                      </span>
                    </td>
                    <td className="px-6 py-3.5">
                      <span className={`font-semibold ${hasOverdue ? 'text-rose-600' : 'text-slate-800 dark:text-slate-200'}`}>
                        {inr(outstanding)}
                      </span>
                    </td>
                    <td className="px-6 py-3.5"><KycBadge status={kyc} /></td>
                    <td className="px-6 py-3.5"><StatusBadge overdue={hasOverdue} active={cLoans.some((l) => l.status === 'ACTIVE')} /></td>
                    <td className="px-6 py-3.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <RowAction icon={<Eye size={15} />} title="View" onClick={() => setView(c)} hover="hover:bg-blue-100 hover:text-blue-600" />
                        <RowAction icon={<Pencil size={15} />} title="Edit" onClick={() => openEdit(c)} hover="hover:bg-violet-100 hover:text-violet-600" />
                        <RowAction icon={<Trash2 size={15} />} title="Delete" onClick={() => setConfirm(c)} hover="hover:bg-rose-100 hover:text-rose-600" />
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
              <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-blue-100 to-violet-100 text-blue-500 dark:from-blue-500/15 dark:to-violet-500/15">
                <Users size={28} />
              </div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                {filtersActive ? 'No matching customers' : 'No customers yet'}
              </h3>
              <p className="mt-1 max-w-xs text-sm text-slate-500">
                {filtersActive ? 'Try adjusting your search or filters.' : 'Add your first customer to get started.'}
              </p>
              {!filtersActive && (
                <button
                  onClick={openAdd}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:brightness-110"
                >
                  <Plus size={16} /> Add First Customer
                </button>
              )}
            </div>
          )}
        </div>

        {/* Pagination footer */}
        {filtered.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-3.5 dark:border-white/[.06]">
            <p className="text-sm text-slate-500">
              Showing <span className="font-semibold text-slate-700 dark:text-slate-200">{(currentPage - 1) * pageSize + 1}</span>–
              <span className="font-semibold text-slate-700 dark:text-slate-200">{Math.min(currentPage * pageSize, filtered.length)}</span> of{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-200">{filtered.length}</span> customers
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-all hover:bg-slate-50 disabled:opacity-40 dark:border-white/10 dark:bg-white/5"
              >
                <ChevronLeft size={16} />
              </button>
              {pageNumbers(currentPage, totalPages).map((p, idx) =>
                p === '…' ? (
                  <span key={`e${idx}`} className="px-1 text-slate-400">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p as number)}
                    className={`grid h-9 min-w-9 place-items-center rounded-xl px-2 text-sm font-semibold transition-all ${
                      p === currentPage
                        ? 'bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-md shadow-blue-500/25'
                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/5'
                    }`}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-all hover:bg-slate-50 disabled:opacity-40 dark:border-white/10 dark:bg-white/5"
              >
                <ChevronRight size={16} />
              </button>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="ml-1 h-9 rounded-xl border border-slate-200 bg-white px-2 text-sm text-slate-600 outline-none dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
              >
                {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n} / page</option>)}
              </select>
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
        footer={
          <>
            <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
            <Button onClick={save}>{editId ? 'Save Changes' : 'Save Customer'}</Button>
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
                <Input label="Mobile Number *" placeholder="Enter mobile number" value={form.mobile ?? ''} onChange={(e) => set('mobile', e.target.value)} error={errors.mobile} />
                <Input label="Alternate Mobile" placeholder="Enter alternate number" value={form.altMobile ?? ''} onChange={(e) => set('altMobile', e.target.value)} error={errors.altMobile} />
                <Input label="Email" type="email" placeholder="Enter email address" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} error={errors.email} />
                <Input label="Occupation" placeholder="Enter occupation" value={form.occupation ?? ''} onChange={(e) => set('occupation', e.target.value)} error={errors.occupation} />
                <Input label="Monthly Income" type="number" placeholder="Enter monthly income" value={form.monthlyIncome ?? ''} onChange={(e) => set('monthlyIncome', e.target.value)} error={errors.monthlyIncome} />
                <Input label="Date of Birth" type="date" value={form.dateOfBirth ?? ''} onChange={(e) => set('dateOfBirth', e.target.value)} error={errors.dateOfBirth} />
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
                <Input label="Reference Mobile" placeholder="Enter reference mobile" value={form.referenceMobile ?? ''} onChange={(e) => set('referenceMobile', e.target.value)} error={errors.referenceMobile} />
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
                  label="Aadhaar Number *"
                  placeholder="XXXX XXXX XXXX"
                  value={form.aadhaar ?? ''}
                  onChange={(e) => set('aadhaar', e.target.value.replace(/\D/g, '').slice(0, 12))}
                  error={errors.aadhaar}
                />
              ) : (
                <Input
                  label="PAN Number *"
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

              {/* Document uploads — conditional on loan type, all mandatory */}
              <div className="mt-6">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Upload Documents *</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {DOC_TILES.filter((t) => docTypesForLoan(loanType).includes(t.type)).map((tile) => (
                    <UploadTile
                      key={tile.type}
                      label={tile.label}
                      icon={tile.icon}
                      color={tile.color}
                      file={pendingDocs[tile.type] ?? null}
                      missing={docErrors.includes(tile.type)}
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
                    ? 'Upload to add or replace a document. JPEG, PNG, WebP or PDF, up to 5 MB each.'
                    : 'All documents are required. JPEG, PNG, WebP or PDF, up to 5 MB each.'}
                </p>
              </div>
            </section>
          </div>
        )}
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
              <div className="mb-2 text-sm font-semibold">Loans ({loansOf(view.id).length})</div>
              <div className="space-y-2">
                {loansOf(view.id).map((l) => (
                  <div key={l.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-sm hover:bg-slate-50">
                    <div className="flex items-center gap-2"><span className="font-mono text-xs text-slate-600">{l.loanNumber}</span><Badge tone="info">{LOAN_LABELS[l.type]}</Badge></div>
                    <div className="flex items-center gap-4"><span className="text-slate-600">{inr(l.principal)}</span><span className="font-semibold">Out: {inr(d.outstandingFor(l))}</span></div>
                  </div>
                ))}
                {loansOf(view.id).length === 0 && <p className="text-sm text-slate-600">No loans yet.</p>}
              </div>
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
          const parts = [`${custLoanList.length} loan${custLoanList.length === 1 ? '' : 's'}`, `${colCount} collection${colCount === 1 ? '' : 's'}`];
          if (docCount) parts.push(`${docCount} document${docCount === 1 ? '' : 's'}`);
          return (
            <div className="space-y-2 text-sm text-slate-600">
              <p>This permanently removes <span className="font-semibold text-slate-900">{confirm.name}</span> and <span className="font-semibold text-red-600">all their linked records</span> from every screen (Loans, Collections, Documents, Reports).</p>
              <p>Will also delete: <span className="font-semibold">{parts.join(', ')}</span>.</p>
              <p>This cannot be undone.</p>
            </div>
          );
        })()}
      </Dialog>
    </div>
  );
}

// ─────────────── stat card styling ───────────────
type StatColor = 'blue' | 'emerald' | 'amber' | 'violet' | 'rose';
interface StatCard { label: string; value: string; icon: LucideIcon; color: StatColor; trend: string; }

const statCardBg: Record<StatColor, string> = {
  blue: 'border-blue-100 bg-gradient-to-br from-blue-50/80 to-white dark:border-blue-500/20 dark:from-blue-500/10 dark:to-transparent',
  emerald: 'border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-white dark:border-emerald-500/20 dark:from-emerald-500/10 dark:to-transparent',
  amber: 'border-amber-100 bg-gradient-to-br from-amber-50/80 to-white dark:border-amber-500/20 dark:from-amber-500/10 dark:to-transparent',
  violet: 'border-violet-100 bg-gradient-to-br from-violet-50/80 to-white dark:border-violet-500/20 dark:from-violet-500/10 dark:to-transparent',
  rose: 'border-rose-100 bg-gradient-to-br from-rose-50/80 to-white dark:border-rose-500/20 dark:from-rose-500/10 dark:to-transparent',
};
const statIconBg: Record<StatColor, string> = {
  blue: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  emerald: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  amber: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  violet: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  rose: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};
const statTrend: Record<StatColor, string> = {
  blue: 'text-blue-600 dark:text-blue-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
  violet: 'text-violet-600 dark:text-violet-400',
  rose: 'text-rose-600 dark:text-rose-400',
};

// Deterministic gradient per name so avatars are colourful but stable.
const AVATAR_GRADIENTS = [
  'from-blue-400 to-blue-600', 'from-violet-400 to-violet-600',
  'from-emerald-400 to-emerald-600', 'from-amber-400 to-orange-500',
  'from-rose-400 to-rose-600', 'from-cyan-400 to-blue-500',
  'from-fuchsia-400 to-violet-600',
];
function avatarGradient(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
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
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${map.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${map.dot}`} /> {map.label}
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
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${map.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${map.dot}`} /> {map.label}
    </span>
  );
}

function RowAction({ icon, title, onClick, hover }: { icon: React.ReactNode; title: string; onClick: () => void; hover: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition-all ${hover}`}
    >
      {icon}
    </button>
  );
}

type SectionColor = 'blue' | 'violet' | 'emerald' | 'amber';
const sectionColorClasses: Record<SectionColor, string> = {
  blue: 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
  violet: 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400',
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
  onPick,
}: {
  label: string;
  icon: React.ReactNode;
  color: SectionColor;
  file: File | null;
  missing?: boolean;
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
          <div className="text-sm font-medium text-slate-900 dark:text-white">{label}</div>
          <div className={`truncate text-xs ${missing ? 'text-danger' : 'text-muted'}`}>
            {picked ? file!.name : missing ? 'Required — click to upload' : 'Click to upload'}
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
