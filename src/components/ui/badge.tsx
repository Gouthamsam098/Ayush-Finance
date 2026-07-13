import { cn } from '@/lib/utils';

type Tone = 'ok' | 'warn' | 'err' | 'info' | 'neutral';
const tones: Record<Tone, string> = {
  ok: 'bg-success-50 text-success dark:bg-success/15',
  warn: 'bg-warning-50 text-warning dark:bg-warning/15',
  err: 'bg-danger-50 text-danger dark:bg-danger/15',
  info: 'bg-primary-50 text-primary dark:bg-primary/15',
  neutral: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-tight', tones[tone], className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {children}
    </span>
  );
}
