import { Layers } from 'lucide-react';

const ALL_TYPES = [
  { key: 'DAILY_COLLECTION', label: 'Daily Collection', color: '#6366f1' },
  { key: 'VEHICLE', label: 'Vehicle Loan', color: '#22c55e' },
  { key: 'PROPERTY', label: 'Property Loan', color: '#f59e0b' },
  { key: 'DAILY_INTEREST', label: 'Daily Interest', color: '#14b8a6' },
  { key: 'MONTHLY_INTEREST', label: 'Monthly Interest', color: '#a855f7' },
  { key: 'FLEXIBLE', label: 'Flexible Loan', color: '#ec4899' },
];

interface CountsByType { type: string; count: number; }

function WalkingElephant() {
  return (
    <div className="flex flex-col items-center justify-center py-5">
      <style>{`
        @keyframes elephant-walk {
          0%, 100% { transform: translateX(-12px) rotate(-3deg); }
          25% { transform: translateX(-4px) rotate(-1deg); }
          50% { transform: translateX(4px) rotate(1deg); }
          75% { transform: translateX(12px) rotate(3deg); }
        }
        @keyframes elephant-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes shadow-pulse {
          0%, 100% { transform: scaleX(0.8); opacity: 0.3; }
          50% { transform: scaleX(1.1); opacity: 0.15; }
        }
      `}</style>
      <div className="relative mb-3" style={{ animation: 'elephant-bob 1.2s ease-in-out infinite' }}>
        <span className="text-5xl" style={{ display: 'block', animation: 'elephant-walk 2s ease-in-out infinite' }}>
          🐘
        </span>
      </div>
      <div
        className="h-1.5 w-14 rounded-full bg-slate-300/60 dark:bg-white/10"
        style={{ animation: 'shadow-pulse 1.2s ease-in-out infinite' }}
      />
      <p className="mt-3 text-[13px] font-medium text-muted">No active loans yet</p>
      <p className="text-[11px] text-muted/60">Create your first loan to see the mix</p>
    </div>
  );
}

export function PortfolioMix({ counts }: { counts: CountsByType[] }) {
  const map = Object.fromEntries(counts.map((c) => [c.type, c.count]));
  const total = counts.reduce((s, c) => s + c.count, 0);
  const activeTypes = ALL_TYPES.filter((t) => (map[t.key] ?? 0) > 0);

  return (
    <div className="rounded-2xl border-[0.5px] border-slate-200/70 bg-white p-4 dark:border-white/[.06] dark:bg-surface">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400">
            <Layers size={14} />
          </span>
          <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted">Portfolio Mix</span>
        </div>
        {total > 0 && (
          <span className="text-[11px] font-semibold text-muted">{total} active</span>
        )}
      </div>

      {total === 0 ? (
        <WalkingElephant />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {activeTypes.map((t) => {
            const count = map[t.key] ?? 0;
            return (
              <div
                key={t.key}
                className="relative overflow-hidden rounded-xl border-[0.5px] border-slate-100 bg-slate-50 p-3 dark:border-white/[.05] dark:bg-white/[.02]"
              >
                <div className="absolute left-0 top-0 h-full w-1" style={{ background: t.color }} />
                <div className="pl-2">
                  <div className="text-[11px] font-medium text-muted truncate">{t.label}</div>
                  <div className="mt-0.5 font-display text-[22px] font-bold tabular-nums text-ink">{count}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
