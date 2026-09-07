import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, Phone, Eye, FileDown, MoreVertical, X, ChevronLeft, ChevronRight, ChevronDown,
  HandCoins, AlertTriangle, IndianRupee, CalendarClock, FileSpreadsheet, Loader2,
} from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { WhatsAppIcon } from '@/components/ui/whatsapp-icon';
import { CityPill } from '@/components/ui/filter-kit';
import { useToast } from '@/components/ui/toast';
import { PAGE_SIZE_OPTIONS, pageNumbers } from '@/lib/pagination';
import { riskFor, RISK_PILL, AVATAR_TINT } from '@/lib/risk';
import { inr, inrShort, fmtDate, todayISO } from '@/lib/format';
import { LOAN_LABELS, type LoanType } from '@/mock/DataContext';

/**
 * One overdue loan, already shaped by the dashboard.
 *
 * The dialog is deliberately PRESENTATIONAL: every figure here was computed by
 * `Dashboard`'s existing helpers (`dueFor` / `outstandingFor` / `nextDueFor`),
 * and the row actions arrive as callbacks. Nothing in this file touches loan
 * math, the ledger, or the API — it filters, pages and renders rows it is given.
 */
export interface OverdueLoanRow {
  id: number;
  customer: string;
  loanNo: string;
  /** Overdue Amount — what is overdue right now. */
  due: number;
  /** Overdue Period in days. Risk is derived from this (see `@/lib/risk`). */
  days: number;
  /** YYYY-MM-DD the oldest unpaid instalment fell due. */
  dueSince: string;
  /** Display label, e.g. "Vehicle Loan". */
  type: string;
  /** Raw type, so the pill filter can match without parsing the label. */
  typeKey: LoanType;
  /** Total still owed on the loan. */
  outstanding: number;
  mobile: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** The FULL overdue list, worst-first. Not the card's top-6 slice. */
  rows: OverdueLoanRow[];
  onOpenLedger: (r: OverdueLoanRow) => void;
  onSendNotice: (r: OverdueLoanRow) => void | Promise<void>;
  telHrefFor: (r: OverdueLoanRow) => string | null;
  waHrefFor: (r: OverdueLoanRow) => string | null;
}

const ALL_TYPES = Object.keys(LOAN_LABELS) as LoanType[];

/** A headline figure above the table. Every value is real — see DESIGN_RULES. */
function SummaryTile({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: string; tone: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border-[0.5px] border-slate-200/80 bg-white px-3.5 py-3 dark:border-white/[.08] dark:bg-surface2">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${tone}`}>{icon}</span>
      <div className="min-w-0">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted">{label}</div>
        <div className="truncate text-[17px] font-bold leading-tight tracking-tight text-ink">{value}</div>
      </div>
    </div>
  );
}

export function OverdueLoansDialog({
  open, onClose, rows, onOpenLedger, onSendNotice, telHrefFor, waHrefFor,
}: Props) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  // SINGLE-select: picking a type replaces the previous one, so the list always
  // shows exactly one product (or all of them). Multi-select was tried and read
  // as broken — clicking Daily Collection then Vehicle accumulated both, so the
  // table still showed loans the user thought they had filtered away.
  const [type, setType] = useState<LoanType | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  const [exporting, setExporting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reopening the dialog should present the full list, not whatever filter was
  // left on last time — a stale filter reads as "there are only 3 overdue".
  useEffect(() => {
    if (!open) { setQuery(''); setType(null); setPage(1); setMenuFor(null); }
  }, [open]);

  const q = query.trim().toLowerCase();
  const searched = useMemo(() => (
    q
      ? rows.filter((r) =>
        r.customer.toLowerCase().includes(q)
        || r.loanNo.toLowerCase().includes(q)
        || r.type.toLowerCase().includes(q)
        || riskFor(r.days).toLowerCase().includes(q))
      : rows
  ), [rows, q]);

  // Type counts come from the SEARCHED set, so a pill's number always matches
  // what clicking it would actually show. Counting the unsearched list would
  // promise 8 Vehicle loans and then render 2.
  const countByType = useMemo(() => {
    const m = new Map<LoanType, number>();
    for (const r of searched) m.set(r.typeKey, (m.get(r.typeKey) ?? 0) + 1);
    return m;
  }, [searched]);

  const view = useMemo(() => (
    type ? searched.filter((r) => r.typeKey === type) : searched
  ), [searched, type]);

  const totalPages = Math.max(1, Math.ceil(view.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = view.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Any change to the result set returns to page 1 — otherwise a filter that
  // shrinks the list to 4 rows leaves you staring at an empty page 3.
  useEffect(() => { setPage(1); }, [q, type, pageSize]);
  // Paging keeps the scroll position from the previous page, so row 1 of the
  // new page can start halfway down. Reset it with each page turn.
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); setMenuFor(null); }, [currentPage]);

  const filtersOn = !!q || type !== null;
  const clearAll = () => { setQuery(''); setType(null); };
  /** Pick a type; clicking the one already picked returns to All. */
  const pickType = (t: LoanType) => setType((prev) => (prev === t ? null : t));

  // Headline figures describe the FILTERED set, so the strip doubles as filter
  // feedback: narrow to Vehicle and it tells you what Vehicle is owed.
  const totalOverdueAmount = view.reduce((s, r) => s + r.due, 0);
  const worstDays = view.reduce((m, r) => Math.max(m, r.days), 0);

  /** Export exactly what is on screen — the filtered list, every page of it. */
  const exportPDF = async () => {
    if (exporting || view.length === 0) return;
    setExporting(true);
    try {
      // jsPDF is ~430 KB; loaded on demand rather than bundled into the dashboard.
      const { buildDatasetReportPDF, shareOrDownloadPDF } = await import('@/lib/pdfReport');
      const scope = type ? LOAN_LABELS[type] : 'All loan types';
      const doc = buildDatasetReportPDF({
        title: 'Overdue Loans',
        subtitle: `${scope}${q ? ` · matching "${query.trim()}"` : ''} · ${view.length} ${view.length === 1 ? 'loan' : 'loans'} · as on ${fmtDate(todayISO())}`,
        summary: [
          { label: 'Loans overdue', value: String(view.length) },
          { label: 'Total overdue amount', value: inr(totalOverdueAmount) },
          { label: 'Worst case', value: `${worstDays} days` },
        ],
        tableHead: ['Customer', 'Loan No', 'Type', 'Overdue Since', 'Overdue Period', 'Overdue Amount', 'Outstanding', 'Mobile'],
        // Worst-first, matching the on-screen order. The overdue period is
        // written "92d", not 92, DELIBERATELY: buildDatasetReportPDF totals
        // every right-aligned column whose cells parse as a number, so a bare
        // 92 would print a meaningless "Rs.<sum of all days overdue>" in the
        // totals row. The "d" suffix fails its number test, so only the two ₹
        // columns are summed.
        tableBody: view.map((r) => [
          r.customer, r.loanNo, r.type, fmtDate(r.dueSince), `${r.days}d`,
          inr(r.due), inr(r.outstanding), r.mobile || '—',
        ]),
        rightAlignCols: [4, 5, 6],
      });
      const how = await shareOrDownloadPDF(doc, `Overdue-Loans-${todayISO()}.pdf`);
      toast(`${how === 'shared' ? 'Shared' : 'Downloaded'} — ${view.length} overdue ${view.length === 1 ? 'loan' : 'loans'}`, 'success');
    } catch {
      toast('Could not build the report. Please try again.', 'error');
    } finally {
      setExporting(false);
    }
  };

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>, id: number) => {
    if (menuFor === id) { setMenuFor(null); return; }
    const b = e.currentTarget.getBoundingClientRect();
    const MENU_H = 152;
    const below = window.innerHeight - b.bottom;
    setMenuPos({
      top: below < MENU_H ? b.top - MENU_H - 4 : b.bottom + 4,
      right: window.innerWidth - b.right,
    });
    setMenuFor(id);
  };

  /**
   * The open row's action menu, rendered ONCE for the whole dialog.
   *
   * The table and the stacked-card list are both mounted at every width —
   * `hidden`/`sm:hidden` only hide them in CSS — so calling this per row inside
   * each list portalled two identical menus into `document.body` for the same
   * row, stacked exactly on top of each other and both announced to screen
   * readers. Keying it off `menuFor` instead means one menu, always.
   */
  const openRow = menuFor === null ? undefined : pageRows.find((r) => r.id === menuFor);
  const rowMenu = openRow ? createPortal(
    <>
      <div className="fixed inset-0 z-[290]" onClick={() => setMenuFor(null)} aria-hidden />
      <div role="menu" aria-label={`Actions for ${openRow.customer}`} style={{ top: menuPos.top, right: menuPos.right }} className="fixed z-[300] w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-[0_12px_32px_rgba(30,39,64,.18)] dark:border-white/[.12] dark:bg-slate-900">
        <button role="menuitem" onClick={() => { setMenuFor(null); onOpenLedger(openRow); }} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-ink hover:bg-slate-50 dark:hover:bg-white/[.06]">
          <Eye size={15} className="shrink-0 text-muted" /> Open ledger
        </button>
        <button role="menuitem" onClick={() => { setMenuFor(null); void onSendNotice(openRow); }} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-ink hover:bg-slate-50 dark:hover:bg-white/[.06]">
          <FileDown size={15} className="shrink-0 text-rose-600" /> Send notice (PDF)
        </button>
        {waHrefFor(openRow) && (
          <a role="menuitem" href={waHrefFor(openRow)!} target="_blank" rel="noopener noreferrer" onClick={() => setMenuFor(null)} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-ink hover:bg-slate-50 dark:hover:bg-white/[.06]">
            <WhatsAppIcon size={15} /> WhatsApp
          </a>
        )}
      </div>
    </>,
    document.body,
  ) : null;

  const callBtn = (r: OverdueLoanRow, full = true) => {
    const href = telHrefFor(r);
    if (!href) return null;
    return (
      <a
        href={href}
        aria-label={`Call ${r.customer}`}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border-[0.5px] border-emerald-400 bg-emerald-50 px-2.5 text-[12px] font-semibold text-emerald-600 transition-colors hover:bg-emerald-100 dark:border-emerald-500/15 dark:bg-emerald-500/15 dark:text-emerald-400 dark:hover:bg-white/[.08]"
      >
        <Phone size={15} className="shrink-0" />
        {full && <span>Call</span>}
      </a>
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Overdue Loans"
      subtitle={`${rows.length} ${rows.length === 1 ? 'loan' : 'loans'} past due · worst first`}
      xl
      footer={
        view.length > 0 ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-3 text-[13px] text-muted">
            <span>
              Showing <span className="font-semibold text-ink">{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, view.length)}</span> of{' '}
              <span className="font-semibold text-ink">{view.length}</span> {view.length === 1 ? 'loan' : 'loans'}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                aria-label="Previous page"
                className="grid h-9 w-9 place-items-center rounded-lg border-[0.5px] border-slate-200 bg-white text-muted transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-white/10 dark:bg-surface dark:hover:bg-white/[.06]"
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
                    aria-current={p === currentPage ? 'page' : undefined}
                    className={`grid h-9 min-w-9 place-items-center rounded-lg px-2.5 text-[13px] font-semibold transition-colors ${
                      p === currentPage
                        ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30'
                        : 'border-[0.5px] border-slate-200 bg-white text-ink/70 hover:bg-slate-50 dark:border-white/10 dark:bg-surface dark:hover:bg-white/[.06]'
                    }`}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                aria-label="Next page"
                className="grid h-9 w-9 place-items-center rounded-lg border-[0.5px] border-slate-200 bg-white text-muted transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-white/10 dark:bg-surface dark:hover:bg-white/[.06]"
              >
                <ChevronRight size={16} />
              </button>
              <div className="relative ml-1">
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  aria-label="Rows per page"
                  className="h-9 appearance-none rounded-lg border-[0.5px] border-slate-200 bg-white pl-2.5 pr-8 text-[13px] text-muted outline-none [color-scheme:light] dark:border-white/10 dark:bg-surface dark:[color-scheme:dark]"
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n} style={{ backgroundColor: 'rgb(var(--surface))', color: 'rgb(var(--ink))' }}>{n} / page</option>
                  ))}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
              </div>
            </div>
          </div>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <div className="grid place-items-center py-16 text-center">
          <div>
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-500 ring-1 ring-emerald-100 dark:bg-emerald-500/15 dark:ring-emerald-500/20"><HandCoins size={26} /></div>
            <p className="text-[15px] font-semibold text-ink">No overdue loans</p>
            <p className="mt-1 text-[13px] text-muted">Every active loan is on schedule.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Headline figures — real, and scoped to the current filter. */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <SummaryTile icon={<AlertTriangle size={17} />} label="Loans overdue" value={String(view.length)} tone="bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300" />
            <SummaryTile icon={<IndianRupee size={17} />} label="Total overdue amount" value={inrShort(totalOverdueAmount)} tone="bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300" />
            <SummaryTile icon={<CalendarClock size={17} />} label="Worst case" value={worstDays ? `${worstDays} days` : '—'} tone="bg-slate-100 text-slate-600 dark:bg-white/[.06] dark:text-slate-300" />
          </div>

          {/* Search + export */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-xl border-[0.5px] border-slate-200/80 bg-white px-3 py-2 focus-within:border-indigo-400 dark:border-white/[.08] dark:bg-surface2">
              <Search size={15} className="shrink-0 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search customer, loan no, type…"
                aria-label="Search overdue loans"
                className="w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-muted"
              />
              {query && (
                <button onClick={() => setQuery('')} aria-label="Clear search" className="shrink-0 rounded p-0.5 text-muted hover:text-ink"><X size={14} /></button>
              )}
            </div>
            <button
              onClick={exportPDF}
              disabled={exporting || view.length === 0}
              className="inline-flex h-[38px] shrink-0 items-center gap-2 rounded-xl border-[0.5px] border-slate-200/80 bg-white px-3.5 text-[13px] font-semibold text-ink transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-white/[.08] dark:bg-surface2 dark:hover:bg-white/[.06]"
            >
              {exporting ? <Loader2 size={15} className="shrink-0 animate-spin text-muted" /> : <FileSpreadsheet size={15} className="shrink-0 text-rose-600" />}
              <span className="hidden sm:inline">{exporting ? 'Building…' : 'Export PDF'}</span>
            </button>
          </div>

          {/* Loan-type filter — ONE type at a time. Picking a type replaces the
              previous selection, so the table shows that product and nothing
              else; picking the selected one again (or "All") returns the full
              list. Each pill carries its live count, and a type with no overdue
              loans stays visible but disabled so the row does not reshuffle as
              you filter.

              `radiogroup`/`radio` roles, not buttons: they tell a screen-reader
              user that these are mutually exclusive, which is exactly the thing
              the multi-select version failed to communicate visually. */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span id="overdue-type-label" className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted">Loan type</span>
              {filtersOn && (
                <button onClick={clearAll} className="text-[12px] font-semibold text-muted transition-colors hover:text-ink">Clear all</button>
              )}
            </div>
            <div role="radiogroup" aria-labelledby="overdue-type-label" className="flex flex-wrap gap-1.5">
              <span role="radio" aria-checked={type === null}>
                <CityPill active={type === null} onClick={() => setType(null)}>
                  All <span className="ml-1 opacity-60">{searched.length}</span>
                </CityPill>
              </span>
              {ALL_TYPES.map((t) => {
                const n = countByType.get(t) ?? 0;
                return n === 0 && type !== t ? (
                  <span key={t} role="radio" aria-checked={false} aria-disabled className="cursor-not-allowed rounded-full border-[0.5px] border-slate-200/70 bg-slate-50 px-3.5 py-1.5 text-[13px] font-medium text-muted opacity-50 dark:border-white/[.06] dark:bg-white/[.02]" title="No overdue loans of this type">
                    {LOAN_LABELS[t]} <span className="ml-1 opacity-70">0</span>
                  </span>
                ) : (
                  <span key={t} role="radio" aria-checked={type === t}>
                    <CityPill active={type === t} onClick={() => pickType(t)}>
                      {LOAN_LABELS[t]} <span className="ml-1 opacity-60">{n}</span>
                    </CityPill>
                  </span>
                );
              })}
            </div>
          </div>

          {view.length === 0 ? (
            <div className="grid place-items-center rounded-xl border border-dashed border-slate-200 py-14 text-center dark:border-white/[.08]">
              <div>
                <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-muted dark:bg-white/[.06]"><Search size={20} /></div>
                <p className="text-[13.5px] font-semibold text-ink">No loans match these filters</p>
                <p className="mt-0.5 text-[12.5px] text-muted">Try a different search or loan type.</p>
                <button onClick={clearAll} className="mt-3 rounded-lg border-[0.5px] border-slate-200 px-3 py-1.5 text-[12.5px] font-semibold text-ink transition-colors hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/[.06]">Clear all filters</button>
              </div>
            </div>
          ) : (
            <>
              {/* ── Table (sm and up) ── */}
              <div ref={scrollRef} className="hidden overflow-x-auto rounded-xl border-[0.5px] border-slate-200/80 dark:border-white/[.08] sm:block">
                {/* min-w raised with the header text: "Overdue Amount" and
                    "Overdue Period" are ~2× the width of "Arrears"/"Overdue",
                    and table-fixed would have wrapped both onto two lines. */}
                <table className="w-full min-w-[900px] table-fixed text-sm">
                  <colgroup>
                    <col className="w-[22%]" />{/* Customer + loan no */}
                    <col className="w-[15%]" />{/* Type + since */}
                    <col className="w-[16%]" />{/* Overdue amount */}
                    <col className="w-[14%]" />{/* Outstanding */}
                    <col className="w-[16%]" />{/* Overdue period */}
                    <col className="w-[17%]" />{/* Actions */}
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_rgba(17,24,39,.06)] dark:bg-surface dark:shadow-[0_1px_0_rgba(255,255,255,.08)]">
                    {/* Header alignment mirrors the body cells: money and days
                        right, actions right, identity left. */}
                    <tr className="border-b-2 border-slate-200 bg-gradient-to-b from-slate-50 to-slate-100/60 text-[10.5px] font-bold uppercase tracking-[0.09em] text-slate-600 dark:border-white/[.10] dark:from-white/[.05] dark:to-white/[.02] dark:text-slate-300">
                      <th className="whitespace-nowrap px-3 py-2.5 text-left font-bold">Customer</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-left font-bold">Loan</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right font-bold">Overdue Amount</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right font-bold">Outstanding</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right font-bold">Overdue Period</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => {
                      const risk = riskFor(r.days);
                      return (
                        <tr key={r.id} className="border-b border-slate-100/70 transition-colors last:border-0 hover:bg-slate-50 dark:border-white/[.04] dark:hover:bg-white/[.03]">
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold ${AVATAR_TINT[risk]}`}>{r.customer.split(' ').map((x) => x[0]).slice(0, 2).join('')}</span>
                              <div className="min-w-0 leading-tight">
                                <div className="truncate font-semibold text-ink" title={r.customer}>{r.customer}</div>
                                <div className="truncate font-mono text-[11px] text-muted">{r.loanNo}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="min-w-0 leading-tight">
                              <div className="truncate text-[12.5px] text-ink" title={r.type}>{r.type}</div>
                              <div className="truncate text-[11px] text-muted">since {fmtDate(r.dueSince)}</div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right font-bold tabular-nums text-red-600 dark:text-red-400">{inr(r.due)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted">{inr(r.outstanding)}</td>
                          <td className="px-3 py-2.5 text-right">
                            <div className="font-semibold tabular-nums text-red-600 dark:text-red-400">{r.days}d</div>
                            <span className={`mt-0.5 inline-flex rounded-full px-1.5 py-px text-[10px] font-bold ${RISK_PILL[risk]}`}>{risk.replace(' Risk', '')}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <div
                              className="flex items-center justify-end gap-1.5"
                              onKeyDown={(e) => {
                                if (e.key === 'Escape' && menuFor === r.id) {
                                  e.stopPropagation();
                                  setMenuFor(null);
                                  (e.currentTarget.querySelector('button') as HTMLElement | null)?.focus();
                                }
                              }}
                            >
                              <button
                                onClick={(e) => openMenu(e, r.id)}
                                title="Actions"
                                aria-label={`Actions for ${r.customer}`}
                                aria-haspopup="menu"
                                aria-expanded={menuFor === r.id}
                                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-slate-100 hover:text-ink dark:hover:bg-white/[.08]"
                              >
                                <MoreVertical size={16} />
                              </button>
                              {callBtn(r)}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* ── Stacked cards (below sm) — a six-column table on a phone is
                  unreadable however it is scrolled, so the row is restructured
                  rather than shrunk. ── */}
              <div className="space-y-2.5 sm:hidden">
                {pageRows.map((r) => {
                  const risk = riskFor(r.days);
                  return (
                    <div key={r.id} className="rounded-xl border-[0.5px] border-slate-200/80 bg-white p-3 dark:border-white/[.08] dark:bg-surface2">
                      <div className="flex items-start gap-2.5">
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-bold ${AVATAR_TINT[risk]}`}>{r.customer.split(' ').map((x) => x[0]).slice(0, 2).join('')}</span>
                        <div className="min-w-0 flex-1 leading-tight">
                          <div className="truncate text-[13.5px] font-semibold text-ink">{r.customer}</div>
                          <div className="truncate font-mono text-[11px] text-muted">{r.loanNo} · {r.type}</div>
                        </div>
                        <div className="shrink-0 text-right leading-tight">
                          <div className="text-[13px] font-bold tabular-nums text-red-600 dark:text-red-400">{r.days}d</div>
                          <span className={`mt-0.5 inline-flex rounded-full px-1.5 py-px text-[10px] font-bold ${RISK_PILL[risk]}`}>{risk.replace(' Risk', '')}</span>
                        </div>
                      </div>
                      <div className="mt-3 flex items-end justify-between gap-3 border-t border-slate-100 pt-2.5 dark:border-white/[.06]">
                        <div className="min-w-0 leading-tight">
                          <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted">Overdue Amount</div>
                          <div className="text-[15px] font-bold tabular-nums text-red-600 dark:text-red-400">{inr(r.due)}</div>
                          <div className="mt-0.5 text-[11px] text-muted">{inr(r.outstanding)} outstanding · since {fmtDate(r.dueSince)}</div>
                        </div>
                        <div
                          className="flex shrink-0 items-center gap-1.5"
                          onKeyDown={(e) => {
                            if (e.key === 'Escape' && menuFor === r.id) { e.stopPropagation(); setMenuFor(null); }
                          }}
                        >
                          <button
                            onClick={(e) => openMenu(e, r.id)}
                            aria-label={`Actions for ${r.customer}`}
                            aria-haspopup="menu"
                            aria-expanded={menuFor === r.id}
                            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-slate-100 dark:hover:bg-white/[.08]"
                          >
                            <MoreVertical size={16} />
                          </button>
                          {callBtn(r, false)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* One menu for the whole dialog — see `rowMenu`. */}
          {rowMenu}
        </div>
      )}
    </Dialog>
  );
}
