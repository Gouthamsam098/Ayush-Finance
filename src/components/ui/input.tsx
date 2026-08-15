import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, Props>(({ className, label, error, id, ...props }, ref) => (
  <label className="block">
    {label && (
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">{label}</span>
    )}
    <input
      ref={ref}
      id={id}
      className={cn(
        'w-full rounded-xl border bg-white dark:bg-surface px-3.5 py-2.5 text-sm outline-none',
        'shadow-[inset_0_1px_2px_rgba(15,23,42,.03)] dark:shadow-none',
        'border-slate-200 dark:border-white/[.08] placeholder:text-slate-400 dark:placeholder:text-slate-500',
        'transition-shadow duration-150',
        'outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 focus-visible:shadow-none',
        error && 'border-danger focus:border-danger focus:ring-danger/10',
        className
      )}
      {...props}
    />
    {error && <span className="mt-1 block text-xs font-medium text-danger">{error}</span>}
  </label>
));
Input.displayName = 'Input';
