import { useMemo, useState } from 'react';
import { useData, LOAN_LABELS, isDailyLoan, isInstalmentLoan, isEmiLoan, isInterestOnly, cadenceDaysForLoan, upfrontDeduction, type Loan, type PayMode, type CollectionKind } from '@/mock/DataContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { CollectionProgress } from '@/components/CollectionProgress';
import { StatementView } from '@/components/StatementView';
import { ApiError } from '@/lib/api';
import { buildLedgerReportPDF, shareOrDownloadPDF } from '@/lib/pdfReport';
import { buildSchedule } from '@/lib/loanSchedule';
import { inr, fmtDate, todayISO, initials, isoLocal, addDays, DAILY_TERM } from '@/lib/format';
import { Plus, Pencil, Phone, FileDown, LayoutList, Table2, IndianRupee, Banknote, Smartphone, Landmark, ScrollText, Calendar, CheckCircle2, Wallet } from 'lucide-react';

/** Icon per payment mode for the segmented picker. */
const MODE_ICON: Record<PayMode, typeof Banknote> = {
  CASH: Banknote, UPI: Smartphone, BANK: Landmark, CHEQUE: ScrollText,
};

const MODES: PayMode[] = ['CASH', 'UPI', 'BANK', 'CHEQUE'];

/** Daily-collection ledger: 100 days, daily accrual + carry-forward, editable payments. */
export function LedgerDialog({ loan: loanProp, onClose, statementOnly = false }: { loan: Loan; onClose: () => void; statementOnly?: boolean }) {
  const d = useData();
  const toast = useToast();
  // Always render from the LIVE loan record: payments recorded inside this
  // dialog mutate the loan (auto-close on foreclosure, outstanding, next due),
  // while the prop is only a snapshot from when the dialog was opened. Without
  // this, a foreclosure keeps showing the stale ACTIVE schedule.
  const loan = d.loans.find((l) => l.id === loanProp.id) ?? loanProp;
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [amount, setAmount] = useState(String(loan.dailyAmount ?? ''));
  const [date, setDate] = useState(todayISO());
  const [mode, setMode] = useState<PayMode>('CASH');
  const [kind, setKind] = useState<CollectionKind>('INTEREST');
  const [remarks, setRemarks] = useState('');
  // Settlement mode (foreclose / settle principal): a lump-sum payoff, not a
  // scheduled slot — exempt from the "next due slot" date discipline below.
  const [isSettlement, setIsSettlement] = useState(false);
  // Flexible full-settlement: the popup amount is the whole outstanding, split
  // into interest + principal on save (see addColl).
  const [flexSettle, setFlexSettle] = useState(false);
  // 'ledger' = operational collection tracking; 'statement' = bank-style schedule.
  // statementOnly (Loans page) opens straight to the statement and hides the toggle;
  // the operational ledger lives on the Collections page.
  const [tab, setTab] = useState<'ledger' | 'statement'>(statementOnly ? 'statement' : 'ledger');

  const instalment = loan.dailyAmount ?? 0;   // per-day (Daily Collection) or per-month (EMI) instalment
  const daily = instalment;                   // alias kept for the row rendering below
  const totalTerm = loan.numDays ?? DAILY_TERM; // number of instalments
  const cust = d.customers.find((c) => c.id === loan.customerId);
  const emiLoan = isEmiLoan(loan.type);        // Vehicle / Property — monthly EMI
  const isMonthly = emiLoan;                    // 30-day cadence rows
  const interestOnly = isInterestOnly(loan.type); // Daily/Monthly Interest — no principal schedule
  const hasSchedule = isInstalmentLoan(loan.type) || emiLoan; // fixed instalment schedule
  // "Simple" = no fixed schedule: Flexible + interest-only → payment-history view.
  const isSimple = !hasSchedule;
  const progressTotal = isSimple ? (loan.numDays ?? 30) : totalTerm;

  // Unified slot schedule — ONE table for EVERY loan type:
  //  • Daily Collection: daily slots over the fixed term (instalments repay principal)
  //  • Vehicle/Property (EMI): 30-day slots over the tenure
  //  • Daily/Monthly Interest: open-ended interest periods (daily / 30-day)
  //  • Flexible: a single cycle-end slot for principal + interest
  //
  // Payments are allocated to slots SEQUENTIALLY by amount (FIFO): money
  // received late clears the OLDEST unpaid slot; advance payments roll forward.
  // Interest-only loans allocate only INTEREST-kind payments (a principal
  // settlement never marks an interest period paid).
  //
  // Rows shown: every ELAPSED slot, plus the next actionable slot (marked
  // isNext — it carries the "Add collection" action). Slot N falls on
  // loanDate + N·step (collection starts the day after disbursement).
  const stepDays = isMonthly ? 30 : 1;
  // Cadence per row: Daily Interest = 1, Flexible = its numDays, Monthly Interest
  // = 30; instalment loans use their own step. Interest-accruing loans are
  // open-ended (infinite cap); each period's due is the per-period amount.
  const slotStep = interestOnly ? cadenceDaysForLoan(loan) : stepDays;
  const slotDue = instalment;
  const slotCap = interestOnly ? Number.POSITIVE_INFINITY : totalTerm;
  type Row = {
    sn: number; date: string; due: number; collected: number; remaining: number;
    status: 'Paid' | 'Partial' | 'Overdue' | 'Next due' | 'Settled'; isNext?: boolean;
    mode?: PayMode; receipt?: string; remarks?: string; id?: number; kind?: CollectionKind;
    payAmount?: number; // the actual payment record on this date (for editing)
  };
  const rows = useMemo<Row[]>(() => {
    if (slotDue <= 0) return [];
    const [ly, lm, ld] = loan.loanDate.split('-').map(Number);
    const [ty, tm, td] = todayISO().split('-').map(Number);
    const start = new Date(ly, lm - 1, ld);          // local midnight on loan date — no UTC shift
    const todayD = new Date(ty, tm - 1, td);
    const daysSince = Math.max(0, Math.round((todayD.getTime() - start.getTime()) / 86400000));
    // Flexible charges its first cycle on the loan date (day 0), so it's one
    // cycle ahead of the other cadences; its slot k is due at loanDate + (k−1)·step.
    const flexSameDay = loan.type === 'FLEXIBLE';
    const elapsed = Math.min(Math.floor(daysSince / slotStep) + (flexSameDay ? 1 : 0), slotCap); // slots due by today
    const loanColls = d.collections.filter((c) => c.loanId === loan.id);
    const pool = interestOnly
      ? loanColls.filter((c) => c.kind !== 'PRINCIPAL').reduce((s, c) => s + c.amount, 0)
      : loanColls.reduce((s, c) => s + c.amount, 0);
    const paidSlots = Math.floor(pool / slotDue);
    // Append the upcoming actionable slot when every elapsed slot is funded
    // (fresh loan → slot 1; paid ahead → the first genuinely unpaid slot).
    const nextSlot = loan.status === 'ACTIVE' && paidSlots >= elapsed && elapsed < slotCap
      ? Math.min(paidSlots + 1, slotCap) : 0;
    // Foreclosure collapse (CLOSED loans, Bajaj-style): regular rows only up to
    // the last slot fully funded BEFORE the settlement payment, then one
    // "Settled" row carrying the exact payoff (remaining → 0), nothing after.
    // For interest-only loans the settlement is the PRINCIPAL-kind payment and
    // the interest-period rows stay as they are.
    const lastPay = loanColls.length
      ? loanColls.reduce((a, b) => (b.id > a.id ? b : a))
      : undefined;
    const settle = loan.status === 'CLOSED' && lastPay && (!interestOnly || lastPay.kind === 'PRINCIPAL') ? lastPay : undefined;
    // Settlement bundle = every entry recorded ON the settlement date (the
    // "Settle & close" action records interest + principal together). Its total
    // is the outstanding cleared at settlement; the interest portion must NOT
    // count toward the regular cycle rows (otherwise an overdue cycle would show
    // "Paid" with a blank mode — the money actually came from the settlement).
    const settleBundle = settle ? loanColls.filter((c) => c.date === settle.date && c.remarks && /settlement/i.test(c.remarks)) : [];
    const settleTotal = settleBundle.reduce((s, c) => s + c.amount, 0);
    const settleInterest = settleBundle.filter((c) => c.kind !== 'PRINCIPAL').reduce((s, c) => s + c.amount, 0);
    // Interest funded by REGULAR (pre-settlement) payments only.
    const regularInterestPool = interestOnly ? Math.max(0, pool - settleInterest) : pool;
    const fundedBefore = settle
      ? interestOnly
        ? Math.floor(regularInterestPool / slotDue)
        : Math.max(0, Math.floor((pool - settle.amount) / slotDue))
      : -1;
    // Collapse needs a real settlement bundle for interest-only (so the total is
    // known); EMI collapse keys off the last principal payment as before.
    const collapse = !!settle && fundedBefore < slotCap && (!interestOnly || settleTotal > 0);
    // Slots to render. On a CLOSED loan without collapse, funded-but-not-yet-
    // elapsed slots stay visible (interest paid in advance still happened).
    const funded = Number.isFinite(slotCap) ? Math.min(paidSlots, slotCap) : paidSlots;
    const count = collapse
      ? fundedBefore
      : nextSlot > 0
        ? nextSlot
        : loan.status === 'CLOSED'
          ? Math.max(elapsed, funded)
          : elapsed;
    // For interest-only collapse, cap the FIFO pool used by cycle rows to the
    // regular (non-settlement) interest, so pre-settlement rows allocate correctly.
    const rowPool = interestOnly && collapse ? regularInterestPool : pool;
    const out: Row[] = [];
    for (let k = 1; k <= count; k++) {
      // Paid-ahead slots between the elapsed range and the actionable one are
      // SHOWN (as Paid rows) — their payment records stay visible and editable,
      // and the ledger reads continuously: ... Paid, Paid, → Next due.
      // Slot k's due date: loanDate + k·step normally; Flexible shifts one cycle
      // earlier so cycle 1 lands on the loan date itself.
      const dueOffsetDays = flexSameDay ? (k - 1) * slotStep : k * slotStep;
      const dueDate = isoLocal(new Date(ly, lm - 1, ld + dueOffsetDays));
      const alloc = Math.max(0, Math.min(rowPool - (k - 1) * slotDue, slotDue));
      const payableBase = loan.principal;
      const remaining = interestOnly ? 0 : Math.max(0, payableBase - Math.min(rowPool, k * slotDue));
      // A payment recorded on this exact date (or within the cycle window)
      // keeps its edit/delete affordance + mode/receipt on this row.
      const ws = isoLocal(new Date(ly, lm - 1, ld + dueOffsetDays - slotStep + 1));
      const winColls = slotStep === 1
        ? loanColls.filter((c) => c.date === dueDate)
        : loanColls.filter((c) => c.date >= ws && c.date <= dueDate);
      const first = winColls[0];
      const status: Row['status'] =
        alloc >= slotDue ? 'Paid' : alloc > 0 ? 'Partial' : dueDate < todayISO() ? 'Overdue' : 'Next due';
      out.push({
        sn: k, date: dueDate, due: slotDue, collected: alloc, remaining, status,
        mode: first?.mode, receipt: first?.receiptNo, remarks: first?.remarks, id: first?.id, kind: first?.kind,
        payAmount: first ? winColls.reduce((s, c) => s + c.amount, 0) : undefined,
      });
    }
    // The settlement/foreclosure row: ONE row for everything cleared at
    // settlement (overdue interest + principal), on its actual date, closing 0.
    if (settle && collapse) {
      const amount = interestOnly ? settleTotal : Math.max(0, pool - fundedBefore * slotDue);
      out.push({
        sn: out.length + 1, date: settle.date, due: amount, collected: amount, remaining: 0,
        status: 'Settled', mode: settle.mode, receipt: settle.receiptNo,
        remarks: 'Full settlement', id: settle.id, kind: settle.kind, payAmount: amount,
      });
    }
    // Exactly one actionable row: the first not fully funded (FIFO order).
    if (loan.status === 'ACTIVE') {
      const nx = out.find((r) => r.status !== 'Paid');
      if (nx) nx.isNext = true;
    }
    return out;
  }, [loan, d.collections, slotDue, slotStep, slotCap, interestOnly]);

  const collected = d.collectedFor(loan.id);
  const todayStr = todayISO();
  const pending = Math.max(0, loan.principal - collected);
  const deduction = loan.deduction ?? upfrontDeduction(loan.type, loan.interest);
  // Prefer the server-stored disbursed amount; fall back to the computation for mock loans.
  const netDisbursed = loan.disbursed ?? Math.max(0, loan.principal - deduction);
  // Progress = scheduled instalments fully paid so far (not raw payment count),
  // so a same-day/advance payment doesn't inflate the day counter. A CLOSED
  // loan is settled in full (foreclosure clears the balance) → complete bar.
  // Simple loans (no schedule) fall back to the payment count.
  const paidDays = loan.status === 'CLOSED'
    ? progressTotal
    : isSimple
      ? Math.min(d.collections.filter((c) => c.loanId === loan.id).length, progressTotal)
      : Math.min(rows.filter((r) => r.status === 'Paid').length, progressTotal);
  const outstanding = d.outstandingFor(loan); // for Monthly Interest this already includes the shortfall (Principal + Total Due)
  // Elapsed-only figures — rows may include ONE appended upcoming slot (isNext
  // with a future date), which must not count toward what's owed by today.
  const elapsedSteps = rows.filter((r) => r.date <= todayStr).length; // slots due by today
  const totalDue = Math.max(0, elapsedSteps * instalment - collected); // shortfall vs what should've been collected by today
  const dueDays = rows.filter((r) => r.date <= todayStr && r.status !== 'Paid').length; // elapsed slots not yet fully paid

  const defaultAmount = () => String(loan.dailyAmount ?? '');
  // Inline amount validation for the popup's hero field (mirrors addColl's guard).
  const amountError = amount !== '' && !(Number(amount) > 0) ? 'Enter an amount greater than 0' : '';
  // Principal still owed on an interest-only loan (for the settle-principal prefill).
  const remainingPrincipal = Math.max(0, loan.principal - d.principalCollectedFor(loan.id));
  // A payment may be recorded any day from the loan date onward (never before
  // disbursement). Mirrors the backend's relaxed floor. The SCHEDULE still
  // starts the day after disbursement — that lives in nextDueFor/accrual.
  const minPaymentDate = loan.loanDate;
  // Foreclosure/settlement happens on the day it's paid — today (clamped so it's
  // never before the loan date, for a loan created today).
  const settlementDate = () => (todayISO() < minPaymentDate ? minPaymentDate : todayISO());
  // Live next-due SLOT date (same amount-based figure the Statement shows —
  // see DataContext.nextDueFor). The table's actionable row and the date
  // guards both key off it; adds are opened FROM that row with its slot date.
  const nextDue = d.nextDueFor(loan);
  // Latest recordable date: the next due slot, or today+1 (clock-skew slack),
  // whichever is later — mirrors the server rule exactly.
  const maxPaymentDate = (() => {
    const cap = addDays(todayISO(), 1);
    return nextDue && nextDue > cap ? nextDue : cap;
  })();
  // How many fully-funded instalments so far, and which one this entry pays.
  const paidInstalments = instalment > 0 ? Math.min(Math.floor(collected / instalment), totalTerm) : 0;
  /** Interest-only settlement (Daily/Monthly Interest + Flexible): the borrower
   *  clears the FULL outstanding at once —
   *  accrued interest AND principal. Opens the collection popup pre-filled with
   *  the outstanding; on Save it's recorded as two entries (interest → INTEREST,
   *  principal → PRINCIPAL) so income accounting stays clean, then auto-closes. */
  const flexInterestDue = d.totalDueForInterestOnly(loan);      // accrued, unpaid interest
  const flexOutstanding = remainingPrincipal + flexInterestDue; // = outstanding
  const openFlexSettle = () => {
    setEditId(null); setIsSettlement(true); setFlexSettle(true);
    setAmount(String(flexOutstanding)); setDate(settlementDate()); setMode('CASH');
    setKind('PRINCIPAL'); setRemarks('Full settlement'); setAddOpen(true);
  };
  /** Foreclosure (non-interest-only): prefill the full outstanding as one payment;
   *  recording it drives outstanding to 0 and the loan auto-closes. Same-day. */
  const openForeclose = () => { setEditId(null); setIsSettlement(true); setFlexSettle(false); setAmount(String(outstanding)); setDate(settlementDate()); setMode('CASH'); setKind('INTEREST'); setRemarks('Foreclosure — full settlement'); setAddOpen(true); };
  const openEdit = (c: { id: number; amount: number; date: string; mode: PayMode; kind?: CollectionKind; remarks?: string }) => {
    setEditId(c.id); setIsSettlement(false); setFlexSettle(false); setAmount(String(c.amount)); setDate(c.date); setMode(c.mode); setKind(c.kind ?? 'INTEREST'); setRemarks(c.remarks ?? ''); setAddOpen(true);
  };
  const openRow = (r: { id?: number; date: string; collected: number; payAmount?: number; mode?: PayMode; kind?: CollectionKind; remarks?: string }) => {
    // Edit the actual payment record on this date (payAmount), not the FIFO
    // allocation shown in the row's Amount column.
    if (r.id) openEdit({ id: r.id, amount: r.payAmount ?? r.collected, date: r.date, mode: r.mode ?? 'CASH', kind: r.kind, remarks: r.remarks });
    else { setEditId(null); setIsSettlement(false); setFlexSettle(false); setAmount(defaultAmount()); setDate(r.date); setMode('CASH'); setKind('INTEREST'); setRemarks(''); setAddOpen(true); }
  };
  const addColl = async () => {
    if (!Number(amount)) { toast('Enter an amount', 'error'); return; }
    if (date < minPaymentDate) { toast(`Payment date cannot be before the loan date (${fmtDate(minPaymentDate)})`, 'error'); return; }
    if (date > maxPaymentDate) { toast(`Payment date cannot be beyond the next due (${fmtDate(maxPaymentDate)})`, 'error'); return; }
    // Daily loans collect one slot per day: a day that is already fully funded
    // cannot be paid again — the picker advances to the next unpaid slot. A
    // settlement/foreclosure is a lump-sum payoff and is exempt; a payment on
    // kind=PRINCIPAL (settling principal) likewise isn't a scheduled slot.
    const dailyCadence = loan.type === 'DAILY_COLLECTION' || loan.type === 'DAILY_INTEREST';
    if (!editId && !isSettlement && kind !== 'PRINCIPAL' && dailyCadence && nextDue && date < nextDue) {
      toast(`Already collected for ${fmtDate(date)} — next due is ${fmtDate(nextDue)}`, 'error');
      return;
    }
    // kind only matters for interest-only loans; always send INTEREST otherwise.
    const k: CollectionKind = interestOnly ? kind : 'INTEREST';
    try {
      if (flexSettle && !editId) {
        // Flexible full settlement: split the entered amount into the accrued
        // interest first (INTEREST → income), remainder to principal (PRINCIPAL →
        // settles). Recorded sequentially so both land; loan then auto-closes.
        const total = Number(amount);
        const interestPart = Math.min(total, flexInterestDue);
        const principalPart = total - interestPart;
        if (interestPart > 0) {
          await d.addCollection({ loanId: loan.id, date, amount: interestPart, mode, kind: 'INTEREST', remarks: (remarks || 'Full settlement') + ' — interest' });
        }
        if (principalPart > 0) {
          await d.addCollection({ loanId: loan.id, date, amount: principalPart, mode, kind: 'PRINCIPAL', remarks: (remarks || 'Full settlement') + ' — principal' });
        }
        toast('Loan settled — interest + principal cleared');
      } else if (editId) {
        await d.updateCollection(editId, { amount: Number(amount), date, mode, kind: k, remarks: remarks || undefined });
        toast('Collection updated');
      } else {
        await d.addCollection({ loanId: loan.id, date, amount: Number(amount), mode, kind: k, remarks: remarks || undefined });
        toast(k === 'PRINCIPAL' ? 'Principal settlement recorded' : 'Collection recorded');
      }
    } catch (e) {
      // Surface the real reason (e.g. date/amount validation) instead of a false success.
      toast(e instanceof ApiError ? e.message : 'Failed to save collection', 'error');
      return; // keep the form open so the user can correct it
    }
    setAddOpen(false); setEditId(null); setFlexSettle(false); setAmount(defaultAmount()); setRemarks('');
  };

  // Per-period interest label, cadence-aware: Daily / Monthly / Every N days.
  const interestPeriodLabel = loan.type === 'DAILY_INTEREST' ? 'Daily Interest'
    : loan.type === 'MONTHLY_INTEREST' ? 'Monthly Interest'
    : `Interest / ${cadenceDaysForLoan(loan)} days`; // Flexible
  const summaryCards = interestOnly ? [
    { k: 'Principal', v: inr(loan.principal), sub: 'Payable at settlement' },
    { k: interestPeriodLabel, v: inr(instalment), sub: 'Per cycle' },
    // Interest bucket ONLY — a principal settlement must not inflate this figure.
    { k: 'Interest Collected', v: inr(d.interestCollectedFor(loan.id)), sub: undefined as string | undefined },
    { k: 'Interest Due', v: inr(d.totalDueForInterestOnly(loan)), sub: 'Accrued, unpaid', danger: true },
    { k: 'Outstanding', v: inr(outstanding), sub: 'Principal + interest', hi: true },
  ] : emiLoan ? [
    { k: 'Principal', v: inr(loan.principal), sub: 'Disbursed in full' },
    { k: 'Interest', v: inr(loan.interest), sub: `${loan.rate}% overall` },
    { k: 'EMI / month', v: inr(instalment), sub: `${totalTerm} months` },
    { k: 'Total Payable', v: inr(loan.principal + loan.interest), sub: 'Principal + interest' },
    { k: 'Collected', v: inr(collected), sub: 'Paid so far' },
    { k: 'Outstanding', v: inr(outstanding), sub: 'Payable − collected', hi: true },
  ] : isSimple ? [
    { k: 'Principal', v: inr(loan.principal), sub: 'Loan amount' },
    { k: 'Interest', v: inr(loan.interest), sub: `${loan.rate}% overall` },
    { k: 'Collected', v: inr(collected), sub: 'Paid so far' },
    { k: 'Outstanding', v: inr(outstanding), sub: 'Still owed', hi: true },
  ] : [
    { k: 'Principal', v: inr(loan.principal), sub: 'Loan amount' },
    { k: 'Total Due', v: inr(totalDue), sub: totalDue > 0 ? 'Overdue shortfall' : 'Up to date' },
    { k: 'Deduction', v: inr(deduction), sub: 'Retained upfront' },
    { k: 'Net Disbursed', v: inr(netDisbursed), sub: 'To customer' },
    { k: 'Collected', v: inr(collected), sub: 'Paid so far' },
    { k: 'Pending', v: inr(pending), sub: 'Principal − collected', hi: true },
  ];

  const generateReport = async () => {
    let tableTitle = '', tableHead: string[] = [], tableBody: (string | number)[][] = [];
    const unit = isMonthly ? 'Month' : 'Day';
    if (!isSimple) {
      tableTitle = `${unit}-by-${unit} Ledger`;
      tableHead = [unit, 'Collection Date', `${isMonthly ? 'Monthly' : 'Daily'} Due`, 'Amount', 'Principal Remaining', 'Payment Mode', 'Status', 'Remarks'];
      // Elapsed slots only — the appended upcoming (isNext) row stays out of the report.
      tableBody = rows.filter((r) => r.date <= todayISO()).map((r) => [r.sn, fmtDate(r.date), inr(r.due), r.collected ? inr(r.collected) : '—', inr(r.remaining), r.mode ?? '—', r.status, r.remarks ?? '—']);
    } else {
      tableTitle = 'Recorded Payments';
      tableHead = ['Date', 'Amount', 'Mode'];
      tableBody = d.collections.filter((c) => c.loanId === loan.id).sort((a, b) => (a.date < b.date ? 1 : -1)).map((c) => [fmtDate(c.date), inr(c.amount), c.mode]);
    }
    // Statement tab → bank-style Payment Schedule PDF over the flat model.
    // A foreclosed loan collapses to its settlement row (Bajaj-style).
    if (tab === 'statement' && isInstalmentLoan(loan.type)) {
      const loanColls = d.collections.filter((c) => c.loanId === loan.id);
      const lastPay = loanColls.length
        ? loanColls.reduce((a, b) => (b.id > a.id ? b : a))
        : null;
      const sched = buildSchedule(loan, { collected, settlement: lastPay ? { amount: lastPay.amount, date: lastPay.date } : null });
      const paidCount = instalment > 0 ? Math.floor(collected / instalment) : 0;
      const doc = buildLedgerReportPDF({
        loanNumber: loan.loanNumber,
        loanTypeLabel: `${LOAN_LABELS[loan.type]} · Payment Schedule`,
        customerName: cust?.name ?? '—',
        customerMobile: loan.contact || cust?.mobile || '—',
        loanDate: fmtDate(loan.loanDate),
        summary: [
          { label: 'Loan Amount', value: inr(loan.principal) },
          { label: 'Interest (upfront)', value: inr(loan.interest) },
          { label: 'Net Disbursed', value: inr(netDisbursed) },
          { label: 'Instalment', value: inr(instalment) },
          { label: 'Tenure', value: `${totalTerm} ${isMonthly ? 'months' : 'days'}` },
          { label: 'Rate', value: `${loan.rate}%` },
        ],
        progress: { label: 'Instalments paid', paid: paidCount, total: totalTerm },
        tableTitle: 'Payment Schedule',
        tableHead: ['Instl', 'Due Date', 'Opening', 'Instalment', 'Principal', 'Interest', 'Closing', 'Status'],
        tableBody: sched.map((r) => [
          r.sn, fmtDate(r.dueDate), inr(r.opening), inr(r.instalment), inr(r.principal), inr(r.interest), inr(r.closing),
          r.settled ? 'Foreclosed' : r.sn <= paidCount ? 'Paid' : 'Due',
        ]),
      });
      const result = await shareOrDownloadPDF(doc, `Statement-${loan.loanNumber}-${todayISO()}.pdf`);
      toast(result === 'shared' ? 'Statement shared' : 'Statement downloaded');
      return;
    }

    const progress = { label: 'Collection Progress', paid: paidDays, total: progressTotal };
    const doc = buildLedgerReportPDF({
      loanNumber: loan.loanNumber,
      loanTypeLabel: LOAN_LABELS[loan.type],
      customerName: cust?.name ?? '—',
      customerMobile: loan.contact || cust?.mobile || '—',
      loanDate: fmtDate(loan.loanDate),
      summary: summaryCards.map((c) => ({ label: c.k, value: c.v })),
      progress, tableTitle, tableHead, tableBody,
    });
    const filename = `Ledger-${loan.loanNumber}-${todayISO()}.pdf`;
    const result = await shareOrDownloadPDF(doc, filename);
    toast(result === 'shared' ? 'Report shared' : 'Report downloaded');
  };

  return (
    <Dialog open onClose={onClose} title={`${statementOnly && !isSimple ? 'Loan Statement' : 'Collection Ledger'} · ${loan.loanNumber}`} subtitle={isSimple ? `${LOAN_LABELS[loan.type]} · Payment history` : `${LOAN_LABELS[loan.type]} · ${totalTerm} ${isMonthly ? 'months' : 'days'}`} wide
      footer={<><Button variant="ghost" onClick={generateReport} title="Download or share a PDF"><FileDown size={15} /> {tab === 'statement' ? 'Generate Statement' : 'Generate Report'}</Button><Button onClick={onClose}>Close</Button></>}>
      {/* Customer information */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-blue-400 to-primary text-sm font-bold text-white">{initials(cust?.name ?? '—')}</div>
          <div>
            <div className="font-display text-base font-bold">{cust?.name ?? '—'}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted"><Phone size={12} /> {loan.contact || cust?.mobile || '—'}</div>
          </div>
        </div>
        <div className="text-xs text-muted">Loan date: <span className="font-semibold text-slate-600 dark:text-slate-300">{fmtDate(loan.loanDate)}</span></div>
      </div>

      {/* View toggle: operational ledger vs bank-style statement (instalment loans only).
          Hidden when statementOnly (Loans page) — the ledger lives on Collections. */}
      {!isSimple && !statementOnly && (
        <div className="mb-4 inline-flex rounded-lg border-[0.5px] border-slate-200/70 bg-slate-100/70 p-1 dark:border-white/[.06] dark:bg-white/[.04]">
          <button
            onClick={() => setTab('ledger')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors ${tab === 'ledger' ? 'bg-blue-500 text-white shadow-sm' : 'text-muted hover:text-ink'}`}
          >
            <LayoutList size={14} /> Ledger
          </button>
          <button
            onClick={() => setTab('statement')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors ${tab === 'statement' ? 'bg-blue-500 text-white shadow-sm' : 'text-muted hover:text-ink'}`}
          >
            <Table2 size={14} /> Statement
          </button>
        </div>
      )}

      {/* ── Statement (bank-style schedule) ── */}
      {!isSimple && tab === 'statement' && <StatementView loan={loan} />}

      {/* ── Operational ledger ── */}
      {(isSimple || tab === 'ledger') && (
      <>
      {/* Summary cards — fixed 3-slot layout (label / value / caption) so every
          card is the same height and the values line up across the row. */}
      <div className={`mb-4 grid grid-cols-2 gap-2.5 ${interestOnly ? 'sm:grid-cols-3 lg:grid-cols-5' : isSimple ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3 lg:grid-cols-6'}`}>
        {summaryCards.map((c) => (
          <div
            key={c.k}
            title={c.sub}
            className={`flex flex-col rounded-xl border-[0.5px] px-3.5 py-3 transition-shadow hover:shadow-[0_2px_10px_rgba(30,39,64,.07)] ${
              c.hi
                ? 'border-warning/40 bg-warning-50/70 dark:border-warning/30 dark:bg-warning/[.08]'
                : 'border-slate-200/80 bg-white dark:border-white/[.07] dark:bg-white/[.02]'
            }`}
          >
            {/* Fixed slots: label (2-line reserve, top) · value (bottom-aligned) ·
                caption (single line). Every card the same height; values line up. */}
            <div className="flex min-h-[28px] items-start text-[10px] font-bold uppercase leading-[1.3] tracking-[0.04em] text-muted">{c.k}</div>
            <div className={`mt-auto font-display text-[18px] font-bold leading-none tabular-nums ${c.danger ? 'text-danger' : c.hi ? 'text-warning-600 dark:text-warning' : 'text-ink'}`}>{c.v}</div>
            <div className="mt-1.5 h-[13px] truncate text-[10px] leading-none text-muted">{c.sub ?? ''}</div>
          </div>
        ))}
      </div>

      {/* Collection progress — not shown for interest-only (open-ended, no fixed schedule) */}
      {!interestOnly && (
      <div className="mb-5 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">Collection Progress</div>
        <CollectionProgress paid={paidDays} total={progressTotal} showRemaining unit={isMonthly ? 'Months' : 'Days'} />
      </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-muted">
          {interestOnly
            ? `Interest payments since ${fmtDate(loan.loanDate)} · ${loan.type === 'DAILY_INTEREST' ? 'daily' : loan.type === 'MONTHLY_INTEREST' ? 'monthly' : `every ${cadenceDaysForLoan(loan)} days`} · principal stays until settled`
            : isSimple
              ? `Payment history for this loan · ${progressTotal}-day cycle`
              : `${isMonthly ? 'Monthly' : 'Daily'} ledger from ${fmtDate(loan.loanDate)} · ${totalTerm} ${isMonthly ? 'months' : 'days'} · instalments repay the principal`}
        </div>
        {!statementOnly && (
          <div className="flex items-center gap-2">
            {/* Interest-only (Daily/Monthly Interest + Flexible): settle the FULL
                outstanding (accrued interest + principal) in one shot → auto-close. */}
            {interestOnly && flexOutstanding > 0 && (
              <Button onClick={openFlexSettle} className="!bg-emerald-600 !px-3 !py-1.5 text-xs transition-transform hover:scale-105" title={`Collect the full outstanding (${inr(flexOutstanding)}) — interest + principal — and close the loan`}>
                Settle & close · {inr(flexOutstanding)}
              </Button>
            )}
            {!interestOnly && outstanding > 0 && (
              <Button onClick={openForeclose} className="!bg-emerald-600 !px-3 !py-1.5 text-xs transition-transform hover:scale-105" title="Record the full outstanding and close the loan">
                Foreclose
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Unified slot ledger — one table for EVERY loan type. The actionable
          (isNext) row carries the Add-collection button; rows with a payment
          record carry edit + delete. Statuses: Paid / Partial / Overdue / Next due. */}
      <div className="max-h-96 overflow-auto rounded-xl border border-slate-100 dark:border-white/[.06]">
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-slate-100 [&>th]:px-3 [&>th]:py-2.5 [&>th]:shadow-[0_1px_0_rgba(15,23,42,0.08)] dark:[&>th]:bg-slate-800">
            <th>{loan.type === 'FLEXIBLE' ? 'Cycle' : isMonthly || loan.type === 'MONTHLY_INTEREST' ? 'Month' : 'Day'}</th>
            <th>Collection Date</th>
            <th>{interestOnly ? 'Interest Due' : loan.type === 'FLEXIBLE' ? 'Amount Due' : `${isMonthly ? 'Monthly' : 'Daily'} Due`}</th>
            <th>Amount</th>
            {!interestOnly && <th>{loan.type === 'FLEXIBLE' ? 'Balance' : 'Principal Remaining'}</th>}
            <th>Payment Mode</th><th>Status</th><th className="text-right">Action</th><th>Remarks</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const border = r.status === 'Paid' || r.status === 'Settled' ? 'border-l-success' : r.status === 'Partial' ? 'border-l-warning' : r.status === 'Overdue' ? 'border-l-danger' : 'border-l-primary';
              return (
                <tr key={r.sn} className={`border-t border-l-4 border-slate-100 dark:border-white/[.06] ${border} ${r.isNext ? 'bg-primary-50/40 dark:bg-primary/[.06]' : ''}`}>
                  <td className="px-3 py-2 text-muted">{r.sn}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.date)}{r.date === todayStr && <span className="ml-1 text-[10px] font-bold text-primary">• today</span>}</td>
                  <td className="px-3 py-2">{inr(r.due)}</td>
                  <td className="px-3 py-2">{r.collected ? inr(r.collected) : '—'}</td>
                  {!interestOnly && <td className="px-3 py-2 font-medium">{inr(r.remaining)}</td>}
                  <td className="px-3 py-2">{r.mode ? <Badge tone="neutral">{r.mode}</Badge> : <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><Badge tone={r.status === 'Paid' || r.status === 'Settled' ? 'ok' : r.status === 'Partial' ? 'warn' : r.status === 'Overdue' ? 'err' : 'info'}><span className="whitespace-nowrap">{r.status}</span></Badge></td>
                  <td className="px-3 py-2 text-right">
                    {statementOnly ? <span className="text-muted">—</span> : (
                      <div className="flex items-center justify-end gap-1">
                        {r.isNext && loan.status === 'ACTIVE' && (
                          <Button variant="success" onClick={() => openRow({ date: r.date, collected: 0 })}
                            className="!px-2 !py-0.5 !text-[11px] whitespace-nowrap" title="Record this collection">
                            <Plus size={11} /> Add
                          </Button>
                        )}
                        {r.id ? (
                          <button onClick={() => openRow(r)} title="Edit this payment" aria-label="Edit payment"
                            className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-primary-50 hover:text-primary"><Pencil size={14} /></button>
                        ) : !r.isNext ? (
                          <button onClick={() => openRow(r)} title="Record payment for this slot" aria-label="Record payment"
                            className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-primary-50 hover:text-primary"><Pencil size={14} /></button>
                        ) : null}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted">{r.remarks ?? '—'}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={interestOnly ? 8 : 9} className="px-3 py-6 text-center text-muted">No schedule to show yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      </>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title={editId ? 'Edit collection' : isSettlement ? 'Settle & close' : 'Add collection'} subtitle={cust?.name ? `${cust.name} · ${loan.loanNumber}` : loan.loanNumber}
        footer={<><Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant={isSettlement ? 'success' : 'primary'} onClick={addColl}>
            {editId ? 'Save changes' : isSettlement ? <><CheckCircle2 size={15} /> Settle &amp; close</> : <><Plus size={15} /> Record payment</>}
          </Button></>}>
        <div className="space-y-4">
          {/* Context banner */}
          {isSettlement ? (
            <div className="flex items-start gap-2.5 rounded-xl border-[0.5px] border-emerald-200 bg-emerald-50 px-3.5 py-3 dark:border-emerald-500/25 dark:bg-emerald-500/10">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div className="text-[12px] leading-snug text-emerald-800 dark:text-emerald-300">
                <span className="font-bold">Full settlement.</span> The entire outstanding{interestOnly ? ' (principal + accrued interest)' : ''} is collected and the loan is closed.
              </div>
            </div>
          ) : editId ? null : interestOnly ? (
            <div className="flex items-start gap-2.5 rounded-xl border-[0.5px] border-slate-200/70 bg-slate-50 px-3.5 py-3 dark:border-white/[.06] dark:bg-white/[.03]">
              <Wallet size={16} className="mt-0.5 shrink-0 text-muted" />
              <div className="text-[12px] leading-snug text-muted">
                <span className="font-bold text-ink">Interest payment.</span> Principal stays outstanding until you use “Settle &amp; close”.
              </div>
            </div>
          ) : !isSimple && paidInstalments < totalTerm && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border-[0.5px] border-blue-200/70 bg-blue-50 px-3.5 py-3 text-[12px] font-medium text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
              <Calendar size={15} className="shrink-0" />
              <span>Applies to {isMonthly ? 'EMI' : 'Day'} <span className="font-bold">{paidInstalments + 1}</span> of {totalTerm}{d.nextDueFor(loan) ? ` · due ${fmtDate(d.nextDueFor(loan)!)}` : ''}</span>
              {dueDays > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">{dueDays} overdue</span>}
            </div>
          )}

          {/* Hero amount */}
          <div>
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">Amount</span>
            <div className={`flex items-center gap-2 rounded-xl border bg-white px-3.5 dark:bg-surface ${
              amountError ? 'border-danger' : 'border-slate-200 focus-within:border-blue-400 dark:border-slate-700 dark:focus-within:border-blue-500'
            }`}>
              <IndianRupee size={18} className="shrink-0 text-muted" />
              <input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0"
                className="w-full bg-transparent py-3 font-display text-2xl font-bold tabular-nums text-ink outline-none placeholder:text-slate-300 dark:placeholder:text-slate-600" />
            </div>
            {amountError && <span className="mt-1 block text-[12px] font-medium text-danger">{amountError}</span>}
          </div>

          {/* Payment mode — segmented picker with icons */}
          <div>
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">Payment mode</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {MODES.map((m) => {
                const Icon = MODE_ICON[m];
                const on = mode === m;
                return (
                  <button key={m} type="button" onClick={() => setMode(m)}
                    className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-[11.5px] font-semibold transition-all ${
                      on
                        ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-[0_0_0_1px_rgba(99,102,241,.4)] dark:border-blue-400 dark:bg-blue-500/15 dark:text-blue-300'
                        : 'border-slate-200 text-muted hover:border-slate-300 hover:text-ink dark:border-white/[.08] dark:hover:border-white/20'
                    }`}>
                    <Icon size={17} /> {m}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date + remarks */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Date" type="date" value={date}
              min={!editId && !isSettlement && (loan.type === 'DAILY_COLLECTION' || loan.type === 'DAILY_INTEREST') && nextDue ? (nextDue > minPaymentDate ? nextDue : minPaymentDate) : minPaymentDate}
              max={maxPaymentDate} onChange={(e) => setDate(e.target.value)}
              error={date && date < minPaymentDate ? `On/after loan date (${fmtDate(minPaymentDate)})` : date && date > maxPaymentDate ? `Not beyond next due (${fmtDate(maxPaymentDate)})` : undefined} />
            <Input label="Remarks" placeholder="Optional note" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>
      </Dialog>
    </Dialog>
  );
}
