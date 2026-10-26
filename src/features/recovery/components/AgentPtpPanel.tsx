import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useData } from '@/mock/DataContext';
import { inr, fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CustomerAvatar } from '@/components/CustomerAvatar';
import type { PromiseSubmission } from '../types';
import {
  CalendarClock,
  CheckCircle2,
  HandCoins,
  Inbox,
  XCircle,
} from 'lucide-react';
import {
  classifyPtpTiming,
  ptpTimingLabel,
  type PtpTiming,
  PTP_FOLLOW_UP_AFTER_DAYS,
} from '@/lib/recoveryPtp';

type PtpFilter = 'ALL' | PtpTiming;

function timingBadgeTone(timing: PtpTiming): 'warn' | 'info' | 'err' | 'neutral' {
  if (timing === 'TODAY') return 'warn';
  if (timing === 'FOLLOW_UP') return 'err';
  if (timing === 'MISSED') return 'warn';
  return 'info';
}

function AgentPtpCard({
  submission,
  customerId,
  index,
  onCollect,
  onFulfill,
  onCancel,
}: {
  submission: PromiseSubmission;
  customerId: number;
  index: number;
  onCollect: () => void;
  onFulfill: () => void;
  onCancel: () => void;
}) {
  const timing = classifyPtpTiming(submission.promiseDate);

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04 }}
      className="min-w-0 overflow-hidden rounded-[18px] border border-slate-200/80 bg-surface shadow-card dark:border-white/[.08]"
    >
      <div
        className={cn(
          'h-1 w-full',
          timing === 'TODAY' && 'bg-gradient-to-r from-amber-400 to-orange-500',
          timing === 'FOLLOW_UP' && 'bg-gradient-to-r from-rose-500 to-rose-600',
          timing === 'MISSED' && 'bg-gradient-to-r from-amber-500/80 to-amber-600/80',
          timing === 'UPCOMING' && 'bg-gradient-to-r from-primary/60 to-violet-500/60',
        )}
        aria-hidden
      />
      <div className="p-4 sm:p-5">
        <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:text-left">
          <CustomerAvatar
            customerId={customerId}
            name={submission.customerName}
            className="h-11 w-11 shrink-0 rounded-xl"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col items-center gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div>
                <h3 className="font-display text-[16px] font-bold text-ink">{submission.customerName}</h3>
                <p className="mt-0.5 font-mono text-[11px] text-muted">{submission.loanNumber}</p>
              </div>
              <Badge tone={timingBadgeTone(timing)} className="shrink-0">
                {ptpTimingLabel(timing)}
              </Badge>
            </div>
            <p className="mt-3 font-display text-xl font-bold tabular-nums text-ink">
              {fmtDate(submission.promiseDate)}
            </p>
            {submission.promisedAmount != null && submission.promisedAmount > 0 ? (
              <p className="mt-1 text-[13px] text-muted">
                Promised <span className="font-semibold text-ink">{inr(submission.promisedAmount)}</span>
              </p>
            ) : null}
            {submission.note ? (
              <p className="mt-2 rounded-xl border border-slate-200/70 bg-slate-50/50 px-3 py-2 text-[12px] text-muted dark:border-white/[.06] dark:bg-white/[.02]">
                {submission.note}
              </p>
            ) : null}
            {timing === 'FOLLOW_UP' ? (
              <p className="mt-2 text-[11px] text-muted">
                Open longer than {PTP_FOLLOW_UP_AFTER_DAYS} day{PTP_FOLLOW_UP_AFTER_DAYS === 1 ? '' : 's'} — follow up or close.
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="button" className="w-full sm:w-auto" onClick={onCollect}>
            <HandCoins size={15} /> Collect
          </Button>
          <Button type="button" variant="success" className="w-full sm:w-auto" onClick={onFulfill}>
            <CheckCircle2 size={15} /> Mark fulfilled
          </Button>
          <Button type="button" variant="ghost" className="w-full text-muted sm:w-auto" onClick={onCancel}>
            <XCircle size={15} /> Cancel promise
          </Button>
        </div>
      </div>
    </motion.article>
  );
}

interface Props {
  agentUserId: number;
  promises: PromiseSubmission[];
  search: string;
  filter: PtpFilter;
  onFilterChange: (f: PtpFilter) => void;
  onCollect: (loanId: number) => void;
  onFulfill: (id: string) => void;
  onCancel: (id: string) => void;
}

const FILTER_OPTS: { key: PtpFilter; label: string }[] = [
  { key: 'ALL', label: 'All open' },
  { key: 'TODAY', label: 'Today' },
  { key: 'UPCOMING', label: 'Upcoming' },
  { key: 'MISSED', label: 'Missed' },
  { key: 'FOLLOW_UP', label: 'Follow up' },
];

export function AgentPtpPanel({
  agentUserId,
  promises,
  search,
  filter,
  onFilterChange,
  onCollect,
  onFulfill,
  onCancel,
}: Props) {
  const d = useData();
  const q = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    let rows = promises.filter((p) => p.agentUserId === agentUserId);
    if (filter !== 'ALL') {
      rows = rows.filter((p) => classifyPtpTiming(p.promiseDate) === filter);
    }
    if (!q) return rows;
    return rows.filter((p) =>
      p.customerName.toLowerCase().includes(q)
      || p.loanNumber.toLowerCase().includes(q)
      || p.promiseDate.includes(q));
  }, [promises, agentUserId, filter, q]);

  const counts = useMemo(() => {
    const mine = promises.filter((p) => p.agentUserId === agentUserId);
    const c: Record<PtpFilter, number> = { ALL: mine.length, TODAY: 0, UPCOMING: 0, MISSED: 0, FOLLOW_UP: 0 };
    for (const p of mine) {
      const t = classifyPtpTiming(p.promiseDate);
      c[t] += 1;
    }
    return c;
  }, [promises, agentUserId]);

  const customerIdFor = (loanId: number) => d.loans.find((l) => l.id === loanId)?.customerId ?? loanId;

  if (promises.length === 0) {
    return (
      <section className="flex flex-col items-center gap-3 rounded-card border border-dashed border-slate-200/90 bg-surface/60 px-6 py-14 text-center dark:border-white/[.08]">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
          <CalendarClock size={26} />
        </div>
        <p className="font-display text-lg font-bold text-ink">No open promises</p>
        <p className="max-w-sm text-[13px] text-muted">
          Use <strong>Promise</strong> on an assignment to log when the customer will pay.
        </p>
      </section>
    );
  }

  return (
    <section className="min-w-0 space-y-4" aria-label="Promise to pay">
      <div className="flex flex-wrap gap-2">
        {FILTER_OPTS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => onFilterChange(key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12px] font-semibold transition-all min-h-10',
              filter === key
                ? 'bg-gradient-to-r from-[#022999] to-violet-600 text-white shadow-soft'
                : 'border border-slate-200/90 bg-surface text-muted dark:border-white/[.07]',
            )}
          >
            {label}
            {counts[key] > 0 && (
              <span className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                filter === key ? 'bg-white/25' : 'bg-slate-100 dark:bg-white/10',
              )}>
                {counts[key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-card border border-slate-200/90 bg-surface px-6 py-12 text-center dark:border-white/[.07]">
          <Inbox size={28} className="text-muted" />
          <p className="font-display font-bold text-ink">No promises in this view</p>
          <p className="text-[13px] text-muted">Try another filter or search.</p>
        </div>
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          {filtered.map((s, i) => (
            <AgentPtpCard
              key={s.id}
              submission={s}
              customerId={customerIdFor(s.loanId)}
              index={i}
              onCollect={() => onCollect(s.loanId)}
              onFulfill={() => onFulfill(s.id)}
              onCancel={() => onCancel(s.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
