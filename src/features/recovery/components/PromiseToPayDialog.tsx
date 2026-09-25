import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Loan } from '@/mock/DataContext';
import { todayISO } from '@/lib/format';
import { CalendarClock } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  loan: Loan;
  customerName: string;
  onSubmit: (payload: { promiseDate: string; promisedAmount?: number; note: string }) => void;
}

export function PromiseToPayDialog({ open, onClose, loan, customerName, onSubmit }: Props) {
  const [promiseDate, setPromiseDate] = useState(todayISO());
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (promiseDate < todayISO()) {
      setError('Promise date cannot be in the past');
      return;
    }
    onSubmit({
      promiseDate,
      promisedAmount: amount ? Number(amount) : undefined,
      note: note.trim(),
    });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Promise to pay"
      subtitle={`${customerName} · ${loan.loanNumber}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save}><CalendarClock size={15} /> Save promise</Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13px] text-muted">
          Record the date the customer committed to pay. Admin will see this on the recovery queue.
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
