import { motion } from 'framer-motion';
import { Plus, Menu, Users, Banknote, TrendingUp, AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOpenSidebar } from '@/components/layout/AppShell';
import { LiveClock } from '@/components/LiveClock';

export interface HeroKpi {
  icon: LucideIcon;
  value: string;
  label: string;
  chip: string;
  iconBg: string;
  iconColor: string;
  chipClass: string;
  tileTint?: string;
  danger?: boolean;
}

interface HeroHeaderProps {
  name: string;
  dateLabel: string;
  kpis: HeroKpi[];
  onQuickAction?: () => void;
}

export function HeroHeader({ name, dateLabel, kpis, onQuickAction }: HeroHeaderProps) {
  const openSidebar = useOpenSidebar();
  const h = new Date().getHours();
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-br from-blue-50 via-white to-indigo-50 px-5 pb-5 pt-4 dark:border-transparent dark:from-[#0f172a] dark:via-[#111a30] dark:to-[#0f172a]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-blue-400/8 blur-3xl dark:bg-blue-600/15" />
        <span className="absolute -left-16 -bottom-12 h-52 w-52 rounded-full bg-indigo-400/6 blur-3xl dark:bg-indigo-500/10" />
      </div>

      <div className="relative z-10">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <button
              onClick={openSidebar}
              aria-label="Open menu"
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-slate-200 bg-white text-slate-600 lg:hidden dark:border-white/15 dark:bg-white/[.08] dark:text-slate-300"
            >
              <Menu size={18} />
            </button>
            <div>
              <div className="text-[22px] font-display font-bold tracking-tight text-slate-900 dark:text-white">{greeting}, {name}</div>
              <div className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{dateLabel}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LiveClock />
            <button
              onClick={onQuickAction}
              className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-2 text-[13px] font-semibold text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 hover:shadow-md"
            >
              <Plus size={15} /> Record collection
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {kpis.map((k, i) => {
            const Icon = k.icon;
            return (
              <motion.div
                key={k.label}
                initial={{ opacity: 0, y: 16 }}
                animate={k.danger
                  ? { opacity: 1, y: 0, scale: [1, 1.04, 1, 1.03, 1] }
                  : { opacity: 1, y: 0 }}
                transition={k.danger
                  ? { scale: { duration: 1.2, repeat: Infinity, ease: 'easeInOut', times: [0, 0.1, 0.3, 0.4, 1] }, opacity: { delay: 0.08 + i * 0.06, duration: 0.4 }, y: { delay: 0.08 + i * 0.06, duration: 0.4 } }
                  : { delay: 0.08 + i * 0.06, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  'group relative overflow-hidden rounded-2xl border-[0.5px] p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg',
                  k.danger
                    ? 'border-red-200 bg-red-50 dark:border-red-500/25 dark:bg-red-500/[.10]'
                    : k.tileTint ?? 'border-slate-200 bg-white dark:border-white/[.08] dark:bg-white/[.04]',
                )}
              >
                <span className={cn('mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl relative z-10', k.iconBg)}>
                  <Icon size={19} className={cn(k.iconColor)} />
                </span>
                <div className={cn('text-lg sm:text-[22px] font-display font-bold leading-tight tracking-tight relative z-10', k.danger ? 'text-red-600 dark:text-red-300' : 'text-slate-900 dark:text-white')}>
                  {k.value}
                </div>
                <div className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{k.label}</div>
                <span className={cn('mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold', k.chipClass)}>
                  {k.chip}
                </span>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const HERO_ICONS = { Users, Banknote, TrendingUp, AlertTriangle };
