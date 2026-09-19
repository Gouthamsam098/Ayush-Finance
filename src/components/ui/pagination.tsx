import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { PAGE_SIZE_OPTIONS, pageNumbers } from '@/lib/pagination';

/**
 * The pagination footer shared by every paged list.
 *
 * Loans and the Overdue dialog each hand-rolled this markup; Collections and
 * Reports would have made four copies of the same forty lines, which is how the
 * page-number shapes drift apart. The behaviour (ellipsis windowing, per-page
 * options) lives in `@/lib/pagination`; this is only its chrome.
 *
 * Renders nothing when there is a single page AND the row count is below the
 * smallest page size — a footer that says "Showing 1-3 of 3" with one dead
 * page button is noise.
 */
export function PaginationBar({
  page, pageSize, total, onPage, onPageSize, itemLabel = 'records', className,
}: {
  /** 1-based, already clamped by the caller. */
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
  /** Plural noun for the count, e.g. "loans". */
  itemLabel?: string;
  className?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  if (totalPages === 1 && total <= PAGE_SIZE_OPTIONS[0]) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted ${className ?? ''}`}>
      <span>
        Showing <span className="font-semibold text-ink tabular-nums">{from}–{to}</span> of{' '}
        <span className="font-semibold text-ink tabular-nums">{total}</span> {itemLabel}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page === 1}
          aria-label="Previous page"
          className="grid h-9 w-9 place-items-center rounded-lg border-[0.5px] border-slate-200 bg-white text-muted transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-white/10 dark:bg-surface dark:hover:bg-white/[.06]"
        >
          <ChevronLeft size={16} />
        </button>
        {/* Page numbers are hidden on the narrowest screens: seven 36px buttons
            plus the per-page select do not fit beside the count on a phone, and
            wrapping them pushed the table down. Prev/Next still page there. */}
        <div className="hidden items-center gap-1.5 sm:flex">
          {pageNumbers(page, totalPages).map((p, idx) => (
            p === '…' ? (
              <span key={`e${idx}`} className="px-1 text-muted">…</span>
            ) : (
              <button
                key={p}
                onClick={() => onPage(p as number)}
                aria-current={p === page ? 'page' : undefined}
                className={`grid h-9 min-w-9 place-items-center rounded-lg px-2.5 text-[13px] font-semibold transition-colors ${
                  p === page
                    ? 'bg-blue-500 text-white shadow-sm shadow-blue-500/30'
                    : 'border-[0.5px] border-slate-200 bg-white text-ink/70 hover:bg-slate-50 dark:border-white/10 dark:bg-surface dark:hover:bg-white/[.06]'
                }`}
              >
                {p}
              </button>
            )
          ))}
        </div>
        {/* On a phone the numbers above are hidden, so state the position. */}
        <span className="px-1 text-[12.5px] font-semibold text-ink tabular-nums sm:hidden">{page} / {totalPages}</span>
        <button
          onClick={() => onPage(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          aria-label="Next page"
          className="grid h-9 w-9 place-items-center rounded-lg border-[0.5px] border-slate-200 bg-white text-muted transition-colors hover:bg-slate-50 disabled:opacity-40 dark:border-white/10 dark:bg-surface dark:hover:bg-white/[.06]"
        >
          <ChevronRight size={16} />
        </button>
        <div className="relative ml-1">
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
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
  );
}
