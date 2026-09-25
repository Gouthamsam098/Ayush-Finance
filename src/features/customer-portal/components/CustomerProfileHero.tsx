import { CustomerAvatar } from '@/components/CustomerAvatar';
import { fmtDate } from '@/lib/format';
import type { Customer } from '@/mock/DataContext';
import { ShieldCheck } from 'lucide-react';

export function CustomerProfileHero({ customer }: { customer: Customer }) {
  return (
    <div className="relative overflow-hidden rounded-card border border-slate-200/80 bg-surface shadow-[0_20px_50px_-24px_rgba(30,39,64,.25)] dark:border-white/[.08] dark:shadow-[0_24px_60px_-28px_rgba(0,0,0,.65)]">
      <div
        className="pointer-events-none absolute inset-0 opacity-90 dark:opacity-80"
        style={{
          background: 'linear-gradient(135deg, rgba(37,99,235,.14) 0%, rgba(139,92,246,.12) 45%, transparent 70%)',
        }}
      />
      <div className="relative flex flex-col gap-4 p-4 sm:gap-5 sm:p-6 md:flex-row md:items-center md:justify-between md:p-8">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <div className="relative">
            <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-blue-600 to-violet-500 opacity-40 blur-md" />
            <CustomerAvatar
              customerId={customer.id}
              name={customer.name}
              className="relative h-16 w-16 rounded-2xl shadow-[0_8px_24px_rgba(79,70,229,.45)]"
              textClassName="text-xl"
              fallbackStyle={{
                background: 'linear-gradient(to bottom right, #2563eb, #4f46e5, #7c3aed)',
                color: '#fff',
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Welcome back</p>
            <h1 className="font-display text-xl font-bold tracking-tight text-ink break-words sm:text-2xl md:text-[1.75rem]">{customer.name}</h1>
            <p className="mt-1 text-[12px] text-muted sm:text-[13px]">
              <span className="font-semibold text-ink/80">{customer.code}</span>
              <span className="mx-2 text-slate-300 dark:text-white/20">·</span>
              Member since {fmtDate(customer.createdAt)}
            </p>
          </div>
        </div>
        <div className="inline-flex items-center gap-2 self-start rounded-full border border-success/25 bg-success/10 px-3 py-1.5 text-[12px] font-semibold text-success sm:self-center">
          <ShieldCheck size={15} /> Verified borrower
        </div>
      </div>
    </div>
  );
}
