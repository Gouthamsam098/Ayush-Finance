import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Sparkles, TrendingUp } from 'lucide-react';

export interface Metric {
  label: string;
  value: string;
  sub: string;
  good?: boolean;
  highlight?: boolean;
  countUp?: number;
  highlightColor?: 'amber' | 'emerald';
}

function CountUpValue({ target, isGood }: { target: number; isGood?: boolean }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef<number>(0);
  const start = useRef<number>(0);

  useEffect(() => {
    start.current = 0;
    const duration = 1200;
    const step = () => {
      const elapsed = performance.now() - start.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(target * eased));
      if (progress < 1) raf.current = requestAnimationFrame(step);
    };
    start.current = performance.now();
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target]);

  return (
    <span className={cn('tabular-nums', isGood === true && 'text-emerald-600 dark:text-emerald-400', isGood === false && 'text-red-600 dark:text-red-400')}>
      ₹{display.toLocaleString('en-IN')}
    </span>
  );
}

export function MetricRow({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="grid grid-cols-2 gap-[9px] lg:grid-cols-4">
      {metrics.map((m, i) => (
        <motion.div
          key={m.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04, duration: 0.35 }}
          className={cn(
            'relative overflow-hidden rounded-xl border-[0.5px] p-4 transition-shadow duration-300',
            m.highlight && m.highlightColor === 'emerald'
              ? 'border-emerald-300/60 bg-gradient-to-br from-emerald-50 via-green-50 to-emerald-50 shadow-[0_2px_12px_rgba(16,185,129,.15)] dark:border-emerald-500/20 dark:from-emerald-500/[.06] dark:via-green-500/[.04] dark:to-emerald-500/[.06]'
              : m.highlight
                ? 'border-amber-300/60 bg-gradient-to-br from-amber-50 via-yellow-50 to-amber-50 shadow-[0_2px_12px_rgba(245,158,11,.15)] dark:border-amber-500/20 dark:from-amber-500/[.06] dark:via-yellow-500/[.04] dark:to-amber-500/[.06]'
                : m.good
                  ? 'border-green-200 bg-green-50 dark:border-success/25 dark:bg-success/10'
                  : 'border-slate-200/70 bg-white dark:border-white/[.06] dark:bg-surface hover:shadow-[0_2px_8px_rgba(15,23,42,.06)]',
          )}
        >
          {m.highlight && (
            <>
              <style>{`
                @keyframes pulse-${i} {
                  0%, 100% { opacity: 0.15; transform: scale(0.95); }
                  50% { opacity: 0.4; transform: scale(1.05); }
                }
                @keyframes sh-${i} {
                  0% { left: -100%; }
                  100% { left: 100%; }
                }
              `}</style>
              {m.highlightColor === 'emerald' ? (
                <>
                  <div className="pointer-events-none absolute inset-0 rounded-xl"
                    style={{ background: 'radial-gradient(circle at 40% 30%, rgba(16,185,129,.25), transparent 50%), radial-gradient(circle at 60% 70%, rgba(52,211,153,.15), transparent 50%)', animation: `pulse-${i} 2.5s ease-in-out infinite` }} />
                  <div className="pointer-events-none absolute inset-y-0 w-6 -skew-x-12 bg-gradient-to-r from-transparent via-emerald-200/60 to-transparent dark:via-emerald-400/20"
                    style={{ animation: `sh-${i} 3s ease-in-out infinite`, animationDelay: '1s' }} />
                </>
              ) : (
                <>
                  <div className="pointer-events-none absolute inset-0 rounded-xl"
                    style={{ background: 'radial-gradient(circle at 30% 20%, rgba(251,191,36,.2), transparent 50%), radial-gradient(circle at 70% 80%, rgba(245,158,11,.15), transparent 50%)', animation: `pulse-${i} 3s ease-in-out infinite alternate` }} />
                  <div className="pointer-events-none absolute inset-y-0 w-8 -skew-x-12 bg-gradient-to-r from-transparent via-white/60 to-transparent dark:via-white/10"
                    style={{ animation: `sh-${i} 2.5s ease-in-out infinite`, animationDelay: '0.5s' }} />
                </>
              )}
            </>
          )}

          <div className="relative z-10">
            <div className="mb-1 flex items-center gap-1.5 text-[13px] text-muted">
              {m.label}
              {m.highlight && m.highlightColor === 'emerald' && <TrendingUp size={12} className="text-emerald-500" />}
              {m.highlight && m.highlightColor !== 'emerald' && <Sparkles size={12} className="text-amber-500 animate-pulse" />}
            </div>
            <div className="text-[22px] font-semibold">
              {m.countUp != null ? (
                <CountUpValue target={m.countUp} isGood={m.highlightColor === 'emerald' ? m.good : undefined} />
              ) : (
                <span className={cn(
                  m.highlight
                    ? m.highlightColor === 'emerald'
                      ? 'bg-gradient-to-r from-emerald-600 via-green-600 to-emerald-600 bg-clip-text text-transparent dark:from-emerald-400 dark:via-green-400 dark:to-emerald-400'
                      : 'bg-gradient-to-r from-amber-600 via-yellow-600 to-amber-600 bg-clip-text text-transparent dark:from-amber-400 dark:via-yellow-400 dark:to-amber-400'
                    : m.good ? 'text-green-700 dark:text-success' : 'text-ink',
                )}>
                  {m.value}
                </span>
              )}
            </div>
            <div className="mt-1 text-[13px] text-muted">{m.sub}</div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
