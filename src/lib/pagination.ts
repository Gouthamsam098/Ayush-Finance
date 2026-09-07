/**
 * Pagination primitives shared by every paged list (Loans, the dashboard's
 * Overdue Loans dialog, …).
 *
 * These lived privately inside `Loans.tsx`. They were lifted here — unchanged —
 * the moment a second list needed them, so the two footers cannot drift into
 * showing different page-number shapes for the same total.
 */

/** Rows-per-page choices offered in a pagination footer. */
export const PAGE_SIZE_OPTIONS = [6, 10, 25, 50];

/**
 * Page-number list with ellipses, e.g. `[1, '…', 4, 5, 6, '…', 12]`.
 * Up to 7 pages every number is shown; past that the current page keeps one
 * neighbour on each side and the first/last are always reachable.
 */
export function pageNumbers(current: number, total: number): (number | '…')[] {
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
