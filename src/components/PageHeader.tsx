import { type ReactNode } from 'react';

/** Standard animated page heading: gradient title + subtitle, with an optional action slot. */
export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="anim-pop flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          <span className="text-gradient">{title}</span>
        </h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
