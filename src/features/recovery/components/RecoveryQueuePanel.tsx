import { useState } from 'react';
import { useRecovery } from '../RecoveryContext';
import { inr, fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { Check, X, Loader2, Inbox } from 'lucide-react';

export function RecoveryQueuePanel() {
  const { submissions, approveClaim, rejectClaim } = useRecovery();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const queue = submissions.filter(
    (s) => (s.type === 'COLLECTION_CLAIM' && s.status === 'PENDING') || (s.type === 'PROMISE_TO_PAY' && s.status === 'OPEN'),
  );

  const onApprove = async (id: string) => {
    setBusy(id);
    try {
      await approveClaim(id);
      toast('Collection approved — ledger updated', 'success');
    } catch {
      toast('Could not approve — try again', 'error');
    } finally {
      setBusy(null);
    }
  };

  const onReject = (id: string) => {
    rejectClaim(id);
    toast('Submission rejected', 'info');
  };

  if (queue.length === 0) {
    return (
      <div className="anim-pop flex flex-col items-center gap-3 rounded-card border border-slate-200/90 bg-surface px-6 py-14 text-center shadow-card dark:border-white/[.07]">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-primary-50 text-primary dark:bg-primary/15">
          <Inbox size={26} />
        </div>
        <p className="font-display text-lg font-bold text-ink">Recovery queue is clear</p>
        <p className="max-w-sm text-[13px] text-muted">Pending collections and promise-to-pay entries from agents will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {queue.map((s) => (
        <article
          key={s.id}
          className={cn(
            'anim-pop flex flex-col gap-4 rounded-[18px] border bg-surface p-5 shadow-card transition-shadow hover:shadow-soft dark:border-white/[.08]',
            s.type === 'COLLECTION_CLAIM' ? 'border-warning/30' : 'border-primary/25',
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[16px] font-bold text-ink">{s.customerName}</h3>
              <p className="font-mono text-[12px] text-muted">{s.loanNumber}</p>
              <p className="mt-1 text-[12px] text-muted">Agent: {s.agentName} · {fmtDate(s.createdAt.slice(0, 10))}</p>
            </div>
            <Badge tone={s.type === 'COLLECTION_CLAIM' ? 'warn' : 'info'}>
              {s.type === 'COLLECTION_CLAIM' ? 'Collection' : 'Promise to pay'}
            </Badge>
          </div>

          {s.type === 'COLLECTION_CLAIM' ? (
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Amount</p>
                <p className="font-display text-2xl font-bold tabular-nums text-ink">{inr(s.amount)}</p>
                <p className="mt-1 text-[13px] text-muted">{s.mode} · Receipt {fmtDate(s.receiptDate)}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" className="py-2 text-xs" onClick={() => onReject(s.id)} disabled={busy === s.id}>
                  <X size={15} /> Reject
                </Button>
                <Button className="py-2 text-xs" onClick={() => onApprove(s.id)} loading={busy === s.id}>
                  {busy === s.id ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />}
                  Approve
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Promised date</p>
              <p className="font-display text-xl font-bold text-primary">{fmtDate(s.promiseDate)}</p>
              {s.promisedAmount ? <p className="mt-1 text-[13px] text-muted">Amount: {inr(s.promisedAmount)}</p> : null}
              {s.note && <p className="mt-2 text-[13px] text-muted">{s.note}</p>}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
