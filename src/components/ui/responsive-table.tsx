import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Bordered card + horizontal scroll for wide data tables (mobile / fold safe). */
export function ResponsiveTableFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'min-w-0 overflow-hidden rounded-2xl border border-slate-200/90 shadow-card dark:border-white/[.08]',
        className,
      )}
    >
      <div className="scroll-touch-x">{children}</div>
    </div>
  );
}
