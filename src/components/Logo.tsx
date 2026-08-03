interface LogoProps { size?: 'sm' | 'md' | 'lg'; showText?: boolean; }

const SIZES = {
  sm: { box: 'h-8 w-8 rounded-[9px]', svg: 20, title: 'text-sm', fin: 'text-[8px] tracking-[0.26em]', gap: 'gap-2.5', bar: 'w-2.5' },
  md: { box: 'h-11 w-11 rounded-2xl', svg: 27, title: 'text-lg', fin: 'text-[9px] tracking-[0.28em]', gap: 'gap-3', bar: 'w-3' },
  lg: { box: 'h-16 w-16 rounded-[20px]', svg: 42, title: 'text-[26px]', fin: 'text-[11px] tracking-[0.3em]', gap: 'gap-4', bar: 'w-4' },
};

export function LogoMark({ className = 'h-11 w-11 rounded-2xl', svg = 27 }: { className?: string; svg?: number }) {
  return (
    <div className={`grid ${className} shrink-0 place-items-center overflow-hidden bg-gradient-to-br from-[#022999] via-[#0538cc] to-[#0AA8F8] shadow-lg shadow-[#022999]/30 ring-1 ring-white/15`}>
      <svg width={svg} height={svg} viewBox="0 0 96 96" fill="none" stroke="#fff" strokeWidth="12" strokeLinecap="butt" strokeLinejoin="miter">
        <path d="M16 88 L55 10" /><path d="M55 10 L64 88" /><path d="M48 40 L86 40" /><path d="M54 62 L80 62" />
      </svg>
    </div>
  );
}

export default function Logo({ size = 'md', showText = true }: LogoProps) {
  const s = SIZES[size];
  return (
    <div className={`flex items-center ${s.gap}`}>
      <LogoMark className={s.box} svg={s.svg} />
      {showText && (
        <div className="leading-none">
          <div className={`font-display font-extrabold uppercase tracking-tight text-blue-700 ${s.title}`}>ANUSH</div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className={`h-px ${s.bar} bg-blue-500/50`} />
            <span className={`font-bold uppercase text-blue-700 leading-none ${s.fin}`}>FINSERV</span>
            <span className={`h-px ${s.bar} bg-blue-500/50`} />
          </div>
        </div>
      )}
    </div>
  );
}
