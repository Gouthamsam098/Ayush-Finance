import { useState } from 'react';
import { Copy, Check, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import type { UpiSnapshot } from '@/lib/recoveryClaimUpi';

interface Props {
  snap: UpiSnapshot;
  className?: string;
  compact?: boolean;
}

/** Admin-facing UPI block for recovery claims / receipts. */
export function RecoveryUpiDetails({ snap, className, compact }: Props) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snap.payeeVpa);
      setCopied(true);
      toast('UPI ID copied', 'success');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Could not copy UPI ID', 'error');
    }
  };

  return (
    <div
      className={cn(
        'rounded-xl border border-violet-200/70 bg-gradient-to-br from-violet-500/[.08] via-surface to-surface px-3 py-2.5 dark:border-violet-500/25 dark:from-violet-500/[.12]',
        compact && 'px-2.5 py-1.5',
        className,
      )}
    >
      <p className={cn('font-bold uppercase tracking-[0.12em] text-muted', compact ? 'text-[8px]' : 'text-[9px]')}>
        UPI received at
      </p>
      <div className={cn('flex flex-wrap items-center gap-1.5', compact ? 'mt-1' : 'mt-1.5')}>
        <span
          className={cn(
            'inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-[#5f259f]/10 font-medium text-ink dark:bg-violet-500/15',
            compact ? 'px-2 py-0.5 text-[11px]' : 'gap-1.5 px-2.5 py-1 text-[12px]',
          )}
        >
          <Lock size={11} className="shrink-0 text-[#5f259f] dark:text-violet-300" aria-hidden />
          <span className="truncate font-mono">{snap.payeeVpa}</span>
          <button
            type="button"
            onClick={() => void copy()}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-slate-200/80 hover:text-ink dark:hover:bg-white/10"
            aria-label="Copy UPI ID"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </span>
        {snap.payeeName ? (
          <span className="text-[12px] text-muted">
            Payee <span className="font-semibold text-ink">{snap.payeeName}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
