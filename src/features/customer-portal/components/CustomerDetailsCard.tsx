import type { ReactNode } from 'react';
import { Phone, MapPin, Home, BadgeCheck } from 'lucide-react';
import type { Customer } from '@/mock/DataContext';

function Row({ icon: Icon, label, children }: { icon: typeof Phone; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-4 rounded-2xl border border-slate-200/70 bg-slate-50/50 p-4 dark:border-white/[.06] dark:bg-white/[.02]">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600/15 to-violet-600/15 text-primary">
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">{label}</p>
        <div className="mt-1 text-[14px] font-medium leading-snug text-ink">{children}</div>
      </div>
    </div>
  );
}

export function CustomerDetailsCard({ customer, kycLine }: { customer: Customer; kycLine: string }) {
  return (
    <section className="rounded-card border border-slate-200/80 bg-surface p-4 shadow-card dark:border-white/[.08] sm:p-6">
      <h2 className="mb-3 font-display text-base font-bold text-ink sm:mb-4 sm:text-[17px]">Your profile</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <Row icon={Phone} label="Mobile">
          {customer.mobile}
          {customer.altMobile && (
            <span className="mt-1 block text-[13px] text-muted">Alt: {customer.altMobile}</span>
          )}
        </Row>
        {(customer.city || customer.state) && (
          <Row icon={MapPin} label="Location">
            {[customer.city, customer.state].filter(Boolean).join(', ')}
          </Row>
        )}
        {customer.address && (
          <Row icon={Home} label="Address">
            <span className="text-[13px] leading-relaxed">
              {customer.address}{customer.pincode ? ` — ${customer.pincode}` : ''}
            </span>
          </Row>
        )}
        {kycLine && (
          <Row icon={BadgeCheck} label="KYC">
            <span className="text-[13px] text-muted">{kycLine}</span>
          </Row>
        )}
      </div>
    </section>
  );
}
