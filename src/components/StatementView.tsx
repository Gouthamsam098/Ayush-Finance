import { useMemo } from 'react';
import type { Loan } from '@/mock/DataContext';
import {
  LOAN_LABELS, isDailyLoan, behavesEmi, behavesInterestOnly, upfrontDeduction, useData,
} from '@/mock/DataContext';
import { inr, fmtDate, todayISO } from '@/lib/format';
import { buildSchedule } from '@/lib/loanSchedule';
import { FileText, Wallet, Percent, CalendarDays, ArrowDownToLine } from 'lucide-react';

/** A labelled field with dotted-leader alignment for the statement header grid. */
function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-2 text-[12.5px]">
      <span className="shrink-0 font-semibold text-muted">{k}</span>
      <span className="min-w-0 flex-1 translate-y-[-3px] border-b border-dotted border-slate-300/70 dark:border-white/[.12]" />
      <span className="shrink-0 text-right font-semibold text-ink">{v}</span>
    </div>
  );
}

/**
 * Bank-style "Payment Schedule" statement — same chrome for every loan type
 * (Daily Collection layout is the visual reference). Schedule math is per
 * product; this component only presents rows from `buildSchedule`.
 */
export function StatementView({ loan }: { loan: Loan }) {
  const d = useData();
  const cust = d.customers.find((c) => c.id === loan.customerId);
  const interestOnly = behavesInterestOnly(loan);
  const emi = behavesEmi(loan);

  // Interest-only schedules are funded by INTEREST payments only (principal
  // settlements must not mark interest periods as Paid).
  const collected = useMemo(() => {
    if (!interestOnly) return d.collectedFor(loan.id);
    return d.collections
      .filter((c) => c.loanId === loan.id && c.kind !== 'PRINCIPAL')
      .reduce((s, c) => s + c.amount, 0);
  }, [d.collections, d, loan.id, interestOnly]);

  const lastPayment = useMemo(() => {
    const colls = d.collections.filter((c) => c.loanId === loan.id);
    if (!colls.length) return null;
    const last = colls.reduce((a, b) => (b.id > a.id ? b : a));
    return { amount: last.amount, date: last.date };
  }, [d.collections, loan.id]);

  const schedule = useMemo(
    () => buildSchedule(loan, { collected, settlement: lastPayment }),
    [loan, collected, lastPayment],
  );

  const instalment = loan.dailyAmount ?? 0;
  const paidCount = instalment > 0 ? Math.floor(collected / instalment) : 0;
  const deduction = emi || interestOnly ? 0 : (loan.deduction ?? upfrontDeduction(loan.type, loan.interest));
  const netDisbursed = loan.disbursed ?? Math.max(0, loan.principal - deduction);
  const freq = isDailyLoan(loan.type)
    ? 'Daily'
    : loan.type === 'DAILY_INTEREST'
      ? 'Daily'
      : loan.type === 'FLEXIBLE'
        ? 'Flexible cycle'
        : 'Monthly';
  const tenureLabel = interestOnly
    ? (loan.type === 'FLEXIBLE'
      ? `${loan.numDays ?? 30} days / cycle`
      : loan.type === 'DAILY_INTEREST'
        ? 'Open-ended (daily)'
        : 'Open-ended (monthly)')
    : `${loan.numDays ?? schedule.length} ${isDailyLoan(loan.type) ? 'days' : 'months'}`;
  const closed = loan.status !== 'ACTIVE';

  const totalPrincipal = schedule.reduce((s, r) => s + r.principal, 0);
  const totalInterest = schedule.reduce((s, r) => s + r.interest, 0);
  const totalInstal = schedule.reduce((s, r) => s + r.instalment, 0);

  return (
    <div className="overflow-hidden rounded-xl border-[0.5px] border-slate-200/80 bg-white text-ink shadow-card dark:border-white/[.08] dark:bg-surface">
      {/* Document header — brand band with title + reference */}
      <div className="relative overflow-hidden bg-gradient-to-r from-[#022999] via-[#0538cc] to-[#0AA8F8] px-5 py-4 text-white">
        <span className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15 ring-1 ring-white/20 backdrop-blur">
              <FileText size={19} />
            </span>
            <div>
              <div className="font-display text-[16px] font-bold leading-none tracking-tight">Payment Schedule</div>
              <div className="mt-1 text-[12px] text-white/75">{LOAN_LABELS[loan.type]} · {loan.loanNumber}</div>
            </div>
          </div>
          <span className={`hidden shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 sm:inline-flex ${
            closed ? 'bg-white/15 text-white ring-white/25' : 'bg-emerald-400/20 text-emerald-50 ring-emerald-300/40'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${closed ? 'bg-white/70' : 'bg-emerald-300'}`} />
            {closed ? 'Closed' : 'Active'}
          </span>
        </div>
      </div>

      <div className="space-y-4 p-5">
        {/* Borrower / loan detail card */}
        <div className="grid grid-cols-1 gap-x-10 gap-y-2 rounded-xl border-[0.5px] border-slate-200/70 bg-slate-50/60 p-4 sm:grid-cols-2 dark:border-white/[.06] dark:bg-white/[.02]">
          <Field k="Customer" v={cust?.name ?? '—'} />
          <Field k="Loan Type" v={LOAN_LABELS[loan.type]} />
          <Field k="Loan Reference" v={loan.loanNumber} />
          <Field k="Loan Start Date" v={fmtDate(loan.loanDate)} />
          <Field k="Mobile" v={loan.contact || cust?.mobile || '—'} />
          <Field k="Frequency" v={`${freq} instalments`} />
          <Field k="Total Tenure" v={tenureLabel} />
          <Field k="Rate" v={`${loan.rate}%`} />
          <Field k="Loan Amount" v={inr(loan.principal)} />
          <Field k={interestOnly ? 'Interest / period' : emi ? 'EMI' : 'Instalment'} v={inr(instalment)} />
        </div>

        {/* Key figures */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat k="Disbursement date" v={fmtDate(loan.loanDate)} icon={<CalendarDays size={14} />} />
          {emi
            ? <Stat k="Total payable" v={inr(loan.principal + loan.interest)} icon={<Wallet size={14} />} />
            : interestOnly
              ? <Stat k="Principal (fixed)" v={inr(loan.principal)} icon={<Wallet size={14} />} />
              : <Stat k="Deduction (upfront)" v={inr(deduction)} tone="danger" icon={<ArrowDownToLine size={14} />} />}
          <Stat k={emi || interestOnly ? 'Disbursed' : 'Net disbursed'} v={inr(netDisbursed)} tone="success" icon={<ArrowDownToLine size={14} />} />
          <Stat k="Interest" v={inr(loan.interest)} icon={<Percent size={14} />} />
        </div>

        {/* Schedule table */}
        {schedule.length === 0 ? (
          <p className="rounded-xl border-[0.5px] border-slate-200/70 bg-slate-50/50 p-8 text-center text-sm text-muted dark:border-white/[.06] dark:bg-white/[.02]">
            No instalment schedule for this loan type.
          </p>
        ) : (
          <div className="max-h-[44vh] overflow-auto rounded-xl border-[0.5px] border-slate-200/70 dark:border-white/[.06]">
            <table className="w-full min-w-[720px] border-collapse text-[12px] tabular-nums">
              <thead>
                <tr className="text-left [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-gradient-to-r [&>th]:from-[#022999] [&>th]:via-[#0538cc] [&>th]:to-[#0AA8F8] [&>th]:px-3 [&>th]:py-2.5 [&>th]:text-[11px] [&>th]:font-bold [&>th]:uppercase [&>th]:tracking-wide [&>th]:text-white">
                  <th className="!text-center">Instl</th>
                  <th>Due Date</th>
                  <th className="!text-right">Opening</th>
                  <th className="!text-right">Instalment</th>
                  <th className="!text-right">Principal</th>
                  <th className="!text-right">Interest</th>
                  <th className="!text-right">Closing</th>
                  <th className="!text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((r) => {
                  const paid = r.settled || r.sn <= paidCount;
                  const overdue = !paid && r.dueDate < todayISO();
                  const accent = r.settled || paid ? 'border-l-emerald-500' : overdue ? 'border-l-red-500' : 'border-l-transparent';
                  return (
                    <tr
                      key={r.sn}
                      className={`border-t border-l-[3px] border-slate-100 dark:border-white/[.06] ${accent} ${r.sn % 2 === 0 ? 'bg-slate-50/50 dark:bg-white/[.015]' : ''} transition-colors hover:bg-blue-50/40 dark:hover:bg-blue-500/[.06]`}
                    >
                      <td className="px-3 py-2 text-center text-muted">{r.sn}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-medium">{fmtDate(r.dueDate)}</td>
                      <td className="px-3 py-2 text-right text-ink/70">{inr(r.opening)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{inr(r.instalment)}</td>
                      <td className="px-3 py-2 text-right text-ink/80">{inr(r.principal)}</td>
                      <td className="px-3 py-2 text-right text-muted">{inr(r.interest)}</td>
                      <td className="px-3 py-2 text-right font-bold">{inr(r.closing)}</td>
                      <td className="px-3 py-2 text-center">
                        <StatusPill kind={r.settled ? 'settled' : paid ? 'paid' : overdue ? 'overdue' : 'due'} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold dark:border-white/20 dark:bg-white/[.06] [&>td]:px-3 [&>td]:py-2.5">
                  <td className="text-center uppercase tracking-wide text-muted" colSpan={3}>Total</td>
                  <td className="text-right">{inr(totalInstal)}</td>
                  <td className="text-right">{inr(totalPrincipal)}</td>
                  <td className="text-right text-muted">{inr(totalInterest)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-muted">
          {emi
            ? `Full principal disbursed. Each EMI includes principal + interest; total interest ${inr(loan.interest)} (${loan.rate}% overall) spread evenly across ${loan.numDays ?? schedule.length} months.`
            : interestOnly
              ? `Interest of ${inr(instalment)} falls due each period; principal stays outstanding until settle & close. Schedule shows periods due so far plus the next due.`
              : `Interest of ${inr(loan.interest)} was deducted upfront at disbursement; each instalment repays principal.`}
        </p>
      </div>
    </div>
  );
}

/** Colored status pill with a dot — Paid / Overdue / Due / Foreclosed. */
function StatusPill({ kind }: { kind: 'paid' | 'overdue' | 'due' | 'settled' }) {
  const map = {
    paid: { label: 'Paid', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', dot: 'bg-emerald-500' },
    settled: { label: 'Foreclosed', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300', dot: 'bg-blue-500' },
    overdue: { label: 'Overdue', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300', dot: 'bg-red-500' },
    due: { label: 'Due', cls: 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400', dot: 'bg-slate-400' },
  }[kind];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10.5px] font-bold ${map.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${map.dot}`} />
      {map.label}
    </span>
  );
}

function Stat({ k, v, tone, icon }: { k: string; v: string; tone?: 'success' | 'danger'; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border-[0.5px] border-slate-200/70 bg-white px-3 py-2.5 dark:border-white/[.06] dark:bg-white/[.02]">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
        {icon}<span className="truncate">{k}</span>
      </div>
      <div className={`mt-1 font-display text-[15px] font-bold tabular-nums ${
        tone === 'success' ? 'text-emerald-600 dark:text-emerald-400'
          : tone === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-ink'
      }`}>{v}</div>
    </div>
  );
}
