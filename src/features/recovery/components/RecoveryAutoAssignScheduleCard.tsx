import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Clock, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  dailyScheduleSummary,
  formatScheduleClock12,
  nextAutoAssignRun,
  savedDailyScheduleTime,
} from '@/features/recovery/recoveryAutoAssign';
import {
  readLastAutoAssignDate,
  readTestAutoAssignTime,
  RECOVERY_SCHEDULE_CHANGED,
  writeTestAutoAssignTime,
} from '@/features/recovery/recoveryStore';

function formatLastRun(key: string | null): string {
  if (!key) return 'Not run yet';
  const [date, time] = key.split('|');
  if (time) return `${fmtDate(date)} · ${formatScheduleClock12(time)}`;
  return fmtDate(date);
}

interface Props {
  /** Bumps when assignments change so “last run” refreshes. */
  assignmentVersion: number;
}

export function RecoveryAutoAssignScheduleCard({ assignmentVersion }: Props) {
  const toast = useToast();
  const [draftTime, setDraftTime] = useState(() => readTestAutoAssignTime() ?? '00:00');
  const [scheduleTick, setScheduleTick] = useState(0);
  const [saving, setSaving] = useState(false);

  const savedTime = useMemo(
    () => savedDailyScheduleTime(),
    [assignmentVersion, scheduleTick],
  );

  const lastRun = useMemo(
    () => formatLastRun(readLastAutoAssignDate()),
    [assignmentVersion, scheduleTick],
  );

  const [countdownTick, setCountdownTick] = useState(0);
  const nextRun = useMemo(
    () => nextAutoAssignRun(),
    [countdownTick, scheduleTick, assignmentVersion],
  );

  useEffect(() => {
    const id = window.setInterval(() => setCountdownTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const bump = () => setScheduleTick((n) => n + 1);
    window.addEventListener(RECOVERY_SCHEDULE_CHANGED, bump);
    return () => window.removeEventListener(RECOVERY_SCHEDULE_CHANGED, bump);
  }, []);

  const dirty = (savedTime ?? '00:00') !== draftTime;

  const saveSchedule = () => {
    setSaving(true);
    const normalized = draftTime.trim();
    const storeValue = normalized === '00:00' || !normalized ? null : normalized;
    writeTestAutoAssignTime(storeValue);
    setScheduleTick((n) => n + 1);
    setSaving(false);
    toast(
      storeValue
        ? `Schedule saved — auto-assign runs daily at ${formatScheduleClock12(storeValue)}`
        : 'Schedule saved — auto-assign runs daily at midnight',
      'success',
    );
  };

  return (
    <section
      className={cn(
        'anim-pop overflow-hidden rounded-[18px] border border-slate-200/90 bg-surface shadow-card',
        'dark:border-white/[.08]',
      )}
    >
      <div className="relative overflow-hidden bg-gradient-to-r from-[#022999] via-[#0538cc] to-[#0AA8F8] px-5 py-4 sm:px-6 sm:py-5">
        <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/15 text-white shadow-[0_8px_24px_-8px_rgba(0,0,0,.35)] ring-1 ring-white/20">
              <CalendarClock size={22} strokeWidth={2} />
            </span>
            <div>
              <h3 className="font-display text-[17px] font-bold tracking-tight text-white sm:text-[18px]">
                Recovery auto-assign
              </h3>
              <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-white/85 sm:text-[13px]">
                Overdue active loans are balanced across recovery agents once per day. Existing agent assignments stay in place while a loan remains overdue.
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-50 ring-1 ring-emerald-200/30">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,.8)]" aria-hidden />
            Scheduled
          </span>
        </div>
      </div>

      <div className="grid gap-3 border-b border-slate-100/80 p-4 sm:grid-cols-3 sm:p-5 dark:border-white/[.06]">
        <div className="rounded-xl border border-primary/15 bg-primary/[.04] px-4 py-3 dark:border-primary/25 dark:bg-primary/[.08]">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
            <Sparkles size={12} className="text-primary" aria-hidden />
            Daily time
          </p>
          <p className="mt-1.5 font-display text-[15px] font-bold text-ink">{dailyScheduleSummary()}</p>
          <p className="mt-1 text-[11px] text-muted">Local timezone on this device</p>
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-surface/80 px-4 py-3 dark:border-white/[.08]">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
            <CheckCircle2 size={12} className="text-success" aria-hidden />
            Last run
          </p>
          <p className="mt-1.5 text-[14px] font-semibold text-ink">{lastRun}</p>
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-surface/80 px-4 py-3 dark:border-white/[.08]">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
            <Clock size={12} className="text-warning" aria-hidden />
            Next run
          </p>
          <p className="mt-1.5 text-[14px] font-semibold text-ink">
            {nextRun.dateLabel} · {nextRun.timeLabel}
          </p>
          <p className="mt-0.5 text-[11px] font-medium tabular-nums text-primary">in {nextRun.countdown}</p>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
        <div className="min-w-0 flex-1">
          <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
            Change schedule
          </label>
          <div className="mt-2 flex max-w-md flex-wrap items-stretch gap-2">
            <input
              type="time"
              value={draftTime}
              onChange={(e) => setDraftTime(e.target.value)}
              className="h-11 min-w-[9rem] flex-1 rounded-xl border border-slate-200/90 bg-surface px-3 text-[14px] font-medium text-ink outline-none transition-shadow focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-white/[.08]"
              aria-label="Daily auto-assign time"
            />
            <Button
              type="button"
              className="h-11 min-w-[8.5rem] shrink-0"
              disabled={!dirty || saving}
              onClick={saveSchedule}
            >
              Save schedule
            </Button>
          </div>
          <p className="mt-2.5 text-[11px] leading-relaxed text-muted">
            Saving starts the automatic daily run at this time (no manual step). Use{' '}
            <span className="font-medium text-ink">00:00</span> for midnight. Keep this app open in a browser tab until server-side scheduling is connected.
          </p>
        </div>
      </div>
    </section>
  );
}
