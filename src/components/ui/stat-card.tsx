import { useEffect, useRef, useState, type ReactNode } from 'react';
import { inrShort } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Parse a display string like `₹1,00,000` into rupees (integer). */
function rupeesFromDisplay(s: string): number | null {
  if (!s.startsWith('₹')) return null;
  const digits = s.slice(1).replace(/,/g, '').trim();
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

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

  const amount = countUp != null ? display : rupeesFromDisplay(value);
  const fullText = countUp != null ? `₹${display.toLocaleString('en-IN')}` : value;
  const compactText = amount != null && amount >= 100_000 ? inrShort(amount) : fullText;
  const useMobileCompact = amount != null && (amount >= 100_000 || fullText.length > 12);
  const clickable = !!onClick;

  return (
    <button
      onClick={onClick}
      disabled={!clickable}
      className={cn(
        'group relative flex min-w-0 items-start gap-2.5 rounded-xl border bg-surface px-3 py-2.5 text-left transition-all sm:items-center sm:gap-3 sm:px-3.5 sm:py-3',
        active ? '' : 'border-slate-200/90 dark:border-white/[.07]',
        clickable
          ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-10px_rgba(30,39,64,.2)]'
          : 'cursor-default',
      )}
      style={{
        borderColor: active ? accent : undefined,
        boxShadow: active ? `0 0 0 2px ${accent}26` : '0 1px 2px rgba(30,39,64,.04)',
      }}
    >
      {active && (
        <span
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl"
          style={{ background: `linear-gradient(135deg, ${accent}14, transparent 60%)` }}
        />
      )}
      <span
        className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white transition-transform duration-200 group-hover:scale-105 sm:h-9 sm:w-9"
        style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}
      >
        {icon}
      </span>
      <div className="relative min-w-0 flex-1">
        <div
          className="font-display font-bold leading-tight tabular-nums text-ink text-[15px] sm:text-lg lg:text-xl"
          title={useMobileCompact ? fullText : undefined}
        >
          {useMobileCompact ? (
            <>
              <span className="sm:hidden">{compactText}</span>
              <span className="hidden sm:inline">{fullText}</span>
            </>
          ) : (
            fullText
          )}
        </div>
        <div className="mt-1 line-clamp-2 text-[11px] font-medium leading-snug text-muted sm:text-[12px]">{label}</div>
      </div>
    </button>
  );
}
