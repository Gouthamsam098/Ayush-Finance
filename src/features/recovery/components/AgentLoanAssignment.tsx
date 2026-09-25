import { useMemo, useState } from 'react';
import { useData } from '@/mock/DataContext';
import { loanIdsAssignedToOtherAgents } from '@/features/recovery/recoveryStore';
import { cn } from '@/lib/utils';
import { inr } from '@/lib/format';
import { Search } from 'lucide-react';

interface Props {
  /** User being edited; omit when creating a new recovery agent. */
  agentUserId?: number;
  selectedLoanIds: number[];
  onChange: (ids: number[]) => void;
}

export function AgentLoanAssignment({ agentUserId, selectedLoanIds, onChange }: Props) {
  const d = useData();
  const [q, setQ] = useState('');

  const blockedLoanIds = useMemo(
    () => loanIdsAssignedToOtherAgents(agentUserId),
    [agentUserId],
  );

  const activeLoans = useMemo(() => {
    const query = q.trim().toLowerCase();
    return d.loans.filter((l) => {
      if (l.status !== 'ACTIVE') return false;
      if (blockedLoanIds.has(l.id)) return false;
      if (!query) return true;
      const c = d.customers.find((x) => x.id === l.customerId);
      return (
        l.loanNumber.toLowerCase().includes(query)
        || (c?.name ?? '').toLowerCase().includes(query)
        || (c?.mobile ?? '').includes(query)
      );
    });
  }, [d.loans, d.customers, q, blockedLoanIds]);

  const toggle = (id: number) => {
    if (selectedLoanIds.includes(id)) onChange(selectedLoanIds.filter((x) => x !== id));
    else onChange([...selectedLoanIds, id]);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 dark:border-white/[.08]">
      <div className="bg-gradient-to-r from-emerald-700 to-teal-600 px-4 py-3">
        <p className="text-[13px] font-bold text-white">Assigned loans</p>
        <p className="text-[11px] text-white/80">Only these accounts appear in the agent&apos;s Collections view.</p>
      </div>
      <div className="border-b border-slate-100 p-3 dark:border-white/[.06]">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search loan or customer…"
            className="h-10 w-full rounded-xl border border-slate-200 bg-surface pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 dark:border-white/[.08]"
          />
        </div>
      </div>
      <div className="max-h-[280px] overflow-y-auto divide-y divide-slate-100 dark:divide-white/[.05]">
        {activeLoans.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-muted">No active loans match.</p>
        ) : activeLoans.map((l) => {
          const c = d.customers.find((x) => x.id === l.customerId);
          const on = selectedLoanIds.includes(l.id);
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => toggle(l.id)}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/[.03]',
                on && 'bg-emerald-50/80 dark:bg-emerald-500/[.08]',
              )}
            >
              <span
                className={cn(
                  'grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[11px] font-bold',
                  on ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 dark:border-white/20',
                )}
              >
                {on ? '✓' : ''}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{c?.name ?? '—'}</span>
                <span className="font-mono text-[11px] text-muted">{l.loanNumber}</span>
              </span>
              <span className="shrink-0 text-[12px] font-semibold tabular-nums text-muted">{inr(d.outstandingFor(l))}</span>
            </button>
          );
        })}
      </div>
      <div className="border-t border-slate-100 px-4 py-2 text-[12px] text-muted dark:border-white/[.06]">
        {selectedLoanIds.length} loan{selectedLoanIds.length === 1 ? '' : 's'} selected
      </div>
    </div>
  );
}
