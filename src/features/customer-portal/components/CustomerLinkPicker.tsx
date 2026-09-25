import { useMemo, useState } from 'react';
import { useData } from '@/mock/DataContext';
import { findPortalUserForCustomer } from '@/lib/mockUsers';
import { cn } from '@/lib/utils';
import { Search } from 'lucide-react';

interface Props {
  /** User being edited; omit when creating a new portal account. */
  portalUserId?: number;
  selectedCustomerId: number | null;
  onChange: (customerId: number | null) => void;
}

export function CustomerLinkPicker({ portalUserId, selectedCustomerId, onChange }: Props) {
  const d = useData();
  const [q, setQ] = useState('');

  const customers = useMemo(() => {
    const query = q.trim().toLowerCase();
    return d.customers
      .filter((c) => {
        if (!query) return true;
        return (
          c.name.toLowerCase().includes(query)
          || c.code.toLowerCase().includes(query)
          || c.mobile.includes(query)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [d.customers, q]);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/90 dark:border-white/[.08]">
      <div className="bg-gradient-to-r from-sky-700 to-blue-600 px-4 py-2.5">
        <p className="text-[13px] font-bold text-white">Link to customer record *</p>
        <p className="mt-0.5 text-[11px] text-white/80">Portal login sees only this borrower&apos;s loans and statements.</p>
      </div>
      <div className="border-b border-slate-100 bg-surface px-3 py-2 dark:border-white/[.06]">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, code, mobile…"
            className="w-full rounded-xl border border-slate-200/90 bg-surface py-2 pl-9 pr-3 text-[13px] text-ink outline-none focus:border-primary/40 dark:border-white/[.08]"
          />
        </div>
      </div>
      <ul className="max-h-[220px] overflow-y-auto divide-y divide-slate-100 dark:divide-white/[.05]">
        {customers.length === 0 ? (
          <li className="px-4 py-8 text-center text-[13px] text-muted">No customers match.</li>
        ) : customers.map((c) => {
          const taken = findPortalUserForCustomer(c.id, portalUserId);
          const selected = selectedCustomerId === c.id;
          const disabled = !!taken;
          return (
            <li key={c.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(c.id)}
                className={cn(
                  'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                  selected ? 'bg-primary/[.08]' : 'hover:bg-slate-50 dark:hover:bg-white/[.03]',
                  disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                    selected ? 'border-primary bg-primary' : 'border-slate-300 dark:border-white/20',
                  )}
                >
                  {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-[13px] text-ink">{c.name}</span>
                  <span className="text-[12px] text-muted">{c.code} · {c.mobile}</span>
                  {taken && (
                    <span className="mt-1 block text-[11px] font-medium text-amber-700 dark:text-amber-400">
                      Portal already linked to {taken.email}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
