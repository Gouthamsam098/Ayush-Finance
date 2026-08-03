import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'ghost' | 'success' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-gradient-to-b from-[#022999] via-[#0538cc] to-[#0AA8F8] text-white shadow-[0_1px_0_rgba(255,255,255,.15)_inset,0_4px_12px_-2px_rgba(2,41,153,.45)] hover:shadow-[0_1px_0_rgba(255,255,255,.15)_inset,0_6px_20px_-2px_rgba(10,168,248,.55)] hover:from-[#0538cc] hover:via-[#0AA8F8] hover:to-[#0AA8F8]',
  ghost: 'bg-transparent border border-slate-200 dark:border-slate-700/80 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[.06] hover:border-slate-300 dark:hover:border-slate-600',
  success: 'bg-gradient-to-b from-success to-success-600 text-white shadow-[0_1px_0_rgba(255,255,255,.15)_inset,0_4px_12px_-2px_rgba(16,185,129,.4)] hover:brightness-105',
  danger: 'bg-gradient-to-b from-danger to-danger-600 text-white shadow-[0_1px_0_rgba(255,255,255,.15)_inset,0_4px_12px_-2px_rgba(225,29,72,.4)] hover:brightness-105',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ className, variant = 'primary', loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl px-4 py-2.5 text-sm font-semibold tracking-tight',
        'transition-all duration-200 hover:-translate-y-0.5 active:scale-[.97] active:translate-y-0 disabled:opacity-50 disabled:pointer-events-none disabled:shadow-none disabled:translate-y-0',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        variants[variant],
        className
      )}
      {...props}
    >
      {/* hover sheen sweep on filled variants */}
      {variant !== 'ghost' && (
        <span className="pointer-events-none absolute inset-0 -translate-x-full skew-x-[-18deg] bg-white/25 transition-transform duration-700 group-hover:translate-x-[220%]" />
      )}
      {loading && <span className="relative h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      <span className="relative inline-flex items-center gap-2">{children}</span>
    </button>
  )
);
Button.displayName = 'Button';
