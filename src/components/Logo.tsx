import { CheckCircle } from 'lucide-react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
}

export default function Logo({ size = 'md', showText = true }: LogoProps) {
  const sizes = {
    sm: { icon: 16, box: 8, textTitle: 'text-xs', textSub: 'text-[10px]', gap: 2 },
    md: { icon: 20, box: 10, textTitle: 'text-sm', textSub: 'text-xs', gap: 3 },
    lg: { icon: 24, box: 12, textTitle: 'text-base', textSub: 'text-xs', gap: 3 },
  };

  const s = sizes[size];

  return (
    <div className={`flex items-center gap-${s.gap}`}>
      <div className={`grid w-${s.box} h-${s.box} place-items-center rounded-lg bg-emerald-600 text-white flex-shrink-0`}>
        <CheckCircle size={s.icon} strokeWidth={3} />
      </div>
      {showText && (
        <div>
          <div className={`font-black ${s.textTitle} text-slate-900 leading-tight`}>
            Anush <span className="text-emerald-600">Capitals</span>
          </div>
          <div className={`${s.textSub} text-slate-600 uppercase tracking-wider`}>
            Loan Management System
          </div>
        </div>
      )}
    </div>
  );
}
