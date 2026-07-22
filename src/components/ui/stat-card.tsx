import { useEffect, useRef, useState, type ReactNode } from 'react';

export function StatCard({
  label, value, active, onClick, accent, icon, countUp,
}: {
  label: string;
  value: string;
  active?: boolean;
  onClick?: () => void;
  accent: string;
  icon: ReactNode;
  countUp?: number;
}) {
  const [display, setDisplay] = useState(countUp != null ? 0 : 0);
  const raf = useRef(0);
  const started = useRef(0);

  useEffect(() => {
    if (countUp == null) return;
    started.current = performance.now();
    const step = () => {
      const elapsed = performance.now() - started.current;
      const progress = Math.min(elapsed / 1000, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(countUp * eased));
      if (progress < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [countUp]);

  const displayedValue = countUp != null ? `₹${display.toLocaleString('en-IN')}` : value;
  const clickable = !!onClick;

  return (
    <button
      onClick={onClick}
      disabled={!clickable}
      className={`group relative flex items-center gap-3 overflow-hidden rounded-xl border bg-white px-3.5 py-3 text-left transition-all dark:bg-surface ${
        active ? '' : 'border-slate-200/90 dark:border-white/[.07]'
      } ${clickable ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-10px_rgba(30,39,64,.2)]' : 'cursor-default'}`}
      style={{
        borderColor: active ? accent : undefined,
        boxShadow: active ? `0 0 0 2px ${accent}26` : '0 1px 2px rgba(30,39,64,.04)',
      }}
    >
      {active && (
        <span className="pointer-events-none absolute inset-0" style={{ background: `linear-gradient(135deg, ${accent}14, transparent 60%)` }} />
      )}
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white transition-transform duration-200 group-hover:scale-105"
        style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}>
        {icon}
      </span>
      <div className="relative min-w-0">
        <div className="font-display text-xl font-bold leading-none tabular-nums text-ink">{displayedValue}</div>
        <div className="mt-1 truncate text-[12px] font-medium text-muted">{label}</div>
      </div>
    </button>
  );
}
