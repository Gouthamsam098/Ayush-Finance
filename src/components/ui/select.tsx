import { cn } from '@/lib/utils';

interface Props extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
}
export function Select({ label, options, className, ...props }: Props) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted">{label}</span>}
      <select
        className={cn(
          'w-full rounded-xl border border-slate-200 dark:border-white/[.08] bg-white dark:bg-surface px-3 py-2.5 text-sm outline-none cursor-pointer',
          'shadow-[inset_0_1px_2px_rgba(15,23,42,.03)] dark:shadow-none transition-shadow duration-150',
          'focus:border-primary focus:ring-4 focus:ring-primary/10', className
        )}
        {...props}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
