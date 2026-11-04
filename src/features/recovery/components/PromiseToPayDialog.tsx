import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Loan } from '@/mock/DataContext';
import type { PromiseSubmission } from '../types';
import { todayISO } from '@/lib/format';
import { CalendarClock } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  loan: Loan;
  customerName: string;
  /** When set, saving updates this open promise instead of creating a new row. */
  existingOpen?: PromiseSubmission;
  onSubmit: (payload: { promiseDate: string; promisedAmount?: number; note: string }) => void | Promise<void>;
}

export function PromiseToPayDialog({ open, onClose, loan, customerName, existingOpen, onSubmit }: Props) {
  const [promiseDate, setPromiseDate] = useState(todayISO());
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (existingOpen) {
      setPromiseDate(existingOpen.promiseDate);
      setAmount(
        existingOpen.promisedAmount != null && existingOpen.promisedAmount > 0
          ? String(existingOpen.promisedAmount)
          : '',
      );
      setNote(existingOpen.note ?? '');
    } else {
      setPromiseDate(todayISO());
      setAmount('');
      setNote('');
    }
  }, [open, existingOpen?.id, existingOpen?.promiseDate, existingOpen?.promisedAmount, existingOpen?.note]);

  const save = async () => {
    if (promiseDate < todayISO()) {
      setError('Promise date cannot be in the past');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        promiseDate,
        promisedAmount: amount.trim() ? Number(amount) : undefined,
        note: note.trim(),
      });
      onClose();
    } catch {
      setError('Could not save promise. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Promise to pay"
      subtitle={`${customerName} · ${loan.loanNumber}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving}>
            <CalendarClock size={15} /> {existingOpen ? 'Update promise' : 'Save promise'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13px] text-muted">
          {existingOpen
            ? 'Change the promise date, amount, or note. This updates your existing open promise — a second promise is not created.'
            : 'Record the date the customer committed to pay. Admin will see this on the recovery queue.'}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Promise date *" type="date" min={todayISO()} value={promiseDate} onChange={(e) => setPromiseDate(e.target.value)} />
          <Input label="Amount (optional)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="If customer quoted an amount" />
        </div>
        <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <p className="text-[13px] font-medium text-danger" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
