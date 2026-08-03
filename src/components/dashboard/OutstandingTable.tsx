import { cn } from '@/lib/utils';
import { Panel } from './Panel';

export interface OutstandingRow {
  id: number;
  loanLabel: string;
  amount: string;
  status: 'Due' | 'Overdue' | 'Daily';
  due: string;
}

const PILL: Record<OutstandingRow['status'], string> = {
  Due: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  Overdue: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
  Daily: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
};

/** Top outstanding loans, most-owed first. */
export function OutstandingTable({ rows, onViewAll }: { rows: OutstandingRow[]; onViewAll?: () => void }) {
  return (
    <Panel title="Top outstanding loans" action="View all" onAction={onViewAll}>
      <table className="w-full table-fixed border-collapse text-sm">
        <thead>
          <tr className="bg-gradient-to-r from-[#022999] via-[#0538cc] to-[#0AA8F8] text-left text-[12px] font-bold uppercase tracking-[0.06em] text-white">
            <th className="w-[34%] px-5 py-3.5">Loan</th>
            <th className="w-[30%] px-5 py-3.5">Amount</th>
            <th className="w-[18%] px-5 py-3.5">Status</th>
            <th className="w-[18%] px-5 py-3.5">Due</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-8 text-center text-muted">Nothing outstanding 🎉</td>
            </tr>
          ) : (
            rows.map((r) => {
              const overdue = r.status === 'Overdue';
              return (
                <tr key={r.id}>
                  <td className="truncate border-b-[0.5px] border-slate-200/70 py-2.5 text-ink dark:border-white/[.06]">
                    {r.loanLabel}
                  </td>
                  <td
                    className={cn(
                      'truncate border-b-[0.5px] border-slate-200/70 py-2.5 font-semibold dark:border-white/[.06]',
                      overdue ? 'text-red-600 dark:text-red-400' : 'text-ink',
                    )}
                  >
                    {r.amount}
                  </td>
                  <td className="border-b-[0.5px] border-slate-200/70 py-2.5 dark:border-white/[.06]">
                    <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold', PILL[r.status])}>
                      {r.status}
                    </span>
                  </td>
                  <td
                    className={cn(
                      'truncate border-b-[0.5px] border-slate-200/70 py-2.5 dark:border-white/[.06]',
                      overdue ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted',
                    )}
                  >
                    {r.due}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </Panel>
  );
}
