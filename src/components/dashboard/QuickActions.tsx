import type { LucideIcon } from 'lucide-react';

export interface QuickAction {
  label: string;
  icon: LucideIcon;
  to: string;
}

/** Row of 5 shortcut cards. */
export function QuickActions({ actions, onAction }: { actions: QuickAction[]; onAction: (to: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <button
            key={a.label}
            onClick={() => onAction(a.to)}
            className="rounded-xl border-[0.5px] border-slate-200/70 bg-white p-3.5 text-center transition-colors hover:bg-slate-50 dark:border-white/[.06] dark:bg-surface dark:hover:bg-white/[.03]"
          >
            <Icon size={22} className="mx-auto mb-1.5 block text-blue-500" />
            <div className="text-[13px] font-medium text-ink/90">{a.label}</div>
          </button>
        );
      })}
    </div>
  );
}
