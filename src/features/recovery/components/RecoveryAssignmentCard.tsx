import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Loan, Customer } from '@/mock/DataContext';
import { useData, LOAN_LABELS } from '@/mock/DataContext';
import { Badge } from '@/components/ui/badge';
import { whatsappHref } from '@/lib/whatsapp';
import { inr, fmtDate, initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  HandCoins, CalendarClock, Phone, MapPin, User, FileText, MessageCircle, ChevronDown, Pencil,
} from 'lucide-react';
import { RecoveryStatusChip } from './RecoveryStatusChip';
import type { CollectionClaimSubmission, PromiseSubmission } from '../types';

function DetailCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className="mt-0.5 truncate text-[13px] font-semibold text-ink" title={value}>{value}</p>
    </div>
  );
}

export function RecoveryAssignmentCard({
  loan,
  cust,
  agentName,
  due,
  claim,
  ptp,
  nd,
  scheduleOverdue,
  animationDelay = 0,
  onPay,
  onPromise,
  onStatement,
  onEditPending,
}: {
  loan: Loan;
  cust?: Customer;
  agentName: string;
  due: number;
  claim?: CollectionClaimSubmission;
  ptp?: PromiseSubmission;
  nd: string | null;
  scheduleOverdue: boolean;
  animationDelay?: number;
  onPay: () => void;
  onPromise: () => void;
  onStatement: () => void;
  onEditPending?: () => void;
}) {
  const d = useData();
  const [open, setOpen] = useState(false);
  const mobile = cust?.mobile || loan.contact || '';
  const altMobile = cust?.altMobile?.trim();
  const collected = d.collectedFor(loan.id);
  const outstanding = d.outstandingFor(loan);
  const location = [cust?.city, cust?.state].filter(Boolean).join(', ');
  const addressLine = cust?.address?.trim();
  const waHref = mobile
    ? whatsappHref(mobile, `Hi ${cust?.name ?? 'there'}, regarding your loan ${loan.loanNumber}.`)
    : null;
  const instalment = loan.dailyAmount ? inr(loan.dailyAmount) : '—';
  const pendingClaim = claim?.status === 'PENDING';

  return (
    <article
      className={cn(
        'anim-pop flex flex-col overflow-hidden rounded-[18px] border bg-surface shadow-card transition-shadow hover:shadow-soft dark:border-white/[.08]',
        claim?.status === 'APPROVED' && 'ring-2 ring-success/30',
        claim?.status === 'PENDING' && 'ring-2 ring-warning/35',
        claim?.status === 'REJECTED' && 'ring-2 ring-danger/30',
        due > 0 && !pendingClaim && 'border-danger/20',
      )}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <div className="bg-gradient-to-br from-[#022999] via-[#0538cc] to-[#0AA8F8] px-4 py-3.5 text-white">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-start gap-3 text-left"
          aria-expanded={open}
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15 text-[11px] font-bold ring-1 ring-white/20">
            {initials(cust?.name ?? '—')}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="truncate text-[16px] font-bold leading-tight">{cust?.name ?? 'Customer'}</h3>
              <span
                className={cn(
                  'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/10 transition-transform duration-300',
                  open && 'rotate-180',
                )}
              >
                <ChevronDown size={16} aria-hidden />
              </span>
            </div>
            <p className="mt-0.5 font-mono text-[10px] text-white/75">
              {loan.loanNumber}{cust?.code ? ` · ${cust.code}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone="info" className="border-0 bg-white/20 text-white shadow-none">{LOAN_LABELS[loan.type]}</Badge>
              {scheduleOverdue && <Badge tone="err" className="border-0 bg-danger/90 text-white shadow-none">Overdue</Badge>}
            </div>
          </div>
        </button>
        <p className="mt-2 pl-[52px] text-[10px] font-medium text-white/70">
          Agent <span className="text-white/95">{agentName}</span>
        </p>
      </div>

      {(claim || ptp) && (
        <div className="flex flex-col gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 dark:border-white/[.06] dark:bg-white/[.03]">
          <div className="flex flex-wrap items-center gap-2">
            {claim && <RecoveryStatusChip submission={claim} variant="surface" />}
            {ptp && <RecoveryStatusChip submission={ptp} variant="surface" />}
          </div>
          {claim?.status === 'PENDING' && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] font-semibold tabular-nums text-ink">
                {inr(claim.amount)} · {claim.mode} · {fmtDate(claim.receiptDate)}
              </p>
              {onEditPending && (
                <button
                  type="button"
                  onClick={onEditPending}
                  className="inline-flex items-center gap-1 rounded-lg border border-primary/25 bg-primary/[.06] px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"
                >
                  <Pencil size={12} /> Edit amount
                </button>
              )}
            </div>
          )}
          {claim?.status === 'APPROVED' && (
            <p className="text-[11px] text-muted">
              Last approved: {inr(claim.amount)} · {claim.mode} on {fmtDate(claim.receiptDate)}
            </p>
          )}
        </div>
      )}

      <div className="border-b border-slate-100 px-4 py-3 dark:border-white/[.06]">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-muted">Due now</p>
            <p className="font-display text-[22px] font-bold leading-none tabular-nums text-danger">{inr(due)}</p>
          </div>
          {nd && (
            <div className="text-right text-[11px] text-muted">
              Next due
              <span className={cn('mt-0.5 block font-semibold tabular-nums', scheduleOverdue ? 'text-danger' : 'text-ink')}>
                {fmtDate(nd)}
              </span>
            </div>
          )}
        </div>
        {mobile && !open && (
          <p className="mt-2 truncate text-[12px] text-muted">
            <Phone size={12} className="mr-1 inline opacity-70" aria-hidden />
            {mobile}{location ? ` · ${location}` : ''}
          </p>
        )}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-3 border-b border-slate-100 px-4 py-3 dark:border-white/[.06]">
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 dark:border-white/[.08] dark:bg-white/[.03]">
                <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-muted">
                  <User size={13} className="text-primary" /> Customer
                </p>
                {!cust ? (
                  <p className="text-[12px] text-muted">Profile not found — use loan contact if available.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5">
                    <DetailCell label="Mobile" value={cust.mobile || '—'} />
                    <DetailCell label="Alt mobile" value={altMobile || '—'} />
                    <DetailCell label="Father / spouse" value={cust.fatherName?.trim() || '—'} />
                    <DetailCell label="City" value={location || '—'} />
                  </div>
                )}
                {addressLine && (
                  <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-ink/85">
                    <MapPin size={13} className="mt-0.5 shrink-0 text-muted" />
                    <span>{addressLine}{cust?.pincode ? ` · ${cust.pincode}` : ''}</span>
                  </p>
                )}
                {cust?.referenceName && (
                  <p className="mt-2 text-[11px] text-muted">
                    Ref: <span className="font-semibold text-ink">{cust.referenceName}</span>
                    {cust.referenceMobile ? ` · ${cust.referenceMobile}` : ''}
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-slate-200/80 p-3 dark:border-white/[.08]">
                <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-muted">
                  <FileText size={13} className="text-primary" /> Loan
                </p>
                <div className="grid grid-cols-2 gap-2.5">
                  <DetailCell label="Principal" value={inr(loan.principal)} />
                  <DetailCell label="Outstanding" value={inr(outstanding)} />
                  <DetailCell label="Collected" value={inr(collected)} />
                  <DetailCell label="Instalment" value={instalment} />
                </div>
                {loan.remarks?.trim() && (
                  <p className="mt-2 text-[11px] text-muted">Note: <span className="text-ink">{loan.remarks}</span></p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                {mobile ? (
                  <a
                    href={`tel:${mobile}`}
                    className="touch-target flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 py-2.5 text-[11px] font-semibold text-ink hover:border-primary/40 hover:text-primary dark:border-white/[.08]"
                  >
                    <Phone size={16} /> Call
                  </a>
                ) : <span />}
                {waHref ? (
                  <a
                    href={waHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="touch-target flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border border-emerald-200/80 bg-emerald-50/70 py-2.5 text-[11px] font-semibold text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200"
                  >
                    <MessageCircle size={16} /> WhatsApp
                  </a>
                ) : <span />}
                <button
                  type="button"
                  onClick={onStatement}
                  className="touch-target flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border border-primary/20 bg-primary/[.04] py-2.5 text-[11px] font-semibold text-primary dark:bg-primary/10"
                >
                  <FileText size={16} /> Statement
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-2 gap-0 divide-x divide-slate-100 dark:divide-white/[.06]">
        <button
          type="button"
          disabled={pendingClaim}
          onClick={onPay}
          className={cn(
            'touch-target flex min-h-[3rem] items-center justify-center gap-1.5 py-3.5 text-[13px] font-semibold transition-colors sm:min-h-[3.25rem]',
            'text-success hover:bg-success/[.06] disabled:cursor-not-allowed disabled:opacity-45',
          )}
        >
          <HandCoins size={16} /> Paid
        </button>
        <button
          type="button"
          onClick={onPromise}
          className="touch-target flex min-h-[3rem] items-center justify-center gap-1.5 py-3.5 text-[13px] font-semibold text-primary transition-colors hover:bg-primary/[.05] sm:min-h-[3.25rem]"
        >
          <CalendarClock size={16} /> Promise
        </button>
      </div>

      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="border-t border-slate-100 py-2 text-center text-[11px] font-semibold text-primary hover:bg-primary/[.04] dark:border-white/[.06]"
        >
          View customer & loan details
        </button>
      )}
    </article>
  );
}
