import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CalendarClock,
  CheckCircle2,
  HandCoins,
  ImageIcon,
  Pencil,
  ScrollText,
  XCircle,
} from 'lucide-react';
import { useRecovery } from '../RecoveryContext';
import { listPaymentProofs, PAYMENT_PROOF_SUBMITTED_EVENT } from '@/features/customer-portal/paymentProofStore';
import {
  AGENT_ACTIVITY_CHANGED,
  listAgentActivities,
  type AgentActivityKind,
  type AgentActivityRow,
} from '@/lib/recoveryAgentActivity';
import { fmtDate, inr } from '@/lib/format';
import { cn } from '@/lib/utils';
import { RECOVERY_SUBMISSIONS_CHANGED } from '../recoveryStore';

const kindMeta: Record<
  AgentActivityKind,
  { icon: typeof HandCoins; tone: string }
> = {
  COLLECT_SUBMITTED: { icon: HandCoins, tone: 'text-amber-700 dark:text-amber-300 bg-amber-500/12' },
  COLLECT_UPDATED: { icon: Pencil, tone: 'text-primary bg-primary/10' },
  COLLECT_APPROVED: { icon: CheckCircle2, tone: 'text-success bg-success/10' },
  COLLECT_REJECTED: { icon: XCircle, tone: 'text-danger bg-danger/10' },
  PTP_SET: { icon: CalendarClock, tone: 'text-violet-700 dark:text-violet-300 bg-violet-500/12' },
  PTP_FULFILLED: { icon: CheckCircle2, tone: 'text-success bg-success/10' },
  PTP_CANCELLED: { icon: XCircle, tone: 'text-muted bg-slate-500/10' },
  PROOF_UPLOADED: { icon: ImageIcon, tone: 'text-indigo-700 dark:text-indigo-300 bg-indigo-500/12' },
};

function ActivityRow({ row, index }: { row: AgentActivityRow; index: number }) {
  const meta = kindMeta[row.kind];
  const Icon = meta.icon;
  const when = row.at.includes('T')
    ? `${fmtDate(row.at.slice(0, 10))} · ${row.at.slice(11, 16)}`
    : fmtDate(row.at.slice(0, 10));

  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index, 8) * 0.03 }}
      className="flex gap-3 rounded-xl border border-slate-200/80 bg-surface px-3 py-2.5 shadow-soft dark:border-white/[.08]"
    >
      <span
        className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', meta.tone)}
        aria-hidden
      >
        <Icon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <p className="font-display text-[13px] font-bold text-ink">{row.title}</p>
          {row.amountRupees != null && row.amountRupees > 0 ? (
            <p className="shrink-0 text-[13px] font-bold tabular-nums text-ink">{inr(row.amountRupees)}</p>
          ) : null}
        </div>
        <p className="mt-0.5 text-[11px] text-muted">
          <span className="font-semibold text-ink/90">{row.customerName}</span>
          <span className="text-muted/70"> · </span>
          <span className="font-mono">{row.loanNumber}</span>
        </p>
        {row.detail ? (
          <p className="mt-1 text-[11px] leading-snug text-muted">{row.detail}</p>
        ) : null}
        <p className="mt-1 text-[10px] tabular-nums text-muted/80">{when}</p>
      </div>
    </motion.li>
  );
}

export function AgentActivityPanel({
  agentUserId,
  search,
}: {
  agentUserId: number;
  search: string;
}) {
  const { submissions } = useRecovery();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener(RECOVERY_SUBMISSIONS_CHANGED, bump);
    window.addEventListener(AGENT_ACTIVITY_CHANGED, bump);
    window.addEventListener(PAYMENT_PROOF_SUBMITTED_EVENT, bump);
    return () => {
      window.removeEventListener(RECOVERY_SUBMISSIONS_CHANGED, bump);
      window.removeEventListener(AGENT_ACTIVITY_CHANGED, bump);
      window.removeEventListener(PAYMENT_PROOF_SUBMITTED_EVENT, bump);
    };
  }, []);

  const activities = useMemo(
    () => listAgentActivities(agentUserId, submissions, listPaymentProofs()),
    [agentUserId, submissions, tick],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activities;
    return activities.filter(
      (a) =>
        a.customerName.toLowerCase().includes(q)
        || a.loanNumber.toLowerCase().includes(q)
        || a.title.toLowerCase().includes(q)
        || (a.detail ?? '').toLowerCase().includes(q),
    );
  }, [activities, search]);

  if (filtered.length === 0) {
    return (
      <section
        className="anim-pop flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200/90 bg-surface/60 px-6 py-14 text-center dark:border-white/[.08]"
        aria-label="Activity history"
      >
        <div className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
          <ScrollText size={26} aria-hidden />
        </div>
        <p className="font-display text-lg font-bold text-ink">
          {search.trim() ? 'No matching activity' : 'No activity yet'}
        </p>
        {!search.trim() && (
          <p className="max-w-sm text-[13px] text-muted">
            Collect, promise-to-pay, and screenshot actions you take on assignments appear here.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="anim-pop min-w-0" aria-label="Activity history">
      <ul className="flex max-h-[min(70dvh,640px)] flex-col gap-2 overflow-y-auto pr-0.5">
        {filtered.map((row, i) => (
          <ActivityRow key={row.id} row={row} index={i} />
        ))}
      </ul>
    </section>
  );
}
