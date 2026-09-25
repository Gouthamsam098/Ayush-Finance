import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  /** Shows an eye toggle; input type is forced to password/text when enabled. */
  revealPassword?: boolean;
}

export const Input = forwardRef<HTMLInputElement, Props>(
  ({ className, label, error, id, revealPassword, type = 'text', ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false);
    const resolvedType = revealPassword ? (showPassword ? 'text' : 'password') : type;

    return (
      <label className="block min-w-0">
        {label && (
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">{label}</span>
        )}
        <div className={cn(revealPassword && 'relative')}>
          <input
            ref={ref}
            id={id}
            type={resolvedType}
            className={cn(
              'box-border w-full min-w-0 max-w-full rounded-xl border bg-white dark:bg-surface px-3.5 py-2.5 text-sm outline-none',
              'shadow-[inset_0_1px_2px_rgba(15,23,42,.03)] dark:shadow-none',
              'border-slate-200 dark:border-white/[.08] placeholder:text-slate-400 dark:placeholder:text-slate-500',
              'transition-shadow duration-150',
              'outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 focus-visible:shadow-none',
              error && 'border-danger focus:border-danger focus:ring-danger/10',
              revealPassword && 'pr-11',
              className,
            )}
            {...props}
          />
          {revealPassword && (
            <button
              type="button"
              tabIndex={-1}
              disabled={props.disabled}
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted transition-colors hover:bg-slate-100 hover:text-ink disabled:opacity-50 dark:hover:bg-white/[.06]"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
            </button>
          )}
        </div>
        {error && <span className="mt-1 block text-xs font-medium text-danger">{error}</span>}
      </label>
    );
  },
);
Input.displayName = 'Input';
