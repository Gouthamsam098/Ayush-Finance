import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData, LOAN_LABELS } from '@/mock/DataContext';
import { profitByLoan } from '@/lib/funds';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/ui/stat-card';
import { useToast } from '@/components/ui/toast';
import { PageHeader, HeaderPrimaryButton } from '@/components/layout/PageHeader';
import { usePermissions } from '@/lib/permissions';
import { inr, inrShort, fmtDate, todayISO, initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import { config } from '@/lib/config';
import { ApiError } from '@/lib/api';
import { investmentApi } from '@/services/investmentApi';
import {
  loadInvestments, saveInvestments, loadPayouts, savePayouts, nextSeq, investmentCode,
  interestPerCycle, cyclesElapsed, accruedInterest, interestDue, totalPaid, nextPayoutDate,
  daysOverdue, buildCycles, cycleDueDate, investmentTotals, payoutDefaultDate, firstPayoutDate,
  daysBetweenISO, monthsBetweenISO, cacheInvestorCapital,
  INVESTOR_EXPENSE_CATEGORY, investorExpenseName,
  type Investment, type InvestorPayout, type PayoutFrequency, type PayMode,
} from '@/lib/investments';
import {
  Plus, Landmark, TrendingDown, AlertTriangle, Search, ChevronRight, Phone, Wallet,
  HandCoins, CheckCircle2, Inbox, Banknote, Smartphone, ScrollText, Pencil, Trash2, CalendarClock,
  PiggyBank,
} from 'lucide-react';

const MODES: PayMode[] = ['CASH', 'UPI', 'BANK', 'CHEQUE'];
const MODE_ICON: Record<PayMode, typeof Banknote> = {
  CASH: Banknote, UPI: Smartphone, BANK: Landmark, CHEQUE: ScrollText,
};

interface IForm {
  id?: number;
  investorName: string; mobile: string; email: string;
  principal: string; rate: string; frequency: PayoutFrequency;
  startDate: string; notes: string;
}
const blankForm = (): IForm => ({
  investorName: '', mobile: '', email: '',
  principal: '', rate: '', frequency: 'MONTHLY', startDate: todayISO(), notes: '',
});

type StatusFilter = 'ACTIVE' | 'CLOSED' | 'OVERDUE';

export default function Investments() {
  const d = useData();
  const toast = useToast();
  const { canEdit } = usePermissions();
  const editable = canEdit('Expenses'); // investor payouts ARE expenses

  // In API mode the list is fetched; in mock mode it comes from localStorage.
  const [items, setItems] = useState<Investment[]>(() => (config.useApi ? [] : loadInvestments()));
  const [payouts, setPayouts] = useState<InvestorPayout[]>(() => (config.useApi ? [] : loadPayouts()));
  // Bumped after any server write, to re-fetch the authoritative state.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const [form, setForm] = useState<IForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<Investment | null>(null);
  const [payFor, setPayFor] = useState<Investment | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(todayISO());
  const [payMode, setPayMode] = useState<PayMode>('CASH');
  const [payRemarks, setPayRemarks] = useState('');
  const [settleFor, setSettleFor] = useState<Investment | null>(null);
  const [confirmDel, setConfirmDel] = useState<Investment | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ACTIVE');
  // Deep link from the Dashboard's Profit KPI (?view=profit) opens the Business
  // Profit breakdown straight away. Read once as initial state, so closing the
  // dialog doesn't fight the URL.
  const [searchParams] = useSearchParams();
  const [profitOpen, setProfitOpen] = useState(() => searchParams.get('view') === 'profit');
  const [saving, setSaving] = useState(false);

  // ── persistence ───────────────────────────────────────────────────────────
  // API mode: the backend is the source of truth (it also writes the Expenses
  // row for every payout, atomically). Mock mode: localStorage, exactly as
  // before — so the page works either way and neither path is disturbed.
  useEffect(() => {
    if (!config.useApi) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await investmentApi.list();
        if (cancelled) return;
        setItems(list);
        // Keep the capital figure available to the SYNCHRONOUS funds guard on
        // the Dashboard and Loans pages (see activeInvestorCapital).
        cacheInvestorCapital(
          list.filter((i) => i.status === 'ACTIVE').reduce((s, i) => s + i.principal, 0),
        );
        // Payout history for every investment, so cycle funding and the
        // "paid so far" figures render without a per-card fetch.
        const all = await Promise.all(list.map((i) => investmentApi.listPayouts(i.id)));
        if (!cancelled) setPayouts(all.flat());
      } catch {
        if (!cancelled) toast('Could not load investments', 'error');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  // Mock mode only — never mirror server data into localStorage, or a stale
  // copy would resurface the next time the app starts in mock mode.
  useEffect(() => { if (!config.useApi) saveInvestments(items); }, [items]);
  useEffect(() => { if (!config.useApi) savePayouts(payouts); }, [payouts]);

  // The live record, so an open drawer reflects edits/payouts immediately.
  const liveDetail = detail ? items.find((i) => i.id === detail.id) ?? null : null;

  const totals = useMemo(() => investmentTotals(items, payouts), [items, payouts]);

  // ── Business profit ───────────────────────────────────────────────────────
  // The company's own money: interest realised on loans, less everything spent.
  // Uses the SHARED profitByLoan helper (same recognition as the Dashboard's
  // Profit KPI), so this card can never disagree with the dashboard.
  const profitData = useMemo(() => {
    const rows = profitByLoan(d.loans, d.collections);
    const earners = rows.filter((r) => r.interest > 0);
    const earned = earners.reduce((s, r) => s + r.interest, 0);
    const spent = d.expenses.reduce((s, e) => s + e.amount, 0);
    // Expenses grouped by category, biggest first — "where did it go?".
    const byCategory = new Map<string, number>();
    for (const e of d.expenses) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
    return {
      rows: earners,
      earned,
      spent,
      net: earned - spent,
      earningLoans: earners.length,
      expenseCount: d.expenses.length,
      categories: [...byCategory.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [d.loans, d.collections, d.expenses]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => {
        // Settled investments are history — they appear ONLY under Settled, so
        // the working list stays actionable.
        if (statusFilter === 'ACTIVE' && i.status !== 'ACTIVE') return false;
        if (statusFilter === 'CLOSED' && i.status !== 'CLOSED') return false;
        if (statusFilter === 'OVERDUE' && !(i.status === 'ACTIVE' && daysOverdue(i, payouts) > 0)) return false;
        if (!q) return true;
        return i.investorName.toLowerCase().includes(q)
          || i.code.toLowerCase().includes(q)
          || (i.mobile ?? '').includes(q);
      })
      // Attention first: overdue by longest, then active, then closed.
      .sort((a, b) => {
        const oa = a.status === 'ACTIVE' ? daysOverdue(a, payouts) : -1;
        const ob = b.status === 'ACTIVE' ? daysOverdue(b, payouts) : -1;
        if (oa !== ob) return ob - oa;
        if (a.status !== b.status) return a.status === 'ACTIVE' ? -1 : 1;
        return b.id - a.id;
      });
  }, [items, payouts, query, statusFilter]);

  const dueSoon = useMemo(
    () => items.filter((i) => i.status === 'ACTIVE' && daysOverdue(i, payouts) > 0),
    [items, payouts],
  );

  // ── create / edit ──────────────────────────────────────────────────────────
  const set = <K extends keyof IForm>(k: K, v: IForm[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const openCreate = () => { setErrors({}); setForm(blankForm()); };
  const openEdit = (inv: Investment) => {
    setErrors({});
    setForm({
      id: inv.id, investorName: inv.investorName, mobile: inv.mobile ?? '', email: inv.email ?? '',
      principal: String(inv.principal), rate: String(inv.rate), frequency: inv.frequency,
      startDate: inv.startDate, notes: inv.notes ?? '',
    });
  };

  const validate = (f: IForm): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!f.investorName.trim()) e.investorName = 'Investor name is required';
    const p = Number(f.principal);
    if (!f.principal.trim()) e.principal = 'Investment amount is required';
    else if (!(p > 0)) e.principal = 'Enter an amount greater than 0';
    else if (!Number.isInteger(p)) e.principal = 'Enter a whole rupee amount';
    else if (p > 100000000) e.principal = 'Amount is unrealistically large';
    const r = Number(f.rate);
    if (!f.rate.trim()) e.rate = 'Interest rate is required';
    else if (!(r > 0)) e.rate = 'Enter a rate greater than 0';
    else if (r > 100) e.rate = 'Rate cannot exceed 100%';
    if (f.mobile.trim() && !/^[6-9]\d{9}$/.test(f.mobile.trim())) e.mobile = 'Enter a valid 10-digit mobile';
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) e.email = 'Enter a valid email';
    if (!f.startDate) e.startDate = 'Start date is required';
    else if (f.startDate > todayISO()) e.startDate = 'Start date cannot be in the future';
    return e;
  };

  const saveForm = async () => {
    if (!form || saving) return;
    const e = validate(form);
    setErrors(e);
    if (Object.keys(e).length) { toast('Please fix the highlighted fields', 'error'); return; }
    const base = {
      investorName: form.investorName.trim(),
      mobile: form.mobile.trim() || undefined,
      email: form.email.trim() || undefined,
      principal: Number(form.principal),
      rate: Number(form.rate),
      frequency: form.frequency,
      startDate: form.startDate,
      notes: form.notes.trim() || undefined,
    };
    if (config.useApi) {
      // Await the server so a rejected write surfaces its real reason (its
      // validation is the authority) instead of a false success.
      setSaving(true);
      try {
        if (form.id) await investmentApi.update(form.id, base);
        else await investmentApi.create(base);
        toast(form.id ? 'Investment updated' : 'Investor added');
        reload();
        setForm(null);
      } catch (err) {
        toast(err instanceof ApiError ? err.message : 'Could not save the investment', 'error');
        return; // keep the form open so the user can correct it
      } finally {
        setSaving(false);
      }
      return;
    }
    if (form.id) {
      setItems((s) => s.map((i) => (i.id === form.id ? { ...i, ...base } : i)));
      toast('Investment updated');
    } else {
      const seq = nextSeq();
      setItems((s) => [{
        id: seq, code: investmentCode(seq), status: 'ACTIVE', createdAt: todayISO(), ...base,
      }, ...s]);
      toast('Investor added');
    }
    setForm(null);
  };

  // ── interest payout → auto-posts an EXPENSE ────────────────────────────────
  const openPay = (inv: Investment) => {
    setPayFor(inv);
    setPayAmount(String(interestDue(inv, payouts) || interestPerCycle(inv)));
    setPayDate(payoutDefaultDate(inv));
    setPayMode('CASH');
    setPayRemarks('');
  };

  // Always validate against the LIVE record — `payFor` is a snapshot from when
  // the dialog opened, so an edit in between would leave the tiles and the
  // ceiling disagreeing (the cause of a bogus "more than one cycle" error).
  const payLive = payFor ? items.find((i) => i.id === payFor.id) ?? payFor : null;
  const payAmtNum = Number(payAmount);
  // Ceiling: everything accrued but unpaid, PLUS one full cycle in advance.
  // Paying a cycle upfront is legitimate (day-one payouts included), so the
  // bound must never be below one cycle.
  const payCeiling = payLive
    ? Math.max(0, accruedInterest(payLive) - totalPaid(payLive.id, payouts)) + interestPerCycle(payLive)
    : 0;
  const payError = payAmount === '' ? ''
    : !(payAmtNum > 0) ? 'Enter an amount greater than 0'
      : !Number.isInteger(payAmtNum) ? 'Enter a whole rupee amount'
        : payLive && payAmtNum > payCeiling
          ? `More than one cycle ahead — max ${inr(payCeiling)}`
          : '';

  const savePayout = async () => {
    if (!payLive || saving) return;
    if (!payAmtNum) { toast('Enter an amount', 'error'); return; }
    if (payError) { toast(payError, 'error'); return; }
    if (payDate < payLive.startDate) {
      toast(`Payout cannot predate the investment (${fmtDate(payLive.startDate)})`, 'error'); return;
    }
    if (payDate > todayISO()) { toast('Payout date cannot be in the future', 'error'); return; }
    setSaving(true);
    if (config.useApi) {
      // The SERVER writes the payout AND its Expenses row in one transaction,
      // so the frontend must NOT post the expense itself — doing both would
      // double-count the cost. The server also re-checks the cycle ceiling.
      try {
        await investmentApi.payInterest(payLive.id, {
          amount: payAmtNum, date: payDate, mode: payMode,
          remarks: payRemarks.trim() || undefined,
        });
        // The SERVER created the expense, so DataContext's cached expense list
        // knows nothing about it — refresh, or Expenses/Profit/Available Funds
        // would all under-report until the next full reload.
        await d.refreshExpenses();
        toast('Interest paid — posted to Expenses');
        reload();
        setPayFor(null);
      } catch (err) {
        toast(err instanceof ApiError ? err.message : 'Could not record the payout', 'error');
      } finally {
        setSaving(false);
      }
      return;
    }
    try {
      // MOCK MODE: no server transaction, so post the EXPENSE first and await
      // it — a failed post must never leave a payout with no matching expense
      // (which would understate costs).
      await d.addExpense({
        date: payDate,
        category: INVESTOR_EXPENSE_CATEGORY,
        subCategory: payLive.frequency === 'MONTHLY' ? 'Monthly interest' : 'Yearly interest',
        name: investorExpenseName(payLive),
        amount: payAmtNum,
        mode: payMode,
        remarks: payRemarks.trim() || undefined,
      });
      const seq = nextSeq();
      setPayouts((s) => [{
        id: seq, investmentId: payLive.id, date: payDate, amount: payAmtNum,
        mode: payMode, remarks: payRemarks.trim() || undefined,
      }, ...s]);
      toast('Interest paid — posted to Expenses');
      setPayFor(null);
    } catch {
      toast('Could not post the expense — payout not recorded', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── settle (return the principal) ──────────────────────────────────────────
  // Returning capital is NOT an expense — it repays money we received. Posting
  // it would create a false cost spike in profit reports. (The server applies
  // the same rule; see investment.Service.Settle.)
  const doSettle = async () => {
    if (!settleFor || saving) return;
    if (config.useApi) {
      setSaving(true);
      try {
        await investmentApi.settle(settleFor.id);
        toast('Investment settled and closed');
        reload();
        setSettleFor(null);
        setDetail(null);
      } catch (err) {
        toast(err instanceof ApiError ? err.message : 'Could not settle the investment', 'error');
      } finally {
        setSaving(false);
      }
      return;
    }
    setItems((s) => s.map((i) => (
      i.id === settleFor.id ? { ...i, status: 'CLOSED' as const, settledDate: todayISO() } : i
    )));
    toast('Investment settled and closed');
    setSettleFor(null);
    setDetail(null);
  };

  const doDelete = async () => {
    if (!confirmDel || saving) return;
    if (config.useApi) {
      setSaving(true);
      try {
        await investmentApi.remove(confirmDel.id);
        toast('Investment removed — posted expenses were kept');
        reload();
        setConfirmDel(null);
        setDetail(null);
      } catch (err) {
        toast(err instanceof ApiError ? err.message : 'Could not remove the investment', 'error');
      } finally {
        setSaving(false);
      }
      return;
    }
    setItems((s) => s.filter((i) => i.id !== confirmDel.id));
    setPayouts((s) => s.filter((p) => p.investmentId !== confirmDel.id));
    toast('Investment removed — posted expenses were kept');
    setConfirmDel(null);
    setDetail(null);
  };

  // Live preview inside the create form — shows exactly what will accrue.
  const preview = useMemo(() => {
    if (!form) return null;
    const p = Number(form.principal); const r = Number(form.rate);
    if (!(p > 0) || !(r > 0)) return null;
    const per = Math.round((p * r) / 100);
    return {
      per,
      perLabel: form.frequency === 'MONTHLY' ? 'per month' : 'per year',
      annual: form.frequency === 'MONTHLY' ? per * 12 : per,
      first: firstPayoutDate(form.startDate, form.frequency),
    };
  }, [form]);

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        icon={<Landmark size={20} />}
        title="Investments"
        subtitle="Investor capital and the interest it costs"
        actions={editable ? <HeaderPrimaryButton onClick={openCreate} icon={<Plus size={16} />}>Add Investor</HeaderPrimaryButton> : undefined}
      />

      <div className="flex flex-1 flex-col gap-5 p-3.5 sm:px-5">
        {/* ── Hero: the one number that matters (capital deployed) plus the
            cost of carrying it, on the brand gradient. */}
        {items.length > 0 && (
          <div className="anim-pop relative overflow-hidden rounded-card bg-gradient-to-br from-[#022999] via-[#0538cc] to-[#0AA8F8] px-5 py-5 text-white shadow-[0_20px_44px_-24px_rgba(5,56,204,.8)]">
            <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-white/15 blur-3xl" />
            <div aria-hidden className="pointer-events-none absolute -bottom-20 left-1/4 h-40 w-40 rounded-full bg-sky-300/20 blur-3xl" />
            <div className="relative flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
              <div className="min-w-0">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/70">Capital deployed</div>
                <div className="mt-1 font-display text-[30px] font-bold leading-none tabular-nums sm:text-[34px]">{inr(totals.capital)}</div>
                <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-white/85">
                  <span>{totals.activeCount} active {totals.activeCount === 1 ? 'investment' : 'investments'}</span>
                  <span aria-hidden className="opacity-50">·</span>
                  <span>{totals.investors} {totals.investors === 1 ? 'investor' : 'investors'}</span>
                </div>
              </div>
              {/* Carry cost + what's owed, as glass tiles */}
              <div className="flex flex-wrap gap-2.5">
                <div className="rounded-xl bg-white/15 px-3.5 py-2.5 ring-1 ring-white/20 backdrop-blur-sm">
                  <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/70">Monthly carry</div>
                  <div className="mt-0.5 font-display text-[17px] font-bold leading-none tabular-nums">{inr(totals.monthlyOutgo)}</div>
                </div>
                <div className={cn(
                  'rounded-xl px-3.5 py-2.5 ring-1 backdrop-blur-sm',
                  totals.interestDue > 0 ? 'bg-rose-400/25 ring-rose-200/30' : 'bg-white/15 ring-white/20',
                )}>
                  <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/75">Interest due</div>
                  <div className="mt-0.5 font-display text-[17px] font-bold leading-none tabular-nums">{inr(totals.interestDue)}</div>
                </div>
                <div className="rounded-xl bg-white/15 px-3.5 py-2.5 ring-1 ring-white/20 backdrop-blur-sm">
                  <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/70">Paid to date</div>
                  <div className="mt-0.5 font-display text-[17px] font-bold leading-none tabular-nums">{inr(totals.interestPaid)}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* KPI strip — figures that COMPLEMENT the hero (which already shows
            capital, monthly carry, due and paid), so nothing is stated twice. */}
        {items.length > 0 && (
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <StatCard label="Investors" value={String(totals.investors)} accent="#6366f1" icon={<Landmark size={16} />} />
            <StatCard label="Annual interest cost" value={inrShort(totals.monthlyOutgo * 12)} accent="#f59e0b" icon={<TrendingDown size={16} />} />
            {totals.overdueCount > 0 ? (
              <StatCard label="Awaiting payout" value={String(totals.overdueCount)} accent="#ef4444" icon={<AlertTriangle size={16} />} active />
            ) : (
              <StatCard label="Awaiting payout" value="0" accent="#10b981" icon={<CheckCircle2 size={16} />} />
            )}
            <StatCard label="Settled investments" value={String(items.length - totals.activeCount)} accent="#8b5cf6" icon={<CheckCircle2 size={16} />} />
          </div>
        )}

        {/* ── Business profit — the company's OWN money, sitting alongside
            investor capital. Read-only by design: it is derived from loans and
            expenses, never entered, so there is nothing here to edit. Rendered
            outside the investor grid because profit exists whether or not any
            investor does. ── */}
        <button
          type="button"
          onClick={() => setProfitOpen(true)}
          aria-label={`Business profit ${inr(profitData.net)} — view the loans and expenses behind it`}
          className="anim-pop group relative w-full overflow-hidden rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50 via-white to-teal-50/60 p-0 text-left shadow-card transition-all hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-20px_rgba(16,185,129,.45)] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:border-emerald-500/20 dark:from-emerald-500/[.08] dark:via-surface dark:to-teal-500/[.05]"
        >
          <span aria-hidden className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-emerald-300/20 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3.5">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-sm">
                <PiggyBank size={22} />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-emerald-700/80 dark:text-emerald-300/80">Business profit</span>
                  <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">Own funds</span>
                </div>
                <div className={cn(
                  'mt-1 font-display text-[26px] font-bold leading-none tabular-nums',
                  profitData.net < 0 ? 'text-danger' : 'text-emerald-700 dark:text-emerald-300',
                )}>
                  {inr(profitData.net)}
                </div>
                <div className="mt-1.5 text-[11.5px] text-muted">
                  {inr(profitData.earned)} interest earned − {inr(profitData.spent)} expenses
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">From loans</div>
                <div className="mt-0.5 font-display text-[15px] font-bold tabular-nums text-ink">{profitData.earningLoans}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">Expenses</div>
                <div className="mt-0.5 font-display text-[15px] font-bold tabular-nums text-ink">{profitData.expenseCount}</div>
              </div>
              <span className="flex items-center gap-1 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300">
                Details <ChevronRight size={15} className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </div>
          </div>
        </button>

        {/* Attention strip — only when something is genuinely overdue */}
        {dueSoon.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border-[0.5px] border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/25 dark:bg-amber-500/10">
            <AlertTriangle size={16} className="shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="text-[13px] font-semibold text-amber-800 dark:text-amber-200">
              {dueSoon.length} investor{dueSoon.length === 1 ? '' : 's'} awaiting interest
            </span>
            <span className="text-[12.5px] text-amber-700/80 dark:text-amber-200/70">
              {inr(dueSoon.reduce((s, i) => s + interestDue(i, payouts), 0))} outstanding
            </span>
            <button
              onClick={() => setStatusFilter('OVERDUE')}
              className="ml-auto text-[12.5px] font-bold text-amber-800 underline-offset-2 hover:underline dark:text-amber-200"
            >
              Review
            </button>
          </div>
        )}

        {/* Status filter chips — same gradient pill + count badge as Collections */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {([
              // No "All" chip: with settled investments excluded from the
              // working list, it was identical to Active.
              { k: 'ACTIVE', label: 'Active', n: totals.activeCount },
              { k: 'OVERDUE', label: 'Interest due', n: totals.overdueCount },
              { k: 'CLOSED', label: 'Settled', n: items.length - totals.activeCount },
            ] as { k: StatusFilter; label: string; n: number }[]).map((t) => {
              const on = statusFilter === t.k;
              return (
                <button
                  key={t.k}
                  onClick={() => setStatusFilter(t.k)}
                  className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${
                    on
                      ? 'bg-gradient-to-r from-blue-700 to-blue-500 text-white shadow-[0_4px_14px_rgba(37,99,235,.35)]'
                      : 'border border-slate-200/90 bg-white text-muted hover:border-primary/40 hover:text-primary dark:border-white/[.07] dark:bg-surface dark:hover:bg-white/[.05]'
                  }`}
                >
                  {t.label}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${on ? 'bg-white/25' : 'bg-slate-100 text-muted dark:bg-white/[.08]'}`}>{t.n}</span>
                </button>
              );
            })}
          </div>
          <div className="flex w-full items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-3.5 py-2 focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 sm:w-64 dark:border-white/[.07] dark:bg-surface">
            <Search size={16} className="shrink-0 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search investor, code, mobile…"
              className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-muted"
            />
          </div>
        </div>

        {/* Register */}
        {rows.length === 0 ? (
          <div className="anim-pop flex flex-col items-center gap-3 rounded-card border border-slate-200/90 bg-white px-6 py-16 text-center shadow-card dark:border-white/[.07] dark:bg-surface">
            <div className="anim-float grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-primary-400 to-primary text-white shadow-soft"><Inbox size={30} /></div>
            <div className="font-display text-lg font-bold">
              {items.length === 0 ? 'No investors yet'
                : statusFilter === 'CLOSED' ? 'Nothing settled yet'
                  : totals.activeCount === 0 ? 'No active investments'
                    : 'Nothing in this view'}
            </div>
            <p className="max-w-sm text-sm text-muted">
              {items.length === 0
                ? 'Add an investor to track the capital they put in and the interest it costs.'
                : statusFilter === 'CLOSED'
                  ? 'No investments have been settled yet.'
                  : totals.activeCount === 0
                    // Don't leave the user thinking their data vanished: say
                    // where the settled ones went.
                    ? `All ${items.length} ${items.length === 1 ? 'investment is' : 'investments are'} settled — see the Settled tab.`
                    : 'No investments match this filter.'}
            </p>
            {items.length === 0 && editable && (
              <Button onClick={openCreate}><Plus size={16} /> Add first investor</Button>
            )}
            {items.length > 0 && totals.activeCount === 0 && statusFilter !== 'CLOSED' && (
              <Button variant="ghost" onClick={() => setStatusFilter('CLOSED')}>View settled</Button>
            )}
            {statusFilter === 'CLOSED' && totals.activeCount > 0 && (
              <Button variant="ghost" onClick={() => setStatusFilter('ACTIVE')}>Back to active</Button>
            )}
          </div>
        ) : (
          <>
          {/* ── Investor register — a responsive CARD GRID, not a data table. A
              plain 8-column table flattened everything that matters (urgency,
              cadence, payout progress) into equal-weight text; cards give each
              investment a hierarchy and show its state at a glance. ── */}
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((inv, idx) => (
              <InvestorCard
                key={inv.id}
                inv={inv}
                payouts={payouts}
                delay={Math.min(idx, 8) * 45}
                onOpen={() => setDetail(inv)}
                onPay={editable && inv.status === 'ACTIVE' ? () => openPay(inv) : undefined}
                onEdit={editable && inv.status === 'ACTIVE' ? () => openEdit(inv) : undefined}
              />
            ))}
          </div>

          <p className="px-1 text-[11.5px] text-muted">
            Interest due is what has accrued to date less what has been paid. Open an investor for the full interest-cycle ledger. Every payout is posted to Expenses under “{INVESTOR_EXPENSE_CATEGORY}”.
          </p>

          </>
        )}
      </div>

      {/* ── Business profit breakdown — where it came from, where it went ─── */}
      <Dialog
        wide
        open={profitOpen}
        onClose={() => setProfitOpen(false)}
        title="Business Profit"
        subtitle="Interest earned on loans, less everything spent"
        footer={<Button onClick={() => setProfitOpen(false)}>Close</Button>}
      >
        <div className="space-y-4">
          {/* Headline equation, so the net figure is auditable at a glance */}
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { k: 'Interest earned', v: inr(profitData.earned), tone: 'text-emerald-600 dark:text-emerald-400' },
              { k: 'Expenses', v: inr(profitData.spent), tone: 'text-danger' },
              { k: 'Net profit', v: inr(profitData.net), tone: profitData.net < 0 ? 'text-danger' : 'text-ink', hi: true },
            ].map((s) => (
              <div key={s.k} className={cn(
                'rounded-xl border-[0.5px] px-3.5 py-3',
                s.hi ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/25 dark:bg-emerald-500/[.08]'
                  : 'border-slate-200/80 bg-slate-50/60 dark:border-white/[.08] dark:bg-white/[.02]',
              )}>
                <div className="text-[10px] font-bold uppercase tracking-wide text-muted">{s.k}</div>
                <div className={cn('mt-1 font-display text-[17px] font-bold tabular-nums', s.tone)}>{s.v}</div>
              </div>
            ))}
          </div>

          {/* Where the profit CAME FROM */}
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-muted">Profit earned from loans</h4>
              <span className="text-[11.5px] text-muted">{profitData.rows.length} {profitData.rows.length === 1 ? 'loan' : 'loans'}</span>
            </div>
            <div className="max-h-64 overflow-auto rounded-xl border-[0.5px] border-slate-200/80 dark:border-white/[.08]">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-slate-100 [&>th]:px-3 [&>th]:py-2.5 dark:[&>th]:bg-slate-800">
                    <th>Loan</th><th>Type</th><th className="text-right">Collected</th><th className="text-right">Profit</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {profitData.rows.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-muted">No profit realised yet — it appears as borrowers repay beyond the disbursed amount.</td></tr>
                  ) : profitData.rows.map((r) => (
                    <tr key={r.loan.id} className="border-t border-slate-100 dark:border-white/[.06]">
                      <td className="whitespace-nowrap px-3 py-2">
                        <div className="font-mono text-xs text-ink">{r.loan.loanNumber}</div>
                        <div className="text-[11px] text-muted">{d.customers.find((c) => c.id === r.loan.customerId)?.name ?? '—'}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-[12px] text-ink/80">{LOAN_LABELS[r.loan.type]}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink/80">{inr(r.collected)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{inr(r.interest)}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <Badge tone={r.loan.status === 'CLOSED' ? 'ok' : 'info'}>{r.loan.status === 'CLOSED' ? 'Closed' : 'Active'}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {profitData.rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50/80 dark:border-white/[.1] dark:bg-white/[.03]">
                      <td className="px-3 py-2.5 text-[12px] font-bold uppercase tracking-wide text-muted" colSpan={3}>Total earned</td>
                      <td className="px-3 py-2.5 text-right font-display text-[14px] font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{inr(profitData.earned)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Where it WENT */}
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-muted">Spent from profit</h4>
              <span className="text-[11.5px] text-muted">{profitData.expenseCount} {profitData.expenseCount === 1 ? 'expense' : 'expenses'}</span>
            </div>
            {/* Category summary first — the shape of spending before the detail */}
            {profitData.categories.length > 0 && (
              <div className="mb-2.5 flex flex-wrap gap-2">
                {profitData.categories.map(([cat, amt]) => (
                  <span key={cat} className="inline-flex items-center gap-1.5 rounded-full border-[0.5px] border-slate-200/80 bg-white px-2.5 py-1 text-[11.5px] dark:border-white/[.08] dark:bg-white/[.02]">
                    <span className="text-muted">{cat}</span>
                    <span className="font-bold tabular-nums text-ink">{inr(amt)}</span>
                  </span>
                ))}
              </div>
            )}
            <div className="max-h-56 overflow-auto rounded-xl border-[0.5px] border-slate-200/80 dark:border-white/[.08]">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-slate-100 [&>th]:px-3 [&>th]:py-2.5 dark:[&>th]:bg-slate-800">
                    <th>Date</th><th>Category</th><th>Name</th><th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {d.expenses.length === 0 ? (
                    <tr><td colSpan={4} className="px-3 py-8 text-center text-muted">No expenses recorded.</td></tr>
                  ) : [...d.expenses]
                    .sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1))
                    .map((e) => (
                      <tr key={e.id} className="border-t border-slate-100 dark:border-white/[.06]">
                        <td className="whitespace-nowrap px-3 py-2">{fmtDate(e.date)}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <Badge tone={e.category === INVESTOR_EXPENSE_CATEGORY ? 'warn' : 'neutral'}>{e.category}</Badge>
                        </td>
                        <td className="px-3 py-2 text-ink/80">{e.name}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-danger">{inr(e.amount)}</td>
                      </tr>
                    ))}
                </tbody>
                {d.expenses.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50/80 dark:border-white/[.1] dark:bg-white/[.03]">
                      <td className="px-3 py-2.5 text-[12px] font-bold uppercase tracking-wide text-muted" colSpan={3}>Total spent</td>
                      <td className="px-3 py-2.5 text-right font-display text-[14px] font-bold tabular-nums text-danger">{inr(profitData.spent)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <p className="text-[11.5px] leading-snug text-muted">
            Profit is recognised as money is <span className="font-semibold text-ink">collected</span>, not when a loan is created:
            for daily/EMI loans the first {`₹`}disbursed repaid is your own capital returning, and only the surplus is profit.
            Every expense — including investor interest — is spent from this profit.
          </p>
        </div>
      </Dialog>

      {/* ── Create / edit investor ─────────────────────────────────────────── */}
      <Dialog
        open={!!form}
        onClose={() => setForm(null)}
        wide
        title={form?.id ? 'Edit investment' : 'Add investor'}
        subtitle="Capital received from an investor, and the interest it earns them"
        footer={<>
          <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
          <Button onClick={saveForm}>{form?.id ? 'Save changes' : <><Plus size={15} /> Add investor</>}</Button>
        </>}
      >
        {form && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Investor name *" placeholder="Full name" value={form.investorName} onChange={(e) => set('investorName', e.target.value)} error={errors.investorName} />
              <Input label="Mobile" placeholder="10-digit mobile" inputMode="numeric" value={form.mobile} onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} error={errors.mobile} />
            </div>
            <Input label="Email" placeholder="Optional" value={form.email} onChange={(e) => set('email', e.target.value)} error={errors.email} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input label="Investment amount *" placeholder="0" inputMode="numeric" value={form.principal} onChange={(e) => set('principal', e.target.value.replace(/[^0-9]/g, '').slice(0, 10))} error={errors.principal} />
              <Input label="Interest rate % *" placeholder="0" inputMode="decimal" value={form.rate} onChange={(e) => set('rate', e.target.value.replace(/[^0-9.]/g, '').slice(0, 6))} error={errors.rate} />
              <Select
                label="Payout frequency *"
                value={form.frequency}
                onChange={(e) => set('frequency', e.target.value as PayoutFrequency)}
                options={[
                  { value: 'MONTHLY', label: 'Monthly interest' },
                  { value: 'YEARLY', label: 'Yearly interest' },
                ]}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Start date *" type="date" max={todayISO()} value={form.startDate} onChange={(e) => set('startDate', e.target.value)} error={errors.startDate} />
              <Input label="Notes" placeholder="Optional" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </div>

            {/* Live preview — the rate is PER CYCLE, so spell out what that means */}
            {preview && (
              <div className="rounded-xl border-[0.5px] border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-white/[.08] dark:bg-white/[.02]">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">What this costs</div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div>
                    <div className="text-[11px] text-muted">Interest {preview.perLabel}</div>
                    <div className="font-display text-[16px] font-bold tabular-nums text-ink">{inr(preview.per)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted">Cost per year</div>
                    <div className="font-display text-[16px] font-bold tabular-nums text-ink">{inr(preview.annual)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted">First payout due</div>
                    <div className="font-display text-[16px] font-bold text-ink">{fmtDate(preview.first)}</div>
                  </div>
                </div>
                <p className="mt-2 text-[11.5px] leading-snug text-muted">
                  The rate is <span className="font-semibold text-ink">per {form.frequency === 'MONTHLY' ? 'month' : 'year'}</span>.
                  Principal stays outstanding until you settle; each interest payout is posted to Expenses under “{INVESTOR_EXPENSE_CATEGORY}”.
                </p>
              </div>
            )}
          </div>
        )}
      </Dialog>

      {/* ── Detail drawer: cycle schedule + payout history ─────────────────── */}
      <Dialog
        open={!!liveDetail}
        onClose={() => setDetail(null)}
        xl
        title={liveDetail ? `Interest Ledger · ${liveDetail.code}` : ''}
        subtitle={liveDetail ? `${liveDetail.frequency === 'MONTHLY' ? 'Monthly' : 'Yearly'} Interest · ${liveDetail.rate}% per ${liveDetail.frequency === 'MONTHLY' ? 'month' : 'year'}` : ''}
        footer={<>
          {liveDetail && editable && liveDetail.status === 'ACTIVE' && (
            <>
              <Button variant="ghost" onClick={() => setConfirmDel(liveDetail)} title="Remove this investment"><Trash2 size={15} /> Delete</Button>
              <Button variant="ghost" onClick={() => openEdit(liveDetail)} title="Edit investor details"><Pencil size={15} /> Edit</Button>
            </>
          )}
          <Button onClick={() => setDetail(null)}>Close</Button>
        </>}
      >
        {liveDetail && (() => {
          const per = interestPerCycle(liveDetail);
          const due = interestDue(liveDetail, payouts);
          const paid = totalPaid(liveDetail.id, payouts);
          const cycles = buildCycles(liveDetail, payouts);
          const mine = payouts.filter((p) => p.investmentId === liveDetail.id)
            .sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1));
          const elapsed = cyclesElapsed(liveDetail);
          const cadenceWord = liveDetail.frequency === 'MONTHLY' ? 'monthly' : 'yearly';
          // Same 5-card shape the interest-only loan ledger uses (Principal /
          // per-cycle / collected / due / outstanding), reworded for an investor.
          const settledCycles = per > 0 ? Math.min(Math.floor(paid / per), elapsed) : 0;
          const pct = elapsed > 0 ? Math.min(100, Math.round((settledCycles / elapsed) * 100)) : 0;
          const summaryCards = [
            { k: 'Capital', v: inr(liveDetail.principal), sub: 'Repayable at settlement', icon: Landmark, accent: 'indigo' as const },
            { k: `${liveDetail.frequency === 'MONTHLY' ? 'Monthly' : 'Yearly'} Interest`, v: inr(per), sub: 'Per cycle', icon: TrendingDown, accent: 'sky' as const },
            { k: 'Interest Paid', v: inr(paid), sub: 'Posted to Expenses', icon: HandCoins, accent: 'emerald' as const },
            { k: 'Interest Due', v: inr(due), sub: 'Accrued, unpaid', icon: AlertTriangle, accent: due > 0 ? ('rose' as const) : ('slate' as const) },
            { k: 'Total Payable', v: inr((liveDetail.status === 'CLOSED' ? 0 : liveDetail.principal) + due), sub: 'Capital + interest', icon: Wallet, accent: 'amber' as const },
          ];
          const ACCENT = {
            indigo: { bar: 'bg-indigo-500', chip: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300', val: 'text-ink' },
            sky: { bar: 'bg-sky-500', chip: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300', val: 'text-ink' },
            emerald: { bar: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300', val: 'text-emerald-600 dark:text-emerald-400' },
            rose: { bar: 'bg-rose-500', chip: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300', val: 'text-danger' },
            slate: { bar: 'bg-slate-300 dark:bg-white/20', chip: 'bg-slate-100 text-slate-500 dark:bg-white/[.08] dark:text-slate-300', val: 'text-muted' },
            amber: { bar: 'bg-amber-500', chip: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300', val: 'text-amber-600 dark:text-amber-400' },
          };
          return (
            <>
              {/* ── Hero band — brand gradient with the investor identity, the
                  headline figure, and a live status pill. */}
              <div className="anim-pop relative mb-4 overflow-hidden rounded-2xl bg-gradient-to-br from-[#022999] via-[#0538cc] to-[#0AA8F8] px-5 py-4 text-white shadow-[0_18px_40px_-22px_rgba(5,56,204,.75)]">
                <div aria-hidden className="pointer-events-none absolute -right-12 -top-20 h-48 w-48 rounded-full bg-white/15 blur-3xl" />
                <div aria-hidden className="pointer-events-none absolute -bottom-16 left-1/3 h-32 w-32 rounded-full bg-sky-300/20 blur-2xl" />
                <div className="relative flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3.5">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/20 font-display text-[15px] font-bold ring-1 ring-white/30 backdrop-blur-sm">
                      {initials(liveDetail.investorName)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-display text-[19px] font-bold leading-tight">{liveDetail.investorName}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-white/85">
                        <span className="inline-flex items-center gap-1"><Phone size={11} /> {liveDetail.mobile || '—'}</span>
                        <span aria-hidden className="opacity-50">·</span>
                        <span className="font-mono">{liveDetail.code}</span>
                        <span aria-hidden className="opacity-50">·</span>
                        <span>since {fmtDate(liveDetail.startDate)}</span>
                      </div>
                    </div>
                  </div>
                  {/* Headline: what we owe right now */}
                  <div className="text-right">
                    <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/70">
                      {liveDetail.status === 'CLOSED' ? 'Settled' : 'Payable today'}
                    </div>
                    <div className="mt-0.5 font-display text-[22px] font-bold leading-none tabular-nums">
                      {inr((liveDetail.status === 'CLOSED' ? 0 : liveDetail.principal) + due)}
                    </div>
                    <span className={cn(
                      'mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold backdrop-blur-sm',
                      liveDetail.status === 'CLOSED' ? 'bg-emerald-400/25 text-emerald-50'
                        : due > 0 ? 'bg-rose-400/30 text-rose-50' : 'bg-white/20 text-white',
                    )}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {liveDetail.status === 'CLOSED'
                        ? `Closed ${liveDetail.settledDate ? fmtDate(liveDetail.settledDate) : ''}`
                        : due > 0 ? `${inr(due)} interest due` : 'On schedule'}
                    </span>
                  </div>
                </div>
              </div>

              {/* ── Summary cards — accent bar + icon chip, equal heights */}
              <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                {summaryCards.map((c) => {
                  const a = ACCENT[c.accent];
                  const Icon = c.icon;
                  return (
                    <div
                      key={c.k}
                      title={c.sub}
                      className="group relative flex flex-col overflow-hidden rounded-xl border-[0.5px] border-slate-200/80 bg-white px-3.5 pb-3 pt-3.5 transition-all hover:-translate-y-px hover:shadow-[0_8px_24px_-14px_rgba(30,39,64,.35)] dark:border-white/[.07] dark:bg-white/[.02]"
                    >
                      <span aria-hidden className={cn('absolute inset-x-0 top-0 h-[3px]', a.bar)} />
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-h-[28px] items-start text-[10px] font-bold uppercase leading-[1.3] tracking-[0.04em] text-muted">{c.k}</div>
                        <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-lg transition-transform group-hover:scale-110', a.chip)}>
                          <Icon size={12} />
                        </span>
                      </div>
                      <div className={cn('mt-auto font-display text-[18px] font-bold leading-none tabular-nums', a.val)}>{c.v}</div>
                      <div className="mt-1.5 h-[13px] truncate text-[10px] leading-none text-muted">{c.sub}</div>
                    </div>
                  );
                })}
              </div>

              {/* ── Payout progress — designed block with a ring-style readout */}
              {liveDetail.status === 'ACTIVE' && elapsed > 0 && (
                <div className="mb-5 overflow-hidden rounded-xl border-[0.5px] border-slate-200/80 bg-gradient-to-br from-slate-50 to-white p-4 dark:border-white/[.07] dark:from-white/[.03] dark:to-transparent">
                  <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-muted">Interest Payout Progress</div>
                    <div className="flex items-center gap-2 text-[11.5px]">
                      <span className="font-display text-[15px] font-bold tabular-nums text-ink">{settledCycles}</span>
                      <span className="text-muted">of {elapsed} {liveDetail.frequency === 'MONTHLY' ? 'months' : 'years'} settled</span>
                      <span className={cn(
                        'rounded-full px-2 py-0.5 text-[10.5px] font-bold',
                        pct === 100 ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300'
                          : 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
                      )}>{pct}%</span>
                    </div>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/[.08]">
                    <div
                      className={cn(
                        'h-full rounded-full transition-[width] duration-500',
                        pct === 100 ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' : 'bg-gradient-to-r from-[#0538cc] to-[#0AA8F8]',
                      )}
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                  {due > 0 && (
                    <div className="mt-2 text-[11.5px] text-muted">
                      <span className="font-semibold text-danger">{inr(due)}</span> owed across {elapsed - settledCycles} unpaid {elapsed - settledCycles === 1 ? 'cycle' : 'cycles'}
                    </div>
                  )}
                </div>
              )}

              {/* Context line + actions — same bar as the ledger */}
              <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1 basis-[260px] text-sm text-muted">
                  Interest payouts since {fmtDate(liveDetail.startDate)} · {cadenceWord} · capital stays until settled
                </div>
                {editable && liveDetail.status === 'ACTIVE' && (
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    {due > 0 && (
                      <Button onClick={() => openPay(liveDetail)} className="!bg-warning-600 !px-3 !py-1.5 text-xs whitespace-nowrap transition-transform hover:scale-105 hover:!bg-warning-600/90" title={`Pay the interest owed to date (${inr(due)}) — posted to Expenses`}>
                        Pay Interest · {inr(due)}
                      </Button>
                    )}
                    <Button onClick={() => setSettleFor(liveDetail)} className="!bg-emerald-600 !px-3 !py-1.5 text-xs whitespace-nowrap transition-transform hover:scale-105" title={`Return the capital (${inr(liveDetail.principal)}) and close this investment`}>
                      Settle &amp; close · {inr(liveDetail.principal + due)}
                    </Button>
                  </div>
                )}
              </div>

              {/* Interest cycle ledger — one row per cycle */}
              <div className="overflow-hidden rounded-xl border-[0.5px] border-slate-200/80 dark:border-white/[.07]">
                <div className="max-h-96 overflow-auto">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead>
                      <tr className="text-left text-[11px] font-bold uppercase tracking-[0.06em] text-white [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-gradient-to-r [&>th]:from-[#022999] [&>th]:via-[#0538cc] [&>th]:to-[#0AA8F8] [&>th]:px-3.5 [&>th]:py-3">
                        <th>{liveDetail.frequency === 'MONTHLY' ? 'Month' : 'Year'}</th>
                        <th>Due Date</th>
                        <th>Interest Due</th>
                        <th>Amount Paid</th>
                        <th>Status</th>
                        <th className="text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cycles.map((c) => {
                        const border = c.status === 'Paid' ? 'border-l-success'
                          : c.status === 'Partial' ? 'border-l-warning'
                            : c.status === 'Overdue' ? 'border-l-danger' : 'border-l-primary';
                        const tint = c.status === 'Overdue' ? 'bg-rose-50/50 dark:bg-rose-500/[.05]'
                          : c.status === 'Upcoming' ? 'bg-primary-50/40 dark:bg-primary/[.05]' : '';
                        return (
                          <tr
                            key={c.sn}
                            className={cn(
                              'border-t border-l-4 border-slate-100 transition-colors hover:bg-slate-50/80 dark:border-white/[.06] dark:hover:bg-white/[.03]',
                              border, tint,
                            )}
                          >
                            <td className="px-3.5 py-2.5 font-semibold tabular-nums text-muted">{c.sn}</td>
                            <td className="whitespace-nowrap px-3.5 py-2.5">
                              {fmtDate(c.dueDate)}
                              {c.dueDate === todayISO() && <span className="ml-1.5 text-[10px] font-bold text-primary">• today</span>}
                            </td>
                            <td className="px-3.5 py-2.5 tabular-nums">{inr(c.due)}</td>
                            <td className={cn('px-3.5 py-2.5 font-semibold tabular-nums', c.paid ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted')}>
                              {c.paid ? inr(c.paid) : '—'}
                            </td>
                            <td className="whitespace-nowrap px-3.5 py-2.5">
                              <Badge tone={c.status === 'Paid' ? 'ok' : c.status === 'Partial' ? 'warn' : c.status === 'Overdue' ? 'err' : 'info'}>
                                <span className="whitespace-nowrap">{c.status === 'Upcoming' ? 'Next due' : c.status}</span>
                              </Badge>
                            </td>
                            <td className="px-3.5 py-2.5 text-right">
                              {editable && liveDetail.status === 'ACTIVE' && c.status !== 'Paid' ? (
                                <Button variant="success" onClick={() => openPay(liveDetail)} className="!px-2.5 !py-1 !text-[11px] whitespace-nowrap" title={`Pay interest for cycle ${c.sn}`}>
                                  <Plus size={11} /> Pay
                                </Button>
                              ) : <span className="text-muted">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                      {cycles.length === 0 && (
                        <tr><td colSpan={6} className="px-3.5 py-8 text-center text-muted">No interest cycles yet — the first falls due {fmtDate(cycleDueDate(liveDetail, 1))}.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Payout receipts */}
              <div className="mt-4">
                <div className="mb-2 flex items-baseline justify-between">
                  <h4 className="text-[11px] font-bold uppercase tracking-wide text-muted">Payout history</h4>
                  <span className="text-[11.5px] text-muted">posted to Expenses · {INVESTOR_EXPENSE_CATEGORY}</span>
                </div>
                <div className="max-h-56 overflow-auto rounded-xl border border-slate-100 dark:border-white/[.06]">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-muted [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-slate-100 [&>th]:px-3 [&>th]:py-2.5 dark:[&>th]:bg-slate-800">
                        <th>Date</th><th>Amount</th><th>Payment Mode</th><th>Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mine.length === 0 ? (
                        <tr><td colSpan={4} className="px-3 py-6 text-center text-muted">No interest paid yet.</td></tr>
                      ) : mine.map((p) => (
                        <tr key={p.id} className="border-t border-slate-100 dark:border-white/[.06]">
                          <td className="whitespace-nowrap px-3 py-2">{fmtDate(p.date)}</td>
                          <td className="px-3 py-2 font-semibold tabular-nums">{inr(p.amount)}</td>
                          <td className="px-3 py-2"><Badge tone="neutral">{p.mode}</Badge></td>
                          <td className="px-3 py-2 text-muted">{p.remarks ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    {mine.length > 0 && (
                      <tfoot>
                        <tr className="border-t-2 border-slate-200 bg-slate-50/80 dark:border-white/[.1] dark:bg-white/[.03]">
                          <td className="px-3 py-2.5 text-[12px] font-bold uppercase tracking-wide text-muted">Total</td>
                          <td className="px-3 py-2.5 font-display text-[14px] font-bold tabular-nums text-ink">{inr(paid)}</td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              {liveDetail.notes && (
                <p className="mt-3 text-[12px] text-muted">Notes: <span className="text-ink">{liveDetail.notes}</span></p>
              )}
            </>
          );
        })()}
      </Dialog>

      {/* ── Pay interest ───────────────────────────────────────────────────── */}
      <Dialog
        open={!!payFor}
        onClose={() => setPayFor(null)}
        title="Pay interest"
        subtitle={payLive ? `${payLive.investorName} · ${payLive.code}` : ''}
        footer={<>
          <Button variant="ghost" onClick={() => setPayFor(null)} disabled={saving}>Cancel</Button>
          <Button onClick={savePayout} loading={saving}><HandCoins size={15} /> Pay &amp; post expense</Button>
        </>}
      >
        {payLive && (
          <div className="space-y-4">
            <div className="rounded-xl border-[0.5px] border-slate-200/80 bg-slate-50/70 px-3.5 py-3 dark:border-white/[.08] dark:bg-white/[.02]">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[11px] text-muted">Per cycle</div>
                  <div className="font-display text-[15px] font-bold tabular-nums text-ink">{inr(interestPerCycle(payLive))}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">Accrued</div>
                  <div className="font-display text-[15px] font-bold tabular-nums text-ink">{inr(accruedInterest(payLive))}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">Due now</div>
                  <div className="font-display text-[15px] font-bold tabular-nums text-danger">{inr(interestDue(payLive, payouts))}</div>
                </div>
              </div>
              <p className="mt-2 text-[11.5px] leading-snug text-muted">
                This is recorded as an expense under <span className="font-semibold text-ink">{INVESTOR_EXPENSE_CATEGORY}</span> on the date below —
                the principal stays outstanding until you settle.
              </p>
            </div>

            <div>
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">Amount</span>
              <div className={cn(
                'flex h-[42px] items-center gap-2 rounded-xl border bg-white px-3.5 dark:bg-surface',
                payError ? 'border-danger focus-within:ring-4 focus-within:ring-danger/10' : 'border-slate-200 focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 dark:border-white/[.08]',
              )}>
                <span className="shrink-0 text-muted">₹</span>
                <input
                  inputMode="numeric"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
                  placeholder="0"
                  className="min-w-0 flex-1 bg-transparent text-sm font-semibold tabular-nums text-ink outline-none placeholder:text-slate-400"
                />
              </div>
              {payError && <span className="mt-1 block text-[12px] font-medium text-danger">{payError}</span>}
            </div>

            <div>
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">Payment mode</span>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {MODES.map((m) => {
                  const Icon = MODE_ICON[m];
                  const on = payMode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPayMode(m)}
                      className={cn(
                        'inline-flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-[12px] font-semibold transition-colors',
                        on ? 'border-primary bg-primary-50 text-primary dark:bg-primary/[.12]' : 'border-slate-200 text-ink/70 hover:bg-slate-50 dark:border-white/[.08] dark:hover:bg-white/[.03]',
                      )}
                    >
                      <Icon size={13} /> {m}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Date" type="date" value={payDate}
                min={payLive.startDate} max={todayISO()}
                onChange={(e) => setPayDate(e.target.value)}
              />
              <Input label="Remarks" placeholder="Optional note" value={payRemarks} onChange={(e) => setPayRemarks(e.target.value)} />
            </div>
          </div>
        )}
      </Dialog>

      {/* ── Settle confirmation ────────────────────────────────────────────── */}
      <Dialog
        open={!!settleFor}
        onClose={() => setSettleFor(null)}
        title="Settle & close investment"
        subtitle={settleFor ? `${settleFor.investorName} · ${settleFor.code}` : ''}
        footer={<>
          <Button variant="ghost" onClick={() => setSettleFor(null)}>Cancel</Button>
          <Button variant="success" onClick={doSettle}><CheckCircle2 size={15} /> Confirm settlement</Button>
        </>}
      >
        {settleFor && (
          <div className="space-y-3">
            <div className="rounded-xl border-[0.5px] border-emerald-200 bg-emerald-50 px-3.5 py-3 dark:border-emerald-500/25 dark:bg-emerald-500/10">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[11px] text-muted">Capital returned</div>
                  <div className="font-display text-[15px] font-bold tabular-nums text-ink">{inr(settleFor.principal)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">Interest still due</div>
                  <div className="font-display text-[15px] font-bold tabular-nums text-danger">{inr(interestDue(settleFor, payouts))}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">Total payable</div>
                  <div className="font-display text-[15px] font-bold tabular-nums text-ink">{inr(settleFor.principal + interestDue(settleFor, payouts))}</div>
                </div>
              </div>
            </div>
            {interestDue(settleFor, payouts) > 0 && (
              <div className="flex items-start gap-2.5 rounded-xl border-[0.5px] border-amber-200 bg-amber-50 px-3.5 py-3 dark:border-amber-500/25 dark:bg-amber-500/10">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-[12px] leading-snug text-amber-800 dark:text-amber-200">
                  <span className="font-bold">{inr(interestDue(settleFor, payouts))} of interest is still unpaid.</span> Pay it first
                  so the cost lands in Expenses — settling only stops future accrual, it does not record the interest.
                </p>
              </div>
            )}
            <p className="text-[12px] leading-snug text-muted">
              Returning the capital is <span className="font-semibold text-ink">not an expense</span> (it repays money received),
              so nothing is posted to Expenses. Interest stops accruing from today.
            </p>
          </div>
        )}
      </Dialog>

      {/* ── Delete confirmation ────────────────────────────────────────────── */}
      <Dialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        title="Remove investment"
        subtitle={confirmDel ? `${confirmDel.investorName} · ${confirmDel.code}` : ''}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmDel(null)}>Cancel</Button>
          <Button variant="danger" onClick={doDelete}><Trash2 size={15} /> Remove</Button>
        </>}
      >
        <p className="text-[13px] leading-relaxed text-ink/80">
          This removes the investment and its payout history from the register.
          <span className="font-semibold"> Interest already posted to Expenses is kept</span> — that money really was spent,
          so deleting it would falsify your expense reports. Remove those entries from the Expenses page if they were a mistake.
        </p>
      </Dialog>
    </div>
  );
}

/** The investor register's card — used at EVERY breakpoint (the desktop table
 *  was replaced by a grid of these). Hierarchy: identity + urgency at the top,
 *  the headline capital figure, payout progress, then the supporting figures
 *  and actions. An overdue card is tinted and ringed so it reads first. */
function InvestorCard({ inv, payouts, onOpen, onPay, onEdit, delay = 0 }: {
  inv: Investment;
  payouts: InvestorPayout[];
  onOpen: () => void;
  onPay?: () => void;
  /** Omitted for view-only users and settled investments (a settled
   *  investment's terms are history — the server rejects editing one). */
  onEdit?: () => void;
  delay?: number;
}) {
  const per = interestPerCycle(inv);
  const due = interestDue(inv, payouts);
  const paid = totalPaid(inv.id, payouts);
  const od = inv.status === 'ACTIVE' ? daysOverdue(inv, payouts) : 0;
  const nd = nextPayoutDate(inv, payouts);
  const cycles = cyclesElapsed(inv);
  const settled = per > 0 ? Math.min(Math.floor(paid / per), cycles) : 0;
  const pct = cycles > 0 ? Math.min(100, Math.round((settled / cycles) * 100)) : 0;
  const closed = inv.status === 'CLOSED';
  // Extra facts worth surfacing on the card itself:
  //  • annual cost — what this investor costs per year (comparable across
  //    monthly and yearly investors, which per-cycle amounts are not);
  //  • daysToNext — how soon the next payout lands (negative = overdue);
  //  • payable — capital + unpaid interest if settled today;
  //  • holding period — how long the money has been with us.
  const annualCost = inv.frequency === 'MONTHLY' ? per * 12 : per;
  // POSITIVE = days remaining until the payout; NEGATIVE = days overdue.
  // (Argument order matters: dueDate − today.)
  const daysToNext = nd ? daysBetweenISO(nd, todayISO()) : null;
  const payable = (closed ? 0 : inv.principal) + due;
  const monthsHeld = monthsBetweenISO(inv.startDate, closed && inv.settledDate ? inv.settledDate : todayISO());
  return (
    <div
      className={cn(
        'anim-pop group flex flex-col overflow-hidden rounded-2xl border bg-white shadow-card transition-all hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-20px_rgba(30,39,64,.4)] dark:bg-surface',
        // An overdue investment must read first: tinted top, danger ring.
        od > 0
          ? 'border-danger/40 ring-1 ring-danger/15 dark:border-danger/30'
          : 'border-slate-200/90 dark:border-white/[.07]',
        closed && 'opacity-[.92]',
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Status band — a real colour bar carrying the card's state at a glance,
          with the state named on it so the colour is never the ONLY signal
          (colour-blind users and greyscale printing both stay readable). */}
      <div className={cn(
        'flex items-center justify-between gap-2 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-white',
        closed ? 'bg-gradient-to-r from-slate-500 to-slate-400'
          : od > 0 ? 'bg-gradient-to-r from-rose-600 via-rose-500 to-orange-400'
            : due > 0 ? 'bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-400'
              : 'bg-gradient-to-r from-[#022999] via-[#0538cc] to-[#0AA8F8]',
      )}>
        <span className="flex items-center gap-1.5">
          {closed ? <><CheckCircle2 size={11} /> Settled</>
            : od > 0 ? <><AlertTriangle size={11} /> {od}d overdue</>
              : due > 0 ? <><HandCoins size={11} /> Interest due</>
                : <><CheckCircle2 size={11} /> On schedule</>}
        </span>
        {/* The figure that matters for this state, right on the band. */}
        <span className="tabular-nums opacity-95">
          {closed ? `${inr(paid)} paid` : due > 0 ? inr(due) : nd ? `next ${fmtDate(nd)}` : ''}
        </span>
      </div>

      {/* Header — identity + cadence, on a soft tinted band so the card has
          structure instead of reading as one flat block. */}
      <button
        onClick={onOpen}
        className="flex w-full items-start gap-3 border-b border-slate-100 bg-gradient-to-br from-slate-50/70 to-transparent px-4 pb-3 pt-3.5 text-left dark:border-white/[.06] dark:from-white/[.03]"
      >
        <div className={cn(
          'grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sm font-bold text-white shadow-sm ring-2 ring-white/60 dark:ring-white/10',
          closed ? 'bg-gradient-to-br from-slate-400 to-slate-500' : 'bg-gradient-to-br from-blue-700 to-blue-500',
        )}>
          {initials(inv.investorName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold text-ink group-hover:text-primary">{inv.investorName}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
            <span className="font-mono">{inv.code}</span>
            <span aria-hidden className="opacity-50">·</span>
            {/* Holding period — how long this money has been with us */}
            <span>{monthsHeld === 0 ? 'this month' : `${monthsHeld} ${monthsHeld === 1 ? 'month' : 'months'}`}</span>
          </div>
        </div>
        <span className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold',
          closed ? 'bg-slate-100 text-slate-500 dark:bg-white/[.08] dark:text-slate-300'
            : inv.frequency === 'MONTHLY'
              ? 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
              : 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
        )}>
          {inv.rate}%<span className="opacity-70">{inv.frequency === 'MONTHLY' ? '/mo' : '/yr'}</span>
        </span>
      </button>

      {/* Headline — capital, and what it costs a YEAR (comparable across
          monthly and yearly investors, unlike a per-cycle figure). Baseline
          aligned, both columns the same height in every card. */}
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <div>
          <div className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted">Capital</div>
          <div className="mt-1 font-display text-[22px] font-bold leading-none tabular-nums text-ink">{inr(inv.principal)}</div>
          <div className="mt-1.5 text-[10.5px] leading-none text-muted">{inr(per)} / {inv.frequency === 'MONTHLY' ? 'month' : 'year'}</div>
        </div>
        <div className="text-right">
          <div className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted">Cost / year</div>
          <div className="mt-1 font-display text-[16px] font-bold leading-none tabular-nums text-violet-600 dark:text-violet-400">{inr(annualCost)}</div>
          {/* Effective yield: annual cost as a % of capital — the true price of
              this money, directly comparable between investors. */}
          <div className="mt-1.5 text-[10.5px] leading-none text-muted">
            {inv.principal > 0 ? `${Math.round((annualCost / inv.principal) * 1000) / 10}% p.a.` : '—'}
          </div>
        </div>
      </div>

      {/* Payout progress — FIXED height (h-12) and always rendered, so every
          card in a row has an identically-tall zone here. A ragged grid was the
          alignment problem: this block used to appear only sometimes. */}
      <div className="flex h-12 flex-col justify-center px-4">
        {closed ? (
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={13} /> Capital returned · {settled} {settled === 1 ? 'cycle' : 'cycles'} paid
          </div>
        ) : cycles > 0 ? (
          <>
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium">
              <span className="text-muted">Cycles paid</span>
              <span className="tabular-nums">
                <span className={cn('font-bold', pct === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink')}>{settled}</span>
                <span className="text-muted"> / {cycles} · {pct}%</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[.08]">
              <div
                className={cn(
                  'h-full rounded-full transition-[width] duration-500',
                  pct === 100 ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                    : due > 0 ? 'bg-gradient-to-r from-rose-500 to-amber-400'
                      : 'bg-gradient-to-r from-[#0538cc] to-[#0AA8F8]',
                )}
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
            </div>
          </>
        ) : (
          // No cycle has fallen due yet — say so rather than leaving a gap.
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            <CalendarClock size={13} className="shrink-0" />
            First interest due {nd ? fmtDate(nd) : '—'}
          </div>
        )}
      </div>

      {/* Fact strip — 3 equal columns, each a FIXED height so the numbers line
          up across every card. Colour carries meaning: red = owed,
          emerald = paid, slate = neutral. */}
      <div className="mt-2 grid grid-cols-3 gap-px bg-slate-100 text-sm dark:bg-white/[.06]">
        <div className={cn('flex h-[62px] flex-col justify-center px-3', due > 0 ? 'bg-rose-50/70 dark:bg-rose-500/[.07]' : 'bg-white dark:bg-surface')}>
          <div className="text-[9.5px] font-bold uppercase tracking-wide text-muted">Interest due</div>
          <div className={cn('mt-0.5 font-display text-[14px] font-bold leading-none tabular-nums', due > 0 ? 'text-danger' : 'text-muted')}>
            {due > 0 ? inr(due) : '—'}
          </div>
        </div>
        <div className={cn('flex h-[62px] flex-col justify-center px-3', paid > 0 ? 'bg-emerald-50/60 dark:bg-emerald-500/[.06]' : 'bg-white dark:bg-surface')}>
          <div className="text-[9.5px] font-bold uppercase tracking-wide text-muted">Paid so far</div>
          <div className={cn('mt-0.5 font-display text-[14px] font-bold leading-none tabular-nums', paid > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted')}>
            {paid > 0 ? inr(paid) : '—'}
          </div>
        </div>
        <div className={cn(
          'flex h-[62px] flex-col justify-center px-3',
          !closed && daysToNext !== null && daysToNext < 0 ? 'bg-rose-50/70 dark:bg-rose-500/[.07]'
            : !closed && daysToNext === 0 ? 'bg-amber-50/70 dark:bg-amber-500/[.07]'
              : 'bg-white dark:bg-surface',
        )}>
          <div className="text-[9.5px] font-bold uppercase tracking-wide text-muted">{closed ? 'Settled on' : 'Next payout'}</div>
          <div className={cn('mt-0.5 font-display text-[12.5px] font-bold leading-none tabular-nums', od > 0 ? 'text-danger' : 'text-ink')}>
            {closed ? (inv.settledDate ? fmtDate(inv.settledDate) : '—') : nd ? fmtDate(nd) : '—'}
          </div>
          {!closed && daysToNext !== null && (
            <div className={cn(
              'mt-1 text-[9.5px] font-bold leading-none',
              daysToNext < 0 ? 'text-danger' : daysToNext === 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted',
            )}>
              {daysToNext < 0 ? `${Math.abs(daysToNext)}d overdue` : daysToNext === 0 ? 'DUE TODAY' : `in ${daysToNext}d`}
            </div>
          )}
        </div>
      </div>

      {/* Liability footer — capital + unpaid interest if settled today, split so
          both parts are visible. Amber-tinted: it is money owed, not earned. */}
      <div className={cn(
        'flex items-center justify-between gap-2 border-t px-4 py-2.5',
        closed
          ? 'border-slate-100 dark:border-white/[.06]'
          : 'border-amber-100 bg-amber-50/50 dark:border-amber-500/15 dark:bg-amber-500/[.05]',
      )}>
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">
          {closed ? 'Total interest cost' : 'Payable if settled'}
        </span>
        <span className="flex items-baseline gap-1.5">
          {!closed && due > 0 && (
            <span className="text-[10px] text-muted">{inr(inv.principal)} + {inr(due)}</span>
          )}
          <span className={cn('font-display text-[14px] font-bold tabular-nums', closed ? 'text-ink' : 'text-amber-700 dark:text-amber-300')}>
            {closed ? inr(paid) : inr(payable)}
          </span>
        </span>
      </div>

      {/* CTAs — Details, Edit, and (when payable) Pay Interest. Edit sits here
          rather than only inside the detail dialog: correcting a wrong rate or
          amount is a common first action straight from the list. */}
      <div className={cn(
        'mt-auto grid border-t border-slate-100 dark:border-white/[.06]',
        onPay && onEdit ? 'grid-cols-3' : onPay || onEdit ? 'grid-cols-2' : 'grid-cols-1',
      )}>
        <button
          onClick={onOpen}
          className="flex w-full items-center justify-center gap-1.5 py-3 text-[13px] font-semibold text-primary transition-colors hover:bg-primary/[.05] active:bg-primary/[.09]"
        >
          <ScrollText size={15} /> Details
        </button>
        {onEdit && (
          <button
            onClick={onEdit}
            title="Edit investor details"
            className="flex w-full items-center justify-center gap-1.5 border-l border-slate-100 py-3 text-[13px] font-semibold text-ink/70 transition-colors hover:bg-slate-50 hover:text-ink dark:border-white/[.06] dark:hover:bg-white/[.04]"
          >
            <Pencil size={14} /> Edit
          </button>
        )}
        {onPay && (
          <button
            onClick={onPay}
            className={cn(
              'flex w-full items-center justify-center gap-1.5 border-l border-slate-100 py-3 text-[13px] font-semibold transition-colors dark:border-white/[.06]',
              due > 0
                ? 'bg-success/[.06] text-success hover:bg-success/[.12]'
                : 'text-success hover:bg-success/[.06]',
            )}
          >
            <HandCoins size={15} /> {onEdit ? 'Pay' : 'Pay Interest'}
          </button>
        )}
      </div>
    </div>
  );
}
