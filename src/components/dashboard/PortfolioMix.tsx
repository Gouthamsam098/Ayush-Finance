import { motion } from 'framer-motion';
import { Panel } from './Panel';

export interface MixRow {
  name: string;
  pct: number;
  color: string; // hex, drives dot + bar fill
}

/** Active-loan composition by type, largest share first. */
export function PortfolioMix({ rows }: { rows: MixRow[] }) {
  return (
    <Panel title="Portfolio mix">
      {rows.length === 0 ? (
        <p className="py-2 text-xs text-muted">No active loans.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r, i) => (
            <div key={r.name} className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
              <span className="flex-1 truncate text-sm text-ink/90">{r.name}</span>
              <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[.06]">
                <motion.span
                  className="block h-full rounded-full"
                  style={{ background: r.color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${r.pct}%` }}
                  transition={{ delay: i * 0.05, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                />
              </span>
              <span className="w-9 text-right text-[13px] font-semibold text-ink">{r.pct}%</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
