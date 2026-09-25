import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, ImageIcon, Smartphone } from 'lucide-react';
import { useData } from '@/mock/DataContext';
import { inr, fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { payPurposeTitle } from '@/features/customer-portal/loanPortalSummary';
import {
  listPaymentProofs,
  setPaymentProofStatus,
  PAYMENT_PROOF_SUBMITTED_EVENT,
  type PaymentProofRecord,
} from '@/features/customer-portal/paymentProofStore';

interface Props {
  canReview: boolean;
  onOpenLoan?: (loanId: number) => void;
}

export function CustomerPortalProofsPanel({ canReview, onOpenLoan }: Props) {
  const toast = useToast();
  const d = useData();
  const [tick, setTick] = useState(0);
  const [viewer, setViewer] = useState<PaymentProofRecord | null>(null);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const onChange = () => refresh();
    window.addEventListener(PAYMENT_PROOF_SUBMITTED_EVENT, onChange);
    return () => window.removeEventListener(PAYMENT_PROOF_SUBMITTED_EVENT, onChange);
  }, [refresh]);

  const proofs = useMemo(() => listPaymentProofs(), [tick]);
  const pendingCount = useMemo(() => proofs.filter((p) => p.status === 'pending').length, [proofs]);

  const customerName = (customerId: number) =>
    d.customers.find((c) => c.id === customerId)?.name ?? `Customer #${customerId}`;

  const markReviewed = (id: string) => {
    const updated = setPaymentProofStatus(id, 'verified');
    if (!updated) {
      toast('Could not update proof status', 'error');
      return;
    }
    toast('Marked as reviewed', 'success');
    refresh();
  };

  if (proofs.length === 0) {
    return (
      <section
        className="anim-pop rounded-2xl border border-dashed border-slate-200/90 bg-surface/60 px-4 py-5 dark:border-white/[.08]"
        aria-label="Customer portal payment proofs"
      >
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300">
            <Smartphone size={18} />
          </span>
          <div>
            <p className="font-display text-[14px] font-bold text-ink">Customer portal proofs</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              When borrowers upload UPI payment screenshots from the portal, they appear here for verification.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      <section
        className="anim-pop overflow-hidden rounded-2xl border border-violet-200/70 bg-surface shadow-card dark:border-violet-500/20"
        aria-label="Customer portal payment proofs"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100/80 bg-gradient-to-r from-violet-600/[.08] via-surface to-indigo-500/[.05] px-4 py-3.5 dark:border-white/[.06] sm:px-5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-300">
              <ImageIcon size={18} />
            </span>
            <div>
              <p className="font-display text-[15px] font-bold text-ink">Customer portal proofs</p>
              <p className="text-[11px] text-muted">
                {proofs.length} submission{proofs.length === 1 ? '' : 's'}
                {pendingCount > 0 && (
                  <span className="font-semibold text-amber-700 dark:text-amber-300">
                    {' '}· {pendingCount} pending review
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-muted dark:border-white/[.06]">
                <th className="px-4 py-2.5 sm:px-5">Submitted</th>
                <th className="px-4 py-2.5">Customer</th>
                <th className="px-4 py-2.5">Loan</th>
                <th className="px-4 py-2.5">Amount</th>
                <th className="px-4 py-2.5">Purpose</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right sm:px-5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/[.05]">
              {proofs.map((p) => (
                <tr key={p.id} className="text-[13px] text-ink">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted sm:px-5">
                    {fmtDate(p.submittedAt.slice(0, 10))}
                  </td>
                  <td className="max-w-[10rem] truncate px-4 py-3 font-medium">{customerName(p.customerId)}</td>
                  <td className="px-4 py-3">
                    {onOpenLoan ? (
                      <button
                        type="button"
                        onClick={() => onOpenLoan(p.loanId)}
                        className="font-semibold text-primary hover:underline"
                      >
                        {p.loanNumber}
                      </button>
                    ) : (
                      <span className="font-semibold">{p.loanNumber}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-semibold tabular-nums">{inr(p.amountRupees)}</td>
                  <td className="px-4 py-3 text-muted">{payPurposeTitle(p.purpose)}</td>
                  <td className="px-4 py-3">
                    <Badge
                      className={cn(
                        p.status === 'pending'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200'
                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
                      )}
                    >
                      {p.status === 'pending' ? 'Pending' : 'Reviewed'}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right sm:px-5">
                    <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                      <Button type="button" variant="ghost" className="h-8 px-2.5 text-[12px]" onClick={() => setViewer(p)}>
                        <Eye size={14} />
                        View
                      </Button>
                      {canReview && p.status === 'pending' && (
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 px-2.5 text-[12px] text-success"
                          onClick={() => markReviewed(p.id)}
                        >
                          Mark reviewed
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog
        open={!!viewer}
        onClose={() => setViewer(null)}
        wide
        title={viewer ? `Payment proof · ${viewer.loanNumber}` : 'Payment proof'}
        subtitle={
          viewer
            ? `${customerName(viewer.customerId)} · ${inr(viewer.amountRupees)} · ${viewer.fileName}`
            : undefined
        }
        footer={
          viewer && (
            <>
              <Button variant="ghost" onClick={() => setViewer(null)}>Close</Button>
              {canReview && viewer.status === 'pending' && (
                <Button onClick={() => { markReviewed(viewer.id); setViewer(null); }}>
                  Mark reviewed
                </Button>
              )}
            </>
          )
        }
      >
        {viewer && (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50/80 dark:border-white/[.08] dark:bg-white/[.03]">
              <img
                src={viewer.dataUrl}
                alt={`Payment screenshot for ${viewer.loanNumber}`}
                className="max-h-[min(70vh,520px)] w-full object-contain"
              />
            </div>
            <p className="text-center text-[11px] text-muted">
              Submitted {fmtDate(viewer.submittedAt.slice(0, 10))} · {payPurposeTitle(viewer.purpose)}
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}
