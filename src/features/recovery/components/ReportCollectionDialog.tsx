import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { PayMode, Loan } from '@/mock/DataContext';
import { todayISO, inr } from '@/lib/format';
import { HandCoins } from 'lucide-react';

const MODES: PayMode[] = ['CASH', 'UPI', 'BANK', 'CHEQUE'];

interface Props {
  open: boolean;
  onClose: () => void;
  loan: Loan;
  customerName: string;
  dueHint: number;
  variant?: 'create' | 'edit';
  initial?: { amount: number; mode: PayMode; receiptDate: string; note?: string };
  onSubmit: (payload: { amount: number; mode: PayMode; receiptDate: string; note: string }) => Promise<string | null>;
}

export function ReportCollectionDialog({
  open,
  onClose,
  loan,
  customerName,
  dueHint,
  variant = 'create',
  initial,
  onSubmit,
}: Props) {
  const [amount, setAmount] = useState(dueHint > 0 ? String(dueHint) : '');
  const [mode, setMode] = useState<PayMode>('CASH');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (variant === 'edit' && initial) {
      setAmount(String(initial.amount));
      setMode(initial.mode);
      setDate(initial.receiptDate);
      setNote(initial.note ?? '');
    } else {
      setAmount(dueHint > 0 ? String(dueHint) : '');
      setMode('CASH');
      setDate(todayISO());
      setNote('');
    }
    setError(null);
  }, [open, variant, initial, dueHint]);

  const save = async () => {
    const n = Number(amount);
    if (!n || n <= 0) { setError('Enter a valid amount'); return; }
    setLoading(true);
    setError(null);
    const err = await onSubmit({ amount: n, mode, receiptDate: date, note: note.trim() });
    setLoading(false);
    if (err) { setError(err); return; }
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={variant === 'edit' ? 'Edit pending submission' : 'Customer paid'}
      subtitle={`${customerName} · ${loan.loanNumber}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={loading}>
            <HandCoins size={15} /> {variant === 'edit' ? 'Save changes' : 'Submit for approval'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-xl border border-amber-200/80 bg-amber-50/80 px-4 py-3 text-[13px] leading-relaxed text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100">
          {variant === 'edit'
            ? 'Update the amount or receipt details while admin approval is still pending.'
            : <>Amount is recorded only after an <strong>admin approves</strong> this submission. The ledger updates on approval.</>}
        </p>
        {dueHint > 0 && (
          <p className="text-[13px] text-muted">Due now: <span className="font-semibold text-danger">{inr(dueHint)}</span></p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Amount collected *" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Select label="Mode" value={mode} onChange={(e) => setMode(e.target.value as PayMode)} options={MODES.map((m) => ({ value: m, label: m }))} />
          <Input label="Receipt date *" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Paid at shop, partial…" />
        {error && <p className="text-[13px] font-medium text-danger" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
