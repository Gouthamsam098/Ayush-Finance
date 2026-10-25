import { cn } from '@/lib/utils';
import type { CollectionClaimSubmission } from '../types';
import type { PaymentProofRecord } from '@/features/customer-portal/paymentProofStore';
import { recoveryClaimStatusLine, type ClaimStatusTone } from '../recoveryCollectionUi';
import { Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';

const toneStyles: Record<ClaimStatusTone, string> = {
  pending: 'border-amber-200/80 bg-amber-50/90 text-amber-950 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100',
  success: 'border-emerald-200/80 bg-emerald-50/90 text-emerald-950 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-100',
  danger: 'border-rose-200/80 bg-rose-50/90 text-rose-950 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-100',
  muted: 'border-slate-200/80 bg-slate-50/90 text-ink dark:border-white/[.08] dark:bg-white/[.03]',
};

const toneIcon: Record<ClaimStatusTone, typeof Clock> = {
  pending: Clock,
  success: CheckCircle2,
  danger: XCircle,
  muted: AlertCircle,
};

export function RecoveryClaimStatusBanner({
  claim,
  latestProof,
}: {
  claim: CollectionClaimSubmission;
  latestProof?: PaymentProofRecord | null;
}) {
  const { message, tone } = recoveryClaimStatusLine(claim, latestProof);
  const Icon = toneIcon[tone];
  return (
    <p
      className={cn(
        'flex items-start gap-2 rounded-xl border px-3 py-2 text-[12px] font-semibold leading-snug',
        toneStyles[tone],
      )}
      role="status"
    >
      <Icon size={14} className="mt-0.5 shrink-0 opacity-90" aria-hidden />
      <span>{message}</span>
    </p>
  );
}
