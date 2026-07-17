import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Shared light body panel with an optional header (title + action link). */
export function Panel({
  title,
  action,
  onAction,
  children,
  className,
}: {
  title?: string;
  action?: string;
  onAction?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border-[0.5px] border-slate-200/70 bg-white p-4 dark:border-white/[.06] dark:bg-surface',
        className,
      )}
    >
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <span className="text-[15px] font-semibold text-ink">{title}</span>}
          {action && (
            <button onClick={onAction} className="text-[13px] font-medium text-primary hover:underline">
              {action}
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
