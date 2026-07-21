import { type ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { useOpenSidebar } from '@/components/layout/AppShell';

/** Standard animated page heading: gradient title + subtitle, with an optional action slot. */
export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  const openSidebar = useOpenSidebar();
  return (
    <div className="anim-pop flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <button
          onClick={openSidebar}
          aria-label="Open menu"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 lg:hidden dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
        >
          <Menu size={18} />
        </button>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            <span className="text-gradient">{title}</span>
          </h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
