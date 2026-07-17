import { Banknote } from 'lucide-react';
import { Panel } from './Panel';

export interface ActivityRow {
  id: string;
  label: string;
  date: string;
  amount: string;
  mode: string;
}

/** Latest collection receipts. */
export function RecentActivity({ rows, onViewAll }: { rows: ActivityRow[]; onViewAll?: () => void }) {
  return (
    <Panel title="Recent activity" action="View all" onAction={onViewAll}>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted">No collections yet.</p>
      ) : (
        rows.map((r) => (
          <div
            key={r.id}
            className="flex items-center gap-2.5 border-b-[0.5px] border-slate-200/70 py-2.5 last:border-0 dark:border-white/[.06]"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-[0.5px] border-slate-200/70 bg-slate-50 text-slate-500 dark:border-white/[.06] dark:bg-white/[.03]">
              <Banknote size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-ink">{r.label}</div>
              <div className="text-xs text-muted">{r.date}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold text-ink">{r.amount}</div>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-muted dark:bg-white/[.06]">
                {r.mode}
              </span>
            </div>
          </div>
        ))
      )}
    </Panel>
  );
}
