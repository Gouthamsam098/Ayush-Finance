import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type StatusTone = 'success' | 'warn' | 'neutral' | 'primary';

const STATUS_PILL: Record<StatusTone, string> = {
  success: 'bg-emerald-500/12 text-emerald-800 ring-emerald-500/20 dark:text-emerald-200',
  warn: 'bg-amber-500/12 text-amber-900 ring-amber-500/25 dark:text-amber-200',
  neutral: 'bg-slate-500/10 text-muted ring-slate-500/15',
  primary: 'bg-primary/10 text-primary ring-primary/20',
};

interface Props {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  statusLabel?: string;
  statusTone?: StatusTone;
  defaultOpen?: boolean;
  children: ReactNode;
}

function readStoredOpen(storageKey: string, defaultOpen: boolean): boolean {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    /* ignore */
  }
  return defaultOpen;
}

export function SettingsCollapsibleSection({
  id,
  title,
  description,
  icon,
  statusLabel,
  statusTone = 'neutral',
  defaultOpen = false,
  children,
}: Props) {
  const storageKey = `anush.settings.collapsible.${id}`;
  const [open, setOpen] = useState(() => readStoredOpen(storageKey, defaultOpen));

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <section
      className="overflow-hidden rounded-[18px] border border-slate-200/80 bg-surface shadow-card transition-shadow hover:shadow-soft dark:border-white/[.08]"
      aria-labelledby={`${id}-heading`}
    >
      <button
        type="button"
        id={`${id}-heading`}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={toggle}
        className={cn(
          'relative flex w-full items-start gap-3 px-4 py-4 text-left transition-colors sm:gap-4 sm:px-5 sm:py-4',
          'bg-gradient-to-r from-[#022999]/[.06] via-surface to-[#0AA8F8]/[.05]',
          'hover:from-[#022999]/[.09] hover:to-[#0AA8F8]/[.08]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        )}
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#022999] to-[#0AA8F8] text-white shadow-[0_8px_20px_-10px_rgba(5,56,204,.5)]">
          {icon}
        </span>
        <span className="min-w-0 flex-1 pt-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-display text-[16px] font-bold tracking-tight text-ink sm:text-[17px]">{title}</span>
            {statusLabel && (
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1',
                  STATUS_PILL[statusTone],
                )}
              >
                {statusLabel}
              </span>
            )}
          </span>
          <p className="mt-1 text-[12px] leading-relaxed text-muted sm:text-[13px]">{description}</p>
        </span>
        <span
          className={cn(
            'mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200/80 bg-surface/90 text-muted transition-transform duration-200 dark:border-white/[.08]',
            open && 'rotate-180 text-primary',
          )}
          aria-hidden
        >
          <ChevronDown size={18} />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`${id}-panel`}
            role="region"
            aria-labelledby={`${id}-heading`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-slate-100/90 dark:border-white/[.06]">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
