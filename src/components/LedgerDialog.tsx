import { useMemo, useState } from 'react';
import { useData, LOAN_LABELS, isDailyLoan, isInstalmentLoan, behavesEmi, behavesInterestOnly, cadenceDaysForLoan, upfrontDeduction, type Loan, type PayMode, type CollectionKind } from '@/mock/DataContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { CollectionProgress } from '@/components/CollectionProgress';
import { StatementView } from '@/components/StatementView';
import { ApiError } from '@/lib/api';
import { usePermissions } from '@/lib/permissions';
// pdfReport (jsPDF) is imported dynamically inside generateReport — see there.
import { buildSchedule } from '@/lib/loanSchedule';
import { inr, fmtDate, todayISO, initials, isoLocal, addDays, addMonths, DAILY_TERM } from '@/lib/format';
import { Plus, Pencil, Phone, FileDown, Share2, LayoutList, Table2, IndianRupee, Banknote, Smartphone, Landmark, ScrollText, Calendar, CheckCircle2, Wallet } from 'lucide-react';

/** Icon per payment mode for the segmented picker. */
const MODE_ICON: Record<PayMode, typeof Banknote> = {
  CASH: Banknote, UPI: Smartphone, BANK: Landmark, CHEQUE: ScrollText,
};

const MODES: PayMode[] = ['CASH', 'UPI', 'BANK', 'CHEQUE'];

/** Daily-collection ledger: 100 days, daily accrual + carry-forward, editable payments. */
export function LedgerDialog({ loan: loanProp, onClose, statementOnly = false }: { loan: Loan; onClose: () => void; statementOnly?: boolean }) {
  const d = useData();
  const toast = useToast();
  // RBAC: every mutation in this dialog is a Collections write. View-only users
  // get the full read-only ledger — no Add / edit / Clear Overdue / Foreclose.
  // The backend rejects unauthorized writes regardless; this keeps the UI honest.
  const { canEdit: canEditModule } = usePermissions();
  const canCollect = !statementOnly && canEditModule('Collections');
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
  // When editing a PARTIAL slot, remember the day's scheduled due + amount
  // already paid, so the dialog can show "paid so far" and "still pending".
  const [editSlot, setEditSlot] = useState<{ due: number; paid: number } | null>(null);
  // The schedule slot the collector clicked Add on — stored on the record as
  // targetDate so the ledger funds THAT row first (receipt stays dated today).
  const [payTarget, setPayTarget] = useState<string | null>(null);
  // Day-edit mode: the clicked slot is funded by SEVERAL receipts, so the form
  // edits the DAY's total. Lowering it trims the newest receipts first (each
  // keeps its own receipt date); raising it records the difference as a new
  // receipt dated today.
  const [editDay, setEditDay] = useState<{ target: string; due: number; records: { id: number; amount: number; date: string; mode: PayMode; kind?: CollectionKind; remarks?: string }[] } | null>(null);
  // Clear-overdue mode: one bulk receipt prefilled with everything due till
  // today (FIFO spreads it across the overdue slots). Display-only flag.
  const [clearDues, setClearDues] = useState(false);
  // In-flight flag for the payment round-trip (see addColl's double-submit guard).
  const [saving, setSaving] = useState(false);
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
  // Behaviour, not category: a Vehicle/Property loan in Monthly-interest mode
  // renders exactly like Monthly Interest (interest-only, open-ended), while a
  // Tenure-mode one keeps the EMI schedule.
  const emiLoan = behavesEmi(loan);            // Vehicle / Property (Tenure) — monthly EMI
  const isMonthly = emiLoan;                    // 30-day cadence rows
  const hasMonthlyCadence = isMonthly || loan.type === 'MONTHLY_INTEREST';
  const interestOnly = behavesInterestOnly(loan); // Daily/Monthly Interest, Flexible, monthly-mode Vehicle/Property
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
  // Slot k's due date — shared by the ledger allocation AND the save path
  // (which may pin advance money to future slots). Flexible shifts one cycle
  // earlier so cycle 1 lands on the loan date itself.
  const slotDueDateFor = (k: number): string => {
    const [ly, lm, ld] = loan.loanDate.split('-').map(Number);
    return hasMonthlyCadence
      ? addMonths(loan.loanDate, k, 0)
      : isoLocal(new Date(ly, lm - 1, ld + (loan.type === 'FLEXIBLE' ? (k - 1) * slotStep : k * slotStep)));
  };
  type Row = {
    sn: number; date: string; due: number; collected: number; remaining: number;
    status: 'Paid' | 'Partial' | 'Overdue' | 'Next due' | 'Settled'; isNext?: boolean;
    mode?: PayMode; receipt?: string; remarks?: string; id?: number; kind?: CollectionKind;
    payAmount?: number; // the actual payment record's amount (for editing)
    // DUE DATE vs COLLECTION DATE are separate concepts and separate columns:
    // dueDate = the schedule slot's date; paidOn = the funding payment's actual
    // receipt date. `date` stays as each view's primary date for sorting/stats.
    dueDate?: string; paidOn?: string;
  };

  const todayStr = todayISO();

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
    // For interest-only collapse, cap the FIFO pool used by cycle rows to the
    // regular (non-settlement) interest, so pre-settlement rows allocate correctly.
    const rowPool = collapse
      ? (interestOnly ? regularInterestPool : Math.max(0, pool - settle!.amount))
      : pool;
    const slotDueDate = slotDueDateFor; // shared helper (also used by the save path)
    const attributable = (interestOnly ? loanColls.filter((c) => c.kind !== 'PRINCIPAL') : loanColls)
      .filter((c) => !collapse || (interestOnly ? !settleBundle.some((s) => s.id === c.id) : c.id !== settle!.id))
      .sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
    // Furthest slot money can reach: elapsed slots + what the pool can fund,
    // +1 lookahead so a receipt dated at tomorrow's next-due can land on it.
    let horizon = Math.min(Math.max(elapsed, Math.ceil(rowPool / slotDue)) + 1, slotCap);
    // A stored target can point PAST that range (Add clicked on the appended
    // next-due row, paid in advance). The slot lookup must reach every target,
    // or the targeted money silently FIFO-falls onto older days — a ₹500
    // targeted at day 8 once landed on day 1 and re-shuffled rows on edit.
    const maxTarget = attributable.reduce<string | null>(
      (m, c) => (c.targetDate && (!m || c.targetDate > m) ? c.targetDate : m), null);
    if (maxTarget) {
      const hardCap = Math.min(horizon + 1000, slotCap); // sanity bound; slotCap may be Infinity
      while (horizon < hardCap && slotDueDate(horizon) < maxTarget) horizon++;
    }
    // ── Per-slot funding ─────────────────────────────────────────────────────
    // slotAlloc: slot k → amount funded; slotRec: slot k → the (last) payment
    // record funding it (carries mode/receipt/edit onto the row).
    const slotAlloc = new Map<number, number>();
    const slotRec = new Map<number, (typeof attributable)[number]>();
    const put = (k: number, amt: number, c: (typeof attributable)[number]) => {
      slotAlloc.set(k, (slotAlloc.get(k) ?? 0) + amt);
      slotRec.set(k, c);
    };
    if (!collapse) {
      // ACTIVE-loan allocation, priority order per payment:
      //  1. the slot the collector explicitly TARGETED (the ledger row whose
      //     Add button was clicked — stored on the record as targetDate);
      //  2. SCHEDULED LOANS ONLY (Daily Collection / EMI): the slot due on the
      //     payment's own RECEIPT date ("today's collection pays today").
      //     Interest-only loans SKIP this step on purpose — their receipts
      //     often coincide with cycle dates, so applying it would silently
      //     re-arrange every existing production ledger; untargeted interest
      //     payments must keep their exact historical FIFO display.
      //  3. the OLDEST unpaid slot (FIFO) for the surplus / untargeted money.
      // Bulk receipts (clear-overdue, foreclosure) and legacy records carry no
      // target, so they follow 2→3 (scheduled) or plain FIFO (interest-only) —
      // byte-for-byte the pre-targeting behaviour.
      const slotByDate = new Map<string, number>();
      for (let k = 1; k <= horizon; k++) slotByDate.set(slotDueDate(k), k);
      const fill = (k: number | undefined, c: (typeof attributable)[number], left: number) => {
        if (!k) return left;
        const take = Math.min(left, slotDue - (slotAlloc.get(k) ?? 0));
        if (take > 0) { put(k, take, c); left -= take; }
        return left;
      };
      for (const c of attributable) {
        let left = c.amount;
        if (c.targetDate) left = fill(slotByDate.get(c.targetDate), c, left);
        if (left > 0 && !interestOnly) left = fill(slotByDate.get(c.date), c, left);
        for (let k = 1; k <= horizon && left > 0; k++) {
          const take = Math.min(left, slotDue - (slotAlloc.get(k) ?? 0));
          if (take > 0) { put(k, take, c); left -= take; }
        }
      }
    } else {
      // Foreclosure collapse keeps the PURE FIFO pool: contiguous prefix
      // funding, attribution via cumulative payment ranges. (A CLOSED loan is
      // settled in full — slot order is a summary, targets are irrelevant.)
      let acc = 0;
      const funders = attributable.map((c) => { const start = acc; acc += c.amount; return { start, end: acc, c }; });
      for (let k = 1; k <= horizon; k++) {
        const alloc = Math.max(0, Math.min(rowPool - (k - 1) * slotDue, slotDue));
        if (alloc <= 0) break;
        const lo = (k - 1) * slotDue;
        const rec = funders.filter((f) => f.end > lo && f.start < lo + alloc).pop()?.c;
        slotAlloc.set(k, alloc);
        if (rec) slotRec.set(k, rec);
      }
    }
    // ── Rows to render ───────────────────────────────────────────────────────
    // Every elapsed slot + every funded slot (paid-ahead stays visible), plus
    // ONE upcoming "Next due" — appended ONLY when no rendered slot due
    // today-or-later is still collectable (today's unpaid slot already IS the
    // next due; appending another would show two "Next due" rows). Collapse
    // renders ONLY regular-funded slots — the Settled row covers the rest.
    const lastFunded = slotAlloc.size ? Math.max(...Array.from(slotAlloc.keys())) : 0;
    let count = collapse ? fundedBefore : Math.max(elapsed, lastFunded);
    if (!collapse && loan.status === 'ACTIVE') {
      let hasActionable = false;
      for (let k = 1; k <= count; k++) {
        if (slotDueDate(k) >= todayStr && (slotAlloc.get(k) ?? 0) < slotDue) { hasActionable = true; break; }
      }
      if (!hasActionable) count += 1;
    }
    if (Number.isFinite(slotCap)) count = Math.min(count, slotCap);
    const out: Row[] = [];
    let cum = 0; // pool consumed through slot k in SLOT order (principal column)
    for (let k = 1; k <= count; k++) {
      const dueDate = slotDueDate(k);
      const alloc = slotAlloc.get(k) ?? 0;
      cum += alloc;
      const remaining = interestOnly ? 0 : Math.max(0, loan.principal - cum);
      const rec = slotRec.get(k);
      const status: Row['status'] =
        alloc >= slotDue
          ? 'Paid'
          : alloc > 0
            ? 'Partial'
            : dueDate < todayStr ? 'Overdue' : 'Next due';
      out.push({
        sn: k, date: dueDate, due: slotDue, collected: alloc, remaining, status,
        mode: rec?.mode, receipt: rec?.receiptNo, remarks: rec?.remarks, id: rec?.id, kind: rec?.kind,
        payAmount: rec?.amount,
        dueDate, paidOn: rec?.date, // slot's due vs the funding payment's receipt date
      });
    }
    // The settlement/foreclosure row: ONE row for everything cleared at
    // settlement (overdue interest + principal), on its actual date, closing 0.
    if (settle && collapse) {
      const amount = interestOnly ? settleTotal : Math.max(0, pool - fundedBefore * slotDue);
      out.push({
        sn: out.length + 1, date: settle.date, due: amount, collected: amount, remaining: 0,
        status: 'Settled', mode: settle.mode, receipt: settle.receiptNo,
        // payAmount must be the RECORD's own amount (what an edit prefills) —
        // the row's displayed total may span several records (interest bundle)
        // or include money FIFO'd from earlier payments; writing that computed
        // total back onto this one record would fabricate money.
        remarks: 'Full settlement', id: settle.id, kind: settle.kind, payAmount: settle.amount,
        dueDate: settle.date, paidOn: settle.date,
      });
    }
    // Mark ONE actionable next-due row for ACTIVE loans: the first unpaid slot
    // due today or later. (Fallback: last unpaid row, so the anchor never
    // lands on the oldest overdue and never disappears entirely.)
    if (loan.status === 'ACTIVE') {
      const nx = out.find((r) => r.date >= todayStr && r.status !== 'Paid' && r.status !== 'Settled')
        ?? [...out].reverse().find((r) => r.status !== 'Paid' && r.status !== 'Settled');
      return out.map((r) => (nx && r.sn === nx.sn ? { ...r, isNext: true } : r));
    }
    return out;
  }, [loan, d.collections, slotDue, slotStep, slotCap, interestOnly, todayStr]);

  // ── Display rows ──────────────────────────────────────────────────────────
  // For ACTIVE scheduled loans (Daily Collection / EMI) show ONE row per ACTUAL
  // payment with its REAL amount (so a bulk/advance payment shows e.g. ₹67,000
  // on the day it was made — not FIFO-split ₹1,000 filler rows), followed by a
  // single "Next due" row for the next unpaid instalment. Interest-only,
  // foreclosed (CLOSED), and simple loans keep the slot-based `rows` above.
  // ONE ledger shape for EVERY loan type: the slot ledger above. Each row is a
  // DUE (day / EMI / interest cycle) with its FIFO-funded amount; "Due Date"
  // and "Collection Date" are separate columns, so a BULK payment shows as
  // Paid on each due it clears while the Collection Date reveals the single
  // day the money actually arrived. CLOSED loans collapse to funded rows plus
  // one Settled payoff row. (The old payment-per-row view for scheduled loans
  // is retired — it hid which dues a bulk covered.)
  const displayRows = rows;

  const collected = d.collectedFor(loan.id);
  const pending = Math.max(0, loan.principal - collected);
  const deduction = loan.deduction ?? upfrontDeduction(loan.type, loan.interest);
  // Prefer the server-stored disbursed amount; fall back to the computation for mock loans.
  const netDisbursed = loan.disbursed ?? Math.max(0, loan.principal - deduction);
  // Elapsed-only figures — rows may include ONE appended upcoming slot (isNext
  // with a future date), which must not count toward what's owed by today.
  const elapsedSteps = rows.filter((r) => r.date <= todayStr).length; // slots due by today
  // Progress for Daily Collection = how far through the collection CALENDAR the
  // loan is (schedule days fallen due by today), NOT amounts collected — a loan
  // 19 days into a 100-day term reads 19/100 regardless of what was paid.
  // EMI/monthly keep the funded-slot count (a month is "paid" only when its
  // instalment is covered). A CLOSED loan is settled in full (foreclosure
  // clears the balance) → complete bar. Simple loans (no schedule) fall back
  // to the payment count.
  const paidDays = loan.status === 'CLOSED'
    ? progressTotal
    : loan.type === 'DAILY_COLLECTION'
      ? Math.min(elapsedSteps, progressTotal)
      : isSimple
        ? Math.min(d.collections.filter((c) => c.loanId === loan.id).length, progressTotal)
        : Math.min(rows.filter((r) => r.status === 'Paid').length, progressTotal);
  const outstanding = d.outstandingFor(loan); // for Monthly Interest this already includes the shortfall (Principal + Total Due)
  const totalDue = Math.max(0, elapsedSteps * instalment - collected); // shortfall vs what should've been collected by today
  const dueDays = rows.filter((r) => r.date <= todayStr && r.status !== 'Paid').length; // elapsed slots not yet fully paid

  const defaultAmount = () => String(loan.dailyAmount ?? '');
  // Inline amount validation, layered strictest-first (also enforced on save):
  //  1. positive whole rupees;
  //  2. absolute sanity cap (mirrors the backend's ₹10 crore maxPrincipal —
  //     also protects against JS float precision loss on absurd inputs);
  //  3. day-edit: never more than the day's scheduled due;
  //  4. regular add: never more than the loan's outstanding — a payment can't
  //     exceed what's actually owed (foreclosure prefills exactly outstanding,
  //     and record edits are corrections, so both skip this cap).
  const MAX_PAYMENT = 100000000; // ₹10 crore, in rupees
  const amtNum = Number(amount);
  const amountError = amount === '' ? ''
    : !(amtNum > 0) ? 'Enter an amount greater than 0'
    : !Number.isInteger(amtNum) ? 'Enter a whole rupee amount'
    : amtNum > MAX_PAYMENT ? 'Amount is unrealistically large'
    : editDay && amtNum > editDay.due ? `Max for this day is ${inr(editDay.due)}`
    : !editId && !editDay && !isSettlement && !flexSettle && amtNum > outstanding ? `Amount exceeds the pending balance (${inr(outstanding)})`
    : '';
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
  const openFlexSettle = () => {
    setEditId(null); setIsSettlement(true); setFlexSettle(true); setEditSlot(null); setClearDues(false); setPayTarget(null); setEditDay(null);
    setAmount(String(flexOutstanding)); setDate(settlementDate()); setMode('CASH');
    setKind('PRINCIPAL'); setRemarks('Full settlement'); setAddOpen(true);
  };
  /** Foreclosure (non-interest-only): prefill the full outstanding as one payment;
   *  recording it drives outstanding to 0 and the loan auto-closes. Same-day. */
  const openForeclose = () => { setEditId(null); setIsSettlement(true); setFlexSettle(false); setEditSlot(null); setClearDues(false); setPayTarget(null); setEditDay(null); setAmount(String(outstanding)); setDate(settlementDate()); setMode('CASH'); setKind('INTEREST'); setRemarks('Foreclosure — full settlement'); setAddOpen(true); };
  /** Clear overdue: ONE bulk receipt (dated today) prefilled with the unpaid
   *  portion of STRICTLY overdue slots — due date before today, exactly the
   *  rows the ledger badges 'Overdue' (a slot due today is 'Next due' and must
   *  NOT count). Works for every behavior: the slot rows already carry FIFO
   *  allocation, and their pool excludes PRINCIPAL for interest-only loans.
   *  It's a normal collection: FIFO fills oldest first, the loan stays ACTIVE. */
  const overdueRows = rows.filter((r) => r.date < todayStr && r.status !== 'Paid' && r.status !== 'Settled');
  const overdueTotal = overdueRows.reduce((s, r) => s + Math.max(0, r.due - r.collected), 0);
  // Everything unpaid due THROUGH today. The clear-dues receipt is dated today,
  // so allocation funds today's slot first — the prefill must include it, or
  // "clearing overdue" would leave the last overdue day unpaid.
  const todayPending = rows
    .filter((r) => r.date === todayStr && r.status !== 'Paid' && r.status !== 'Settled')
    .reduce((s, r) => s + Math.max(0, r.due - r.collected), 0);
  const clearTotal = overdueTotal + todayPending;
  // Interest-only settlement figures. The interest part comes from the LEDGER's
  // own unpaid cycles (clearTotal), NOT totalDueForInterestOnly: that helper
  // nets accrued interest against ALL interest collected, so advance-paid
  // cycles cancel genuinely-unpaid older ones and it reports ₹0 while the
  // ledger still shows Overdue rows — settling then closed the loan while
  // leaving real arrears uncollected.
  const flexInterestDue = clearTotal;
  const flexOutstanding = remainingPrincipal + flexInterestDue;
  const openClearDues = () => {
    setEditId(null); setIsSettlement(false); setFlexSettle(false); setEditSlot(null); setClearDues(true); setPayTarget(null); setEditDay(null);
    setAmount(String(clearTotal)); setDate(settlementDate()); setMode('CASH');
    setKind('INTEREST'); setRemarks('Overdue cleared'); setAddOpen(true);
  };
  const openEdit = (c: { id: number; amount: number; date: string; mode: PayMode; kind?: CollectionKind; remarks?: string }) => {
    // PLAIN edit of the payment record: the field holds the record's actual
    // amount and saves exactly what's typed — up OR down (corrections must be
    // possible). Collecting a partial slot's PENDING is the Add button's job
    // (a NEW receipt dated today, FIFO-allocated); topping up an existing
    // record would re-date money onto an old receipt and, when the funder is
    // a BULK payment, inflate it from the wrong base.
    setEditId(c.id); setIsSettlement(false); setFlexSettle(false); setClearDues(false); setEditSlot(null); setPayTarget(null); setEditDay(null);
    setAmount(String(c.amount));
    setDate(c.date); setMode(c.mode); setKind(c.kind ?? 'INTEREST'); setRemarks(c.remarks ?? ''); setAddOpen(true);
  };
  const openRow = (r: { id?: number; sn?: number; date: string; dueDate?: string; paidOn?: string; collected: number; payAmount?: number; mode?: PayMode; kind?: CollectionKind; remarks?: string; due?: number; status?: Row['status']; pending?: number }) => {
    // Edit the actual payment record (payAmount), not the FIFO allocation shown
    // in the row's Amount column. The edit form must carry the payment's REAL
    // receipt date (paidOn) — never the slot's due date — or saving would
    // silently re-date the payment onto the schedule.
    if (r.id) {
      // A slot funded by SEVERAL receipts gets DAY-EDIT mode: the form edits
      // the day's total. (Editing just the hidden last receipt looked like a
      // no-op — the user thinks in days, not receipts.)
      const slotDate = r.dueDate ?? r.date;
      const dayRecs = d.collections
        .filter((c) => c.loanId === loan.id && c.targetDate === slotDate)
        .sort((a, b) => a.id - b.id);
      if (dayRecs.length > 1) {
        setEditId(null); setIsSettlement(false); setFlexSettle(false); setEditSlot(null); setClearDues(false); setPayTarget(null);
        setEditDay({
          target: slotDate,
          due: r.due ?? dayRecs.reduce((s, c) => s + c.amount, 0),
          records: dayRecs.map((c) => ({ id: c.id, amount: c.amount, date: c.date, mode: c.mode, kind: c.kind, remarks: c.remarks })),
        });
        setAmount(String(dayRecs.reduce((s, c) => s + c.amount, 0)));
        setDate(todayISO() < minPaymentDate ? minPaymentDate : todayISO());
        setMode(r.mode ?? 'CASH'); setKind('INTEREST'); setRemarks(''); setAddOpen(true);
        return;
      }
      openEdit({ id: r.id, amount: r.payAmount ?? r.collected, date: r.paidOn ?? r.date, mode: r.mode ?? 'CASH', kind: r.kind, remarks: r.remarks });
    }
    else {
      // Show Due / Paid / Pending breakdown for any unpaid slot (Partial, Overdue, or Next due).
      const slot = r.status !== 'Paid' && r.status !== 'Settled' && r.due != null
        ? { due: r.due, paid: r.collected }
        : null;
      setEditId(null); setIsSettlement(false); setFlexSettle(false); setEditSlot(slot); setClearDues(false); setEditDay(null);
      // The clicked row IS the payment's target: the ledger allocation funds it
      // first, so "Add on Day 4" pays Day 4 and "Add on the next due" pays that
      // day — while the RECEIPT date below stays today (correct daily cash).
      setPayTarget(slot ? r.date : null);
      // RECEIPT-DATE RULE (no exceptions): a collection is dated when the money
      // is actually received — default TODAY (clamped to the loan date), NEVER
      // a slot's due date. Prefilling tomorrow's next-due date was tried and
      // reverted: it booked cash received today onto tomorrow, understating
      // today's collections and sliding profit into the wrong day/month on the
      // dashboard. Allocation is date-driven, so on the actual due day the
      // payment funds that day first automatically; a user can still forward-
      // date manually (max today+1), which is explicit and their call.
      const receiptDate = todayISO() < minPaymentDate ? minPaymentDate : todayISO();
      setAmount(r.pending != null ? String(r.pending) : defaultAmount()); setDate(receiptDate); setMode('CASH'); setKind('INTEREST'); setRemarks(''); setAddOpen(true);
    }
  };
  const addColl = async () => {
    // DOUBLE-SUBMIT GUARD: every branch below writes money and the dialog stays
    // open for the round-trip, so a second click would post a duplicate. Worst
    // on the flexSettle branch, which issues TWO sequential writes — a
    // double-click there produces four records and double-counts the
    // interest/principal split that profit-by-month depends on.
    if (saving) return;
    if (!canCollect) { toast('You have view-only access to Collections', 'error'); return; }
    if (!Number(amount)) { toast('Enter an amount', 'error'); return; }
    if (amountError) { toast(amountError, 'error'); return; }
    if (date < minPaymentDate) { toast(`Payment date cannot be before the loan date (${fmtDate(minPaymentDate)})`, 'error'); return; }
    if (date > maxPaymentDate) { toast(`Payment date cannot be beyond the next due (${fmtDate(maxPaymentDate)})`, 'error'); return; }
    // NOTE: no "date < next due" guard. Payments are a FIFO pool — the date is
    // the RECEIPT date (when money arrived), and allocation to schedule slots
    // is independent of it. Blocking dates before the next due slot forced
    // advance payers' receipts to be future-dated, corrupting profit-by-month.
    // kind only matters for interest-only loans; always send INTEREST otherwise.
    const k: CollectionKind = interestOnly ? kind : 'INTEREST';
    setSaving(true);
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
      } else if (editDay) {
        // DAY EDIT (slot funded by several receipts): reconcile the day's
        // receipts to the entered total. Decrease → trim the NEWEST receipts
        // first, deleting emptied ones — every kept receipt keeps its own
        // receipt date (daily cash stays truthful). Increase → the difference
        // is NEW money, recorded as one receipt dated today, pinned to this day.
        const dayDue = editDay.due;
        if (Number(amount) > dayDue) {
          toast(`Max for this day is ${inr(dayDue)} — use Add on other days for more`, 'error');
          return;
        }
        let delta = Number(amount) - editDay.records.reduce((s, x) => s + x.amount, 0);
        if (delta < 0) {
          for (const rec of [...editDay.records].sort((a, b) => b.id - a.id)) {
            if (delta >= 0) break;
            const cut = Math.min(rec.amount, -delta);
            if (cut === rec.amount) await d.deleteCollection(rec.id);
            else await d.updateCollection(rec.id, { amount: rec.amount - cut, date: rec.date, mode: rec.mode, kind: rec.kind ?? 'INTEREST', remarks: rec.remarks });
            delta += cut;
          }
          toast('Day updated — newest receipts reduced');
        } else if (delta > 0) {
          const rd = todayISO() < minPaymentDate ? minPaymentDate : todayISO();
          await d.addCollection({ loanId: loan.id, date: rd, amount: delta, mode, kind: k, remarks: remarks || undefined, targetDate: editDay.target });
          toast('Day updated — difference recorded as a new receipt');
        } else {
          toast('No change — amount already matches this day');
        }
      } else if (editId) {
        // Plain edit: save the record exactly as typed (never top-up math — a
        // partial slot's pending is collected via Add as a NEW receipt).
        await d.updateCollection(editId, { amount: Number(amount), date, mode, kind: k, remarks: remarks || undefined });
        toast('Collection updated');
      } else {
        // Regular add: SPLIT the entered amount into ONE RECORD PER FUNDED DAY,
        // mirroring the ledger's allocation priority (clicked target → the slot
        // due on the receipt date for scheduled loans → oldest unpaid). Each
        // record carries its own day as targetDate, so every ledger row is
        // independently editable — editing Day 1's ₹1,000 can never touch the
        // ₹1,000 that funded Day 6. Money beyond the visible schedule (a big
        // advance) is written as one untargeted record and rolls forward as
        // before. A PRINCIPAL settlement never funds cycle rows → one record.
        const total = Number(amount);
        const parts: Array<{ amount: number; target?: string }> = [];
        // Foreclosure/settlement stays ONE record (the collapse view keys off a
        // single payoff payment — splitting it fragments the Settled row), and
        // a PRINCIPAL settlement never funds cycle rows.
        if (isSettlement || (interestOnly && k === 'PRINCIPAL')) {
          parts.push({ amount: total });
        } else {
          let left = total;
          const used = new Set<number>();
          const open = rows.filter((r) => r.status !== 'Paid' && r.status !== 'Settled');
          const takePart = (r?: { sn: number; due: number; collected: number; dueDate?: string; date: string }) => {
            if (!r || left <= 0 || used.has(r.sn)) return;
            const t = Math.min(left, Math.max(0, r.due - r.collected));
            if (t > 0) { used.add(r.sn); parts.push({ amount: t, target: r.dueDate ?? r.date }); left -= t; }
          };
          takePart(payTarget ? open.find((r) => (r.dueDate ?? r.date) === payTarget) : undefined);
          if (!interestOnly) takePart(open.find((r) => (r.dueDate ?? r.date) === date));
          for (const r of open) { if (left <= 0) break; takePart(r); }
          // Advance beyond the visible schedule: pin each FUTURE day too, so no
          // untargeted money exists that could silently backfill a day the user
          // later edits down. Anything beyond the loan term (pure overpay) is
          // one untargeted remainder.
          if (left > 0 && slotDue > 0) {
            let futureK = rows.length ? rows[rows.length - 1].sn + 1 : 1;
            while (left > 0 && futureK <= slotCap) {
              const t = Math.min(left, slotDue);
              parts.push({ amount: t, target: slotDueDateFor(futureK) });
              left -= t; futureK += 1;
            }
          }
          if (left > 0) parts.push({ amount: left }); // beyond the loan term (overpay)
        }
        for (const p of parts) {
          await d.addCollection({ loanId: loan.id, date, amount: p.amount, mode, kind: k, remarks: remarks || undefined, targetDate: p.target });
        }
        toast(k === 'PRINCIPAL' ? 'Principal settlement recorded' : parts.length > 1 ? `Collection recorded across ${parts.length} days` : 'Collection recorded');
      }
    } catch (e) {
      // Surface the real reason (e.g. date/amount validation) instead of a false success.
      toast(e instanceof ApiError ? e.message : 'Failed to save collection', 'error');
      return; // keep the form open so the user can correct it
    } finally {
      setSaving(false); // always released, so a failed save can be retried
    }
    setAddOpen(false); setEditId(null); setFlexSettle(false); setEditSlot(null); setClearDues(false); setPayTarget(null); setEditDay(null); setAmount(defaultAmount()); setRemarks('');
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
    // Overdue = the LEDGER's own unpaid elapsed cycles, so the header agrees
    // with the rows below it (and with Clear Overdue / Settle & close).
    { k: 'Overdue', v: inr(overdueTotal), sub: overdueRows.length ? `${overdueRows.length} cycle${overdueRows.length === 1 ? '' : 's'} unpaid` : 'Up to date', danger: overdueTotal > 0 },
    { k: 'Outstanding', v: inr(flexOutstanding), sub: 'Principal + interest', hi: true },
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

  /** Build the statement PDF, then either save it or open the share sheet.
   *  Both actions produce the SAME document — only the delivery differs. */
  const generateReport = async (action: 'download' | 'share' = 'download') => {
    // jsPDF + jspdf-autotable are ~415 KB and are only needed when the user
    // actually asks for a PDF, so they are fetched on demand instead of being
    // bundled into the initial download.
    //
    // Every download matches the on-screen Statement tab (Payment Schedule),
    // for all loan types — not the operational ledger table.
    const { buildLedgerReportPDF, downloadPDF, sharePDF, fileNamePart } = await import('@/lib/pdfReport');
    const loanColls = d.collections.filter((c) => c.loanId === loan.id);
    const lastPay = loanColls.length
      ? loanColls.reduce((a, b) => (b.id > a.id ? b : a))
      : null;
    // Interest-only schedules are funded by INTEREST payments only (same as StatementView).
    const scheduleCollected = interestOnly
      ? loanColls.filter((c) => c.kind !== 'PRINCIPAL').reduce((s, c) => s + c.amount, 0)
      : collected;
    const sched = buildSchedule(loan, {
      collected: scheduleCollected,
      settlement: lastPay ? { amount: lastPay.amount, date: lastPay.date } : null,
    });
    const paidCount = instalment > 0 ? Math.floor(scheduleCollected / instalment) : 0;
    // Same labels / figures as StatementView header + key-figure cards.
    const stmtDeduction = emiLoan || interestOnly ? 0 : (loan.deduction ?? upfrontDeduction(loan.type, loan.interest));
    const stmtNet = loan.disbursed ?? (emiLoan || interestOnly ? loan.principal : Math.max(0, loan.principal - stmtDeduction));
    const tenureLabel = interestOnly
      ? (loan.type === 'FLEXIBLE'
        ? `${loan.numDays ?? 30} days / cycle`
        : loan.type === 'DAILY_INTEREST'
          ? 'Open-ended (daily)'
          : 'Open-ended (monthly)')
      : `${loan.numDays ?? sched.length} ${isDailyLoan(loan.type) ? 'days' : 'months'}`;
    const freq = isDailyLoan(loan.type)
      ? 'Daily'
      : loan.type === 'DAILY_INTEREST'
        ? 'Daily'
        : loan.type === 'FLEXIBLE'
          ? 'Flexible cycle'
          : 'Monthly';
    const instalmentLabel = interestOnly ? 'Interest / period' : emiLoan ? 'EMI' : 'Instalment';
    const midStat = emiLoan
      ? { label: 'Total payable', value: inr(loan.principal + loan.interest) }
      : interestOnly
        ? { label: 'Principal (fixed)', value: inr(loan.principal) }
        : { label: 'Deduction (upfront)', value: inr(stmtDeduction) };
    const doc = buildLedgerReportPDF({
      loanNumber: loan.loanNumber,
      documentTitle: 'Payment Schedule',
      loanTypeLabel: `${LOAN_LABELS[loan.type]} · ${loan.loanNumber}`,
      customerName: cust?.name ?? '—',
      customerMobile: loan.contact || cust?.mobile || '—',
      loanDate: fmtDate(loan.loanDate),
      detailFields: [
        { label: 'Customer', value: cust?.name ?? '—' },
        { label: 'Loan Type', value: LOAN_LABELS[loan.type] },
        { label: 'Loan Reference', value: loan.loanNumber },
        { label: 'Loan Start Date', value: fmtDate(loan.loanDate) },
        { label: 'Mobile', value: loan.contact || cust?.mobile || '—' },
        { label: 'Frequency', value: `${freq} instalments` },
        { label: 'Total Tenure', value: tenureLabel },
        { label: 'Rate', value: `${loan.rate}%` },
        { label: 'Loan Amount', value: inr(loan.principal) },
        { label: instalmentLabel, value: inr(instalment) },
      ],
      summary: [
        { label: 'Disbursement date', value: fmtDate(loan.loanDate) },
        midStat,
        { label: emiLoan || interestOnly ? 'Disbursed' : 'Net disbursed', value: inr(stmtNet) },
        { label: 'Interest', value: inr(loan.interest) },
      ],
      progress: interestOnly
        ? { label: 'Periods paid', paid: paidCount, total: Math.max(sched.filter((r) => !r.settled).length, paidCount) }
        : { label: 'Instalments paid', paid: paidCount, total: totalTerm },
      tableTitle: 'Payment Schedule',
      tableHead: ['Instl', 'Due Date', 'Opening', 'Instalment', 'Principal', 'Interest', 'Closing', 'Status'],
      tableBody: sched.map((r) => [
        r.sn,
        fmtDate(r.dueDate),
        inr(r.opening),
        inr(r.instalment),
        inr(r.principal),
        inr(r.interest),
        inr(r.closing),
        r.settled ? 'Foreclosed' : r.sn <= paidCount ? 'Paid' : r.dueDate < todayISO() ? 'Overdue' : 'Due',
      ]),
    });
    // Customer name leads the filename so a folder of statements sorts and
    // searches by borrower; loan number + date keep it unique.
    const who = fileNamePart(cust?.name ?? '');
    const filename = `${who ? `${who}-` : ''}Statement-${loan.loanNumber}-${todayISO()}.pdf`;
    if (action === 'share') {
      const result = await sharePDF(doc, filename);
      toast(result === 'shared' ? 'Statement shared'
        : result === 'cancelled' ? 'Sharing cancelled'
          : 'Sharing unavailable — statement downloaded instead');
      return;
    }
    downloadPDF(doc, filename);
    toast('Statement downloaded');
  };

  return (
    <Dialog open onClose={onClose} title={`${statementOnly && !isSimple ? 'Loan Statement' : 'Collection Ledger'} · ${loan.loanNumber}`} subtitle={isSimple ? `${LOAN_LABELS[loan.type]} · Payment history` : `${LOAN_LABELS[loan.type]} · ${totalTerm} ${isMonthly ? 'months' : 'days'}`} xl
      footer={<>
        <Button variant="ghost" onClick={() => generateReport('share')} title="Send the statement to the customer (WhatsApp, email, …)"><Share2 size={15} /> Share</Button>
        <Button variant="ghost" onClick={() => generateReport('download')} title="Download the statement as a PDF"><FileDown size={15} /> Generate Statement</Button>
        <Button onClick={onClose}>Close</Button>
      </>}>
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

      {/* View toggle: operational ledger vs bank-style statement — all loan types.
          Hidden when statementOnly (Loans page) — the ledger lives on Collections. */}
      {!statementOnly && (
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
      {tab === 'statement' && <StatementView loan={loan} />}

      {/* ── Operational ledger ── */}
      {tab === 'ledger' && (
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

      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-[260px] text-sm text-muted">
          {interestOnly
            ? `Interest payments since ${fmtDate(loan.loanDate)} · ${loan.type === 'DAILY_INTEREST' ? 'daily' : loan.type === 'MONTHLY_INTEREST' ? 'monthly' : `every ${cadenceDaysForLoan(loan)} days`} · principal stays until settled`
            : isSimple
              ? `Payment history for this loan · ${progressTotal}-day cycle`
              : `${isMonthly ? 'Monthly' : 'Daily'} ledger from ${fmtDate(loan.loanDate)} · ${totalTerm} ${isMonthly ? 'months' : 'days'} · instalments repay the principal`}
        </div>
        {canCollect && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/* Clear everything overdue in one bulk receipt — loan stays ACTIVE.
                Hidden when nothing is due (or the loan is closed). */}
            {loan.status === 'ACTIVE' && overdueTotal > 0 && (
              <Button onClick={openClearDues} className="!bg-warning-600 !px-3 !py-1.5 text-xs whitespace-nowrap transition-transform hover:scale-105 hover:!bg-warning-600/90" title={`Collect everything due till today (${inr(clearTotal)}) as one bulk payment — the loan stays active`}>
                Clear Overdue · {inr(clearTotal)}
              </Button>
            )}
            {/* Interest-only (Daily/Monthly Interest + Flexible): settle the FULL
                outstanding (accrued interest + principal) in one shot → auto-close. */}
            {interestOnly && flexOutstanding > 0 && (
              <Button onClick={openFlexSettle} className="!bg-emerald-600 !px-3 !py-1.5 text-xs whitespace-nowrap transition-transform hover:scale-105" title={`Collect the full outstanding (${inr(flexOutstanding)}) — interest + principal — and close the loan`}>
                Settle & close · {inr(flexOutstanding)}
              </Button>
            )}
            {!interestOnly && outstanding > 0 && (
              <Button onClick={openForeclose} className="!bg-emerald-600 !px-3 !py-1.5 text-xs whitespace-nowrap transition-transform hover:scale-105" title="Record the full outstanding and close the loan">
                Foreclose
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Unified slot ledger — one table for EVERY loan type. The actionable
          (isNext) row carries the Add-collection button; COMPLETED rows (Paid /
          Paid late / Settled) carry the edit pencil, while a Partial row gets
          Add only. Statuses: Paid / Partial / Overdue / Next due. */}
      <div className="max-h-96 overflow-auto rounded-xl border border-slate-100 dark:border-white/[.06]">
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-slate-100 [&>th]:px-3 [&>th]:py-2.5 [&>th]:shadow-[0_1px_0_rgba(15,23,42,0.08)] dark:[&>th]:bg-slate-800">
            <th>{loan.type === 'FLEXIBLE' ? 'Cycle' : isMonthly || loan.type === 'MONTHLY_INTEREST' ? 'Month' : 'Day'}</th>
            <th>Due Date</th>
            <th>Collection Date</th>
            <th>{interestOnly ? 'Interest Due' : loan.type === 'FLEXIBLE' ? 'Amount Due' : `${isMonthly ? 'Monthly' : 'Daily'} Due`}</th>
            <th>Amount</th>
            {!interestOnly && <th>{loan.type === 'FLEXIBLE' ? 'Balance' : 'Principal Remaining'}</th>}
            <th>Payment Mode</th><th>Status</th><th className="text-right">Action</th><th>Remarks</th>
          </tr></thead>
          <tbody>
            {displayRows.map((r) => {
              // LATE rows: fully-paid slots whose money arrived AFTER the due
              // date (an overdue day cleared later) get a distinct VIOLET
              // "Paid late". Partial rows are ALWAYS yellow — one colour for
              // every part-paid day, on time or late (user preference).
              const isLate = r.status === 'Paid' && !!r.paidOn && !!r.dueDate && r.paidOn > r.dueDate;
              const border = isLate ? 'border-l-violet-500' : r.status === 'Paid' || r.status === 'Settled' ? 'border-l-success' : r.status === 'Partial' ? 'border-l-warning' : r.status === 'Overdue' ? 'border-l-danger' : 'border-l-primary';
              return (
                <tr key={r.sn} className={`border-t border-l-4 border-slate-100 dark:border-white/[.06] ${border} ${r.isNext ? 'bg-primary-50/40 dark:bg-primary/[.06]' : ''}`}>
                  <td className="px-3 py-2 text-muted">{r.sn}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.dueDate ?? r.date)}{(r.dueDate ?? r.date) === todayStr && <span className="ml-1 text-[10px] font-bold text-primary">• today</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.paidOn ? <>{fmtDate(r.paidOn)}{r.paidOn === todayStr && <span className="ml-1 text-[10px] font-bold text-primary">• today</span>}</> : <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-2">{inr(r.due)}</td>
                  <td className="px-3 py-2">{r.collected ? inr(r.collected) : '—'}</td>
                  {!interestOnly && <td className="px-3 py-2 font-medium">{inr(r.remaining)}</td>}
                  <td className="px-3 py-2">{r.mode ? <Badge tone="neutral">{r.mode}</Badge> : <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {isLate
                      ? <Badge className="bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400"><span className="whitespace-nowrap">Paid late</span></Badge>
                      : <Badge tone={r.status === 'Paid' || r.status === 'Settled' ? 'ok' : r.status === 'Partial' ? 'warn' : r.status === 'Overdue' ? 'err' : 'info'}><span className="whitespace-nowrap">{r.status}</span></Badge>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!canCollect ? <span className="text-muted">—</span> : (
                      <div className="flex items-center justify-end gap-1">
                        {/* EVERY unpaid slot on an ACTIVE loan is collectable —
                            Add shows on all Overdue/Partial/Next-due rows, not
                            just the first (payments are FIFO, so any of them
                            records against the oldest dues anyway). */}
                        {loan.status === 'ACTIVE' && r.status !== 'Paid' && r.status !== 'Settled' && (
                          <Button variant="success" onClick={() => openRow({
                              sn: r.sn, date: r.date, collected: r.collected, due: r.due, status: r.status,
                              pending: Math.max(0, r.due - r.collected)
                            })}
                            className="!px-2 !py-0.5 !text-[11px] whitespace-nowrap" title={`Collect ${r.status === 'Partial' ? 'the pending' : 'this'} amount for ${isMonthly ? 'month' : 'day'} ${r.sn}`}>
                            <Plus size={11} /> Add
                          </Button>
                        )}
                        {/* Edit is offered on COMPLETED rows — Paid / Paid late
                            (and Settled foreclosure payoffs): correcting a wrong
                            amount is the only action left on them. A Partial row
                            gets Add ONLY: its pending is collected as a NEW
                            receipt, which is the correct money trail (editing it
                            would rewrite an existing receipt instead). */}
                        {r.id && r.status !== 'Partial' && (
                          <button onClick={() => openRow(r)} title={r.status === 'Settled' ? 'Edit this settlement' : `Edit the payment for ${isMonthly ? 'month' : 'day'} ${r.sn}`} aria-label="Edit payment"
                            className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-primary-50 hover:text-primary"><Pencil size={14} /></button>
                        )}
                        {/* No action available (e.g. an unfunded CLOSED-loan row) —
                            keep the column aligned. */}
                        {!(loan.status === 'ACTIVE' && r.status !== 'Paid' && r.status !== 'Settled')
                          && !(r.id && r.status !== 'Partial') && (
                          <span className="text-muted">—</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted">{r.remarks ?? '—'}</td>
                </tr>
              );
            })}
            {displayRows.length === 0 && (
              <tr><td colSpan={interestOnly ? 9 : 10} className="px-3 py-6 text-center text-muted">No schedule to show yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      </>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title={editId ? 'Edit collection' : editDay ? 'Edit day collection' : isSettlement ? 'Settle & close' : clearDues ? 'Clear overdue' : 'Add collection'} subtitle={cust?.name ? `${cust.name} · ${loan.loanNumber}` : loan.loanNumber}
        footer={<><Button variant="ghost" onClick={() => setAddOpen(false)} disabled={saving}>Cancel</Button>
          <Button variant={isSettlement ? 'success' : 'primary'} onClick={addColl} loading={saving}>
            {editId || editDay ? 'Save changes' : isSettlement ? <><CheckCircle2 size={15} /> Settle &amp; close</> : <><Plus size={15} /> Record payment</>}
          </Button></>}>
        <div className="min-w-0 space-y-4">
          {/* Context banner */}
          {isSettlement ? (
            <div className="flex items-start gap-2.5 rounded-xl border-[0.5px] border-emerald-200 bg-emerald-50 px-3.5 py-3 dark:border-emerald-500/25 dark:bg-emerald-500/10">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div className="text-[12px] leading-snug text-emerald-800 dark:text-emerald-300">
                <span className="font-bold">Full settlement.</span> The entire outstanding{interestOnly ? ' (principal + accrued interest)' : ''} is collected and the loan is closed.
              </div>
            </div>
          ) : clearDues ? (
            <div className="rounded-xl border-[0.5px] border-amber-200 bg-amber-50 px-3.5 py-3 dark:border-amber-500/25 dark:bg-amber-500/10">
              <div className="flex items-center gap-2 text-[12px] font-bold text-amber-700 dark:text-amber-300">
                <Wallet size={15} className="shrink-0" /> Clearing all overdue
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                <div><div className="text-[11px] text-muted">{interestOnly ? 'Cycles overdue' : `Overdue ${isMonthly ? 'months' : 'days'}`}</div><div className="font-display text-[15px] font-bold tabular-nums text-ink">{overdueRows.length}</div></div>
                <div><div className="text-[11px] text-muted">Total overdue</div><div className="font-display text-[15px] font-bold tabular-nums text-amber-600 dark:text-amber-400">{inr(overdueTotal)}</div></div>
              </div>
              <div className="mt-2 text-[11px] leading-snug text-muted">
                One bulk receipt dated today — it covers today&apos;s due first, then the overdue {isMonthly ? 'months' : 'days'}, oldest first. The loan stays active.
              </div>
            </div>
          ) : editDay ? (
            <div className="rounded-xl border-[0.5px] border-violet-200 bg-violet-50 px-3.5 py-3 dark:border-violet-500/25 dark:bg-violet-500/10">
              <div className="flex items-center gap-2 text-[12px] font-bold text-violet-700 dark:text-violet-300">
                <Wallet size={15} className="shrink-0" /> Editing the whole day · {fmtDate(editDay.target)}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div><div className="text-[11px] text-muted">Day due</div><div className="font-display text-[15px] font-bold tabular-nums text-ink">{inr(editDay.due)}</div></div>
                <div><div className="text-[11px] text-muted">Receipts</div><div className="font-display text-[15px] font-bold tabular-nums text-ink">{editDay.records.length}</div></div>
                <div><div className="text-[11px] text-muted">Collected</div><div className="font-display text-[15px] font-bold tabular-nums text-violet-600 dark:text-violet-400">{inr(editDay.records.reduce((s, x) => s + x.amount, 0))}</div></div>
              </div>
              <div className="mt-2 text-[11px] leading-snug text-muted">
                This day was collected via {editDay.records.length} receipts. Lowering the amount trims the newest receipts first; raising it records the difference as a new receipt dated today.
              </div>
            </div>
          ) : editSlot ? (
            <div className="rounded-xl border-[0.5px] border-amber-200 bg-amber-50 px-3.5 py-3 dark:border-amber-500/25 dark:bg-amber-500/10">
              <div className="flex items-center gap-2 text-[12px] font-bold text-amber-700 dark:text-amber-300">
                <Wallet size={15} className="shrink-0" /> {editSlot.paid > 0 ? 'Partial payment for this day' : 'Collection for this day'}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div><div className="text-[11px] text-muted">Due</div><div className="font-display text-[15px] font-bold tabular-nums text-ink">{inr(editSlot.due)}</div></div>
                <div><div className="text-[11px] text-muted">Paid so far</div><div className="font-display text-[15px] font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{inr(editSlot.paid)}</div></div>
                <div><div className="text-[11px] text-muted">Pending</div><div className="font-display text-[15px] font-bold tabular-nums text-amber-600 dark:text-amber-400">{inr(Math.max(0, editSlot.due - editSlot.paid))}</div></div>
              </div>
              <div className="mt-2 text-[11px] leading-snug text-muted">
                {Number(amount) > Math.max(0, editSlot.due - editSlot.paid) && !amountError
                  ? <>Paying <span className="font-semibold text-ink">{inr(Math.max(0, editSlot.due - editSlot.paid))}</span> completes this day — the extra <span className="font-semibold text-ink">{inr(Number(amount) - Math.max(0, editSlot.due - editSlot.paid))}</span> automatically clears the oldest overdue.</>
                  : <>Collecting the <span className="font-semibold text-ink">{inr(Math.max(0, editSlot.due - editSlot.paid))}</span> pending for this day — this completes the day’s full {inr(editSlot.due)}.</>}
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

          {/* Allocation preview — runs the SAME rule as the ledger: targeted
              slot first, then (scheduled loans only) the slot due on the
              receipt date, then the OLDEST unpaid slot. Interest-only shows it
              for INTEREST payments only — a PRINCIPAL settlement never funds
              cycle rows, so previewing one would lie. */}
          {!editId && !editDay && !isSettlement && !clearDues && (!isSimple || kind === 'INTEREST') && Number(amount) > 0 && !amountError && (() => {
            let remaining = Number(amount);
            const allocs: Array<{ sn: number; date: string; alloc: number; own: boolean }> = [];
            const take = (r: (typeof rows)[number], own: boolean) => {
              const t = Math.min(remaining, Math.max(0, r.due - r.collected));
              if (t > 0) { allocs.push({ sn: r.sn, date: r.dueDate ?? r.date, alloc: t, own }); remaining -= t; }
            };
            const open = rows.filter((r) => r.status !== 'Paid' && r.status !== 'Settled');
            // Same priority as the ledger: clicked target → receipt-date slot
            // (scheduled loans only — interest-only skips it, see rows memo) →
            // oldest unpaid.
            const targetRow = payTarget ? open.find((r) => (r.dueDate ?? r.date) === payTarget) : undefined;
            if (targetRow) take(targetRow, true);
            const ownDay = interestOnly ? undefined : open.find((r) => (r.dueDate ?? r.date) === date && r !== targetRow);
            if (remaining > 0 && ownDay) take(ownDay, true);
            for (const r of open) { if (remaining <= 0) break; if (r !== targetRow && r !== ownDay) take(r, false); }
            return allocs.length > 0 ? (
              <div className="rounded-xl border-[0.5px] border-slate-200 bg-slate-50 px-3.5 py-3 dark:border-white/[.06] dark:bg-white/[.02]">
                <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-muted">Payment allocation</div>
                <div className="space-y-1.5">
                  {allocs.map((a) => (
                    <div key={a.sn} className="flex items-center justify-between text-[12px]">
                      <span className="text-ink">
                        <span className="font-medium">{loan.type === 'FLEXIBLE' ? 'Cycle' : hasMonthlyCadence ? 'Month' : 'Day'} {a.sn}</span> · {fmtDate(a.date)}
                        {a.date === todayStr && <span className="ml-1 text-[10px] font-bold text-primary">• today</span>}
                      </span>
                      <span className={`font-semibold tabular-nums ${a.own ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>{inr(a.alloc)}</span>
                    </div>
                  ))}
                  {remaining > 0 && (
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-muted">Advance — rolls to upcoming {loan.type === 'FLEXIBLE' ? 'cycles' : hasMonthlyCadence ? 'months' : 'days'}</span>
                      <span className="font-semibold tabular-nums text-primary">{inr(remaining)}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : null;
          })()}

          {/* Amount — same height/alignment as Date & Remarks (not a tall hero box) */}
          <div>
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">Amount</span>
            <div className={`flex h-[42px] items-center gap-2 rounded-xl border bg-white px-3.5 shadow-[inset_0_1px_2px_rgba(15,23,42,.03)] dark:bg-surface dark:shadow-none ${
              amountError ? 'border-danger focus-within:border-danger focus-within:ring-4 focus-within:ring-danger/10' : 'border-slate-200 focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 dark:border-white/[.08]'
            }`}>
              <IndianRupee size={15} className="shrink-0 text-muted" aria-hidden />
              <input
                type="text"
                inputMode="numeric"
                maxLength={12}
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, '').slice(0, 12))}
                placeholder="0"
                className="min-w-0 flex-1 bg-transparent text-sm font-semibold leading-none tabular-nums text-ink outline-none focus:shadow-none focus-visible:shadow-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
              />
            </div>
            {amountError && <span className="mt-1 block text-[12px] font-medium text-danger">{amountError}</span>}
          </div>

          {/* Payment mode — segmented picker with icons */}
          <div>
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">Payment mode</span>
            <div className="grid grid-cols-2 gap-2 min-w-0 md:grid-cols-4">
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

          {/* Date + remarks — stack on phone/tablet (iPad Air ~820px) so native
              date controls don't squeeze Remarks; side-by-side from lg up. */}
          <div className="grid grid-cols-1 gap-4 min-w-0 lg:grid-cols-2">
            {/* Day-edit keeps every receipt's own date; only an INCREASE writes a
                new receipt (dated today), so the date field is hidden there. */}
            {!editDay && (
            <div className="min-w-0">
              <Input label="Date" type="date" value={date}
                min={minPaymentDate}
                max={maxPaymentDate} onChange={(e) => setDate(e.target.value)}
                error={date && date < minPaymentDate ? `On/after loan date (${fmtDate(minPaymentDate)})` : date && date > maxPaymentDate ? `Not beyond next due (${fmtDate(maxPaymentDate)})` : undefined} />
            </div>
            )}
            <div className="min-w-0">
              <Input label="Remarks" placeholder="Optional note" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
          </div>
        </div>
      </Dialog>
    </Dialog>
  );
}
