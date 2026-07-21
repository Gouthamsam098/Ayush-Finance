import { motion } from 'framer-motion';
import { Plus, Bell, Search, Menu, Users, Banknote, TrendingUp, AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOpenSidebar } from '@/components/layout/AppShell';

export interface HeroKpi {
  icon: LucideIcon;
  value: string;
  label: string;
  chip: string;
  /** Tailwind color classes for the icon block bg + icon color. */
  iconBg: string;
  iconColor: string;
  chipClass: string;
  /** Per-tile background + border tint (Tailwind classes). Falls back to neutral if omitted. */
  tileTint?: string;
  /** Red-tint the whole tile (e.g. collection rate at risk). */
  danger?: boolean;
}

interface HeroHeaderProps {
  name: string;
  dateLabel: string;
  kpis: HeroKpi[];
  onQuickAction?: () => void;
}

/** Dark hero banner across the top of the dashboard: greeting, actions, and 4 KPI tiles. */
export function HeroHeader({ name, dateLabel, kpis, onQuickAction }: HeroHeaderProps) {
  const openSidebar = useOpenSidebar();
  return (
    <div className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-r from-blue-50 via-white to-blue-50 px-5 pb-[18px] pt-4 dark:border-transparent dark:from-[#0c1220] dark:via-[#111a30] dark:to-[#0c1220]">
      {/* Indigo glow wash + decorative geometry */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-blue-500/10 blur-3xl dark:bg-blue-600/20" />
        <span className="absolute -right-[55px] -top-[55px] h-[190px] w-[190px] rounded-full border border-blue-300/40 dark:border-blue-400/20" />
        <span className="absolute right-[38px] top-[18px] h-[110px] w-[110px] rounded-full border border-blue-300/30 dark:border-blue-400/15" />
        <span className="absolute bottom-2 right-[18px] h-[55px] w-[55px] rounded-full border border-blue-300/40 dark:border-blue-400/20" />
      </div>

      <div className="relative z-10">
        {/* Greeting + actions */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <button
              onClick={openSidebar}
              aria-label="Open menu"
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-slate-200 bg-white text-slate-600 lg:hidden dark:border-white/15 dark:bg-white/[.08] dark:text-slate-300"
            >
              <Menu size={18} />
            </button>
            <div>
              <div className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Good afternoon, {name}</div>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{dateLabel}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onQuickAction}
              className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 dark:border-[0.5px] dark:border-blue-400/50 dark:bg-blue-500/25 dark:text-blue-200 dark:hover:bg-blue-500/40"
            >
              <Plus size={16} /> Quick action
            </button>
            <button
              aria-label="Notifications"
              className="flex h-9 w-9 items-center justify-center rounded-lg border-[0.5px] border-slate-200 bg-white text-slate-500 transition-colors hover:text-slate-800 dark:border-white/15 dark:bg-white/[.08] dark:text-slate-400 dark:hover:text-slate-200"
            >
              <Bell size={16} />
            </button>
            <button
              aria-label="Search"
              className="flex h-9 w-9 items-center justify-center rounded-lg border-[0.5px] border-slate-200 bg-white text-slate-500 transition-colors hover:text-slate-800 dark:border-white/15 dark:bg-white/[.08] dark:text-slate-400 dark:hover:text-slate-200"
            >
              <Search size={16} />
            </button>
          </div>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {kpis.map((k, i) => {
            const Icon = k.icon;
            return (
              <motion.div
                key={k.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.35 }}
                className={cn(
                  'rounded-xl border-[0.5px] p-4',
                  k.danger
                    ? 'border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/[.14]'
                    : k.tileTint ?? 'border-slate-200 bg-slate-50 dark:border-white/[.12] dark:bg-white/[.07]',
                )}
              >
                <span className={cn('mb-2.5 flex h-9 w-9 items-center justify-center rounded-lg', k.iconBg)}>
                  <Icon size={18} className={k.iconColor} />
                </span>
                <div className={cn('text-xl font-semibold leading-tight', k.danger ? 'text-red-600 dark:text-red-300' : 'text-slate-900 dark:text-white')}>
                  {k.value}
                </div>
                <div className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{k.label}</div>
                <span className={cn('mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium', k.chipClass)}>
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

/** Icon set re-exported so Dashboard can build the KPI list with matched icons. */
export const HERO_ICONS = { Users, Banknote, TrendingUp, AlertTriangle };
