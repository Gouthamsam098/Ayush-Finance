import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Smartphone, Check, CircleDashed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  LOAN_TYPE_UPI_ORDER,
  loanTypeUpiLabel,
  validateLoanTypeUpiMap,
  validatePayeeName,
  validateUpiVpa,
  type LoanTypeUpiMap,
} from '@/lib/loanTypeUpi';
import type { LoanType } from '@/mock/DataContext';
import {
  LOAN_TYPE_UPI_CHANGED,
  readLoanTypeUpiMap,
  saveLoanTypeUpiMap,
  isPortalLoanTypeUpiReady,
} from '@/lib/loanTypeUpiStore';

interface Props {
  embedded?: boolean;
}

function rowIsComplete(map: LoanTypeUpiMap, type: LoanType): boolean {
  const row = map[type];
  return !validateUpiVpa(row.payeeVpa) && !validatePayeeName(row.payeeName);
}

export function LoanTypeUpiSettingsCard({ embedded }: Props) {
  const toast = useToast();
  const [draft, setDraft] = useState<LoanTypeUpiMap>(() => readLoanTypeUpiMap());
  const [tick, setTick] = useState(0);
  const [saving, setSaving] = useState(false);

  const saved = useMemo(() => readLoanTypeUpiMap(), [tick]);
  const portalReady = useMemo(() => isPortalLoanTypeUpiReady(), [tick]);

  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    window.addEventListener(LOAN_TYPE_UPI_CHANGED, bump);
    return () => window.removeEventListener(LOAN_TYPE_UPI_CHANGED, bump);
  }, []);

  useEffect(() => {
    setDraft(readLoanTypeUpiMap());
  }, [tick]);

  const fieldErrors = useMemo(() => validateLoanTypeUpiMap(draft), [draft]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved],
  );

  const configuredCount = useMemo(
    () => LOAN_TYPE_UPI_ORDER.filter((t) => rowIsComplete(draft, t)).length,
    [draft],
  );

  const setRow = useCallback((type: keyof LoanTypeUpiMap, field: 'payeeVpa' | 'payeeName', value: string) => {
    setDraft((prev) => ({
      ...prev,
      [type]: { ...prev[type], [field]: value },
    }));
  }, []);

  const save = () => {
    setSaving(true);
    const err = saveLoanTypeUpiMap(draft);
    setSaving(false);
    if (err) {
      toast(err, 'error');
      return;
    }
    setTick((n) => n + 1);
    toast('UPI settings saved — customer portal pay is enabled', 'success');
  };

  const progressPct = Math.round((configuredCount / LOAN_TYPE_UPI_ORDER.length) * 100);

  return (
    <div className={cn('space-y-4', !embedded && 'rounded-card border border-slate-200/80 bg-surface p-4 shadow-card dark:border-white/[.08] sm:p-5')}>
      {!embedded && (
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/12 text-violet-600 dark:text-violet-300">
            <Smartphone size={20} />
          </span>
          <div>
            <p className="font-display text-[15px] font-bold text-ink">Customer portal · UPI by loan type</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              One UPI ID and payee name per product type. All six must be valid before borrowers can pay from the portal.
            </p>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50/80 via-surface to-violet-500/[.04] p-4 dark:border-white/[.08] dark:from-white/[.02] dark:via-surface dark:to-violet-500/[.06] sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-display text-sm font-bold text-ink">Configuration progress</p>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                  portalReady
                    ? 'bg-success/15 text-success'
                    : 'bg-warning/15 text-warning',
                )}
              >
                {configuredCount} / {LOAN_TYPE_UPI_ORDER.length}
              </span>
            </div>
            <p className="mt-1 text-[12px] text-muted">
              {portalReady
                ? 'Borrowers see the UPI ID that matches their loan product when they pay.'
                : 'Fill every row below. Invalid or empty fields block portal UPI.'}
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200/80 dark:bg-white/[.08]">
              <motion.div
                className={cn(
                  'h-full rounded-full',
                  portalReady ? 'bg-success' : 'bg-gradient-to-r from-primary to-violet-500',
                )}
                initial={false}
                animate={{ width: `${progressPct}%` }}
                transition={{ type: 'spring', stiffness: 120, damping: 20 }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-surface shadow-soft dark:border-white/[.08]">
        <div
          className="hidden border-b border-slate-200/80 bg-slate-50/60 text-[10px] font-bold uppercase tracking-wider text-muted dark:border-white/[.06] dark:bg-white/[.02] md:grid md:grid-cols-[minmax(7.5rem,1fr)_minmax(0,1.35fr)_minmax(0,1fr)_2.25rem] md:gap-0 md:px-4 md:py-2.5"
          aria-hidden
        >
          <span>Loan type</span>
          <span className="md:pl-2">UPI ID</span>
          <span className="md:pl-2">Payee name</span>
          <span className="text-center"> </span>
        </div>

        <ul className="divide-y divide-slate-200/80 dark:divide-white/[.06]">
          {LOAN_TYPE_UPI_ORDER.map((type) => {
            const row = draft[type];
            const err = fieldErrors?.[type];
            const complete = rowIsComplete(draft, type);
            const touched = Boolean(row.payeeVpa.trim() || row.payeeName.trim());

            return (
              <li
                key={type}
                className={cn(
                  'transition-colors',
                  complete && 'bg-success/[.03] dark:bg-success/[.04]',
                  !complete && touched && 'bg-warning/[.02]',
                )}
              >
                <div className="p-3 sm:p-4 md:grid md:grid-cols-[minmax(7.5rem,1fr)_minmax(0,1.35fr)_minmax(0,1fr)_2.25rem] md:items-start md:gap-3 md:px-4 md:py-3.5">
                  <div className="mb-3 flex items-center justify-between gap-2 md:mb-0 md:pt-2">
                    <div className="min-w-0">
                      <p className="font-display text-[13px] font-bold leading-snug text-ink">{loanTypeUpiLabel(type)}</p>
                    </div>
                    <span
                      className={cn(
                        'grid h-7 w-7 shrink-0 place-items-center rounded-full md:hidden',
                        complete ? 'bg-success/15 text-success' : 'bg-slate-100 text-muted dark:bg-white/[.06]',
                      )}
                      aria-hidden
                    >
                      {complete ? <Check size={14} strokeWidth={2.5} /> : <CircleDashed size={14} />}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:contents">
                    <div className="min-w-0 md:pt-0">
                      <Input
                        label="UPI ID"
                        labelClassName="md:hidden"
                        placeholder="name@ybl"
                        value={row.payeeVpa}
                        onChange={(e) => setRow(type, 'payeeVpa', e.target.value)}
                        error={err?.payeeVpa}
                        autoComplete="off"
                        spellCheck={false}
                        aria-label={`${loanTypeUpiLabel(type)} UPI ID`}
                        className="font-mono text-[13px]"
                      />
                    </div>
                    <div className="min-w-0">
                      <Input
                        label="Payee name"
                        labelClassName="md:hidden"
                        placeholder="Shown in UPI apps"
                        value={row.payeeName}
                        onChange={(e) => setRow(type, 'payeeName', e.target.value)}
                        error={err?.payeeName}
                        autoComplete="off"
                        aria-label={`${loanTypeUpiLabel(type)} payee name`}
                      />
                    </div>
                  </div>

                  <div
                    className={cn(
                      'mt-0 hidden place-self-center md:grid md:h-8 md:w-8 md:place-items-center md:rounded-full',
                      complete ? 'text-success' : 'text-muted/50',
                    )}
                    title={complete ? 'Complete' : 'Incomplete'}
                    aria-hidden
                  >
                    {complete ? <Check size={16} strokeWidth={2.5} /> : <CircleDashed size={16} />}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div
        className={cn(
          'flex flex-col-reverse gap-2 rounded-2xl border border-transparent p-1 sm:flex-row sm:justify-end',
          dirty && 'border-slate-200/80 bg-slate-50/50 dark:border-white/[.08] dark:bg-white/[.02] sm:px-3 sm:py-2',
        )}
      >
        <Button
          type="button"
          variant="ghost"
          className="w-full sm:w-auto"
          disabled={!dirty || saving}
          onClick={() => setDraft(readLoanTypeUpiMap())}
        >
          Reset changes
        </Button>
        <Button type="button" className="w-full sm:w-auto" loading={saving} disabled={!dirty} onClick={save}>
          Save UPI settings
        </Button>
      </div>
    </div>
  );
}
