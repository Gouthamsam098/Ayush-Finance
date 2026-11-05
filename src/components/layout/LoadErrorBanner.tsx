import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useData } from '@/mock/DataContext';

/** Shown when the book failed to load (API mode). Without it a failed load
 *  looks exactly like an empty book — ₹0 KPIs, "no loans" — and is easy to
 *  mistake for real figures. */
export function LoadErrorBanner() {
  const { loadError, retryLoad } = useData();
  if (!loadError) return null;
  return (
    <div
      role="alert"
      className="mx-3 mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-[13px] text-ink sm:mx-6"
    >
      <AlertTriangle size={17} className="shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 flex-1">{loadError}</span>
      <button
        type="button"
        onClick={retryLoad}
        className="inline-flex items-center gap-1.5 rounded-lg border border-warning/40 px-3 py-1.5 text-[12.5px] font-semibold text-ink transition-colors hover:bg-warning/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/40"
      >
        <RefreshCw size={14} aria-hidden /> Retry
      </button>
    </div>
  );
}
