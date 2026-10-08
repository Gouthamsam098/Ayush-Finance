import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowLeft, Loader2, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  email: string;
  loading?: boolean;
  error?: string | null;
  onBack: () => void;
  onSubmit: (code: string) => void;
}

export function TotpLoginPanel({ email, loading, error, onBack, onSubmit }: Props) {
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const code = digits.join('');
  const complete = code.length === 6 && digits.every((d) => d !== '');

  const setAt = (index: number, value: string) => {
    const d = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = d;
    setDigits(next);
    if (d && index < 5) refs.current[index + 1]?.focus();
    if (next.every((x) => x !== '') && next.join('').length === 6) {
      onSubmit(next.join(''));
    }
  };

  const onKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    const next = pasted.split('').concat(['', '', '', '', '', '']).slice(0, 6);
    setDigits(next);
    if (pasted.length === 6) onSubmit(pasted);
    else refs.current[Math.min(pasted.length, 5)]?.focus();
  };

  return (
    <div className="relative z-10">
      <button
        type="button"
        onClick={onBack}
        disabled={loading}
        className="mb-5 flex items-center gap-1.5 text-[13px] font-semibold text-slate-400 transition-colors hover:text-slate-200"
      >
        <ArrowLeft size={16} /> Back to sign in
      </button>

      <div className="mb-6 flex flex-col items-center text-center">
        <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/20 text-violet-200 ring-1 ring-violet-400/30">
          <ShieldCheck size={24} />
        </span>
        <h1 className="font-display text-xl font-bold tracking-tight text-slate-50">Authenticator code</h1>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-slate-400">
          Open <span className="font-medium text-slate-300">Google Authenticator</span> and enter the 6-digit code for
        </p>
        <p className="mt-1 truncate text-sm font-semibold text-slate-200">{email}</p>
      </div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-5 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/15 px-4 py-3 text-sm font-medium text-rose-200"
        >
          <AlertCircle size={17} className="mt-0.5 shrink-0 text-rose-300" />
          <span>{error}</span>
        </motion.div>
      )}

      <div className="flex justify-center gap-2 sm:gap-2.5" onPaste={onPaste}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            value={d}
            disabled={loading}
            aria-label={`Digit ${i + 1}`}
            onChange={(e) => setAt(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            className={cn(
              'h-12 w-10 rounded-xl border-2 bg-slate-900/40 text-center font-display text-lg font-bold text-slate-50 outline-none transition-all sm:h-14 sm:w-11 sm:text-xl',
              'border-white/10 focus:border-violet-400 focus:ring-4 focus:ring-violet-500/20',
              d && 'border-violet-400/50',
            )}
          />
        ))}
      </div>

      <button
        type="button"
        disabled={!complete || loading}
        onClick={() => onSubmit(code)}
        className={cn(
          'mt-6 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[14px] font-bold text-white transition-all',
          'bg-gradient-to-r from-violet-600 to-indigo-600 shadow-[0_8px_24px_-10px_rgba(99,102,241,.55)]',
          (!complete || loading) && 'cursor-not-allowed opacity-50',
        )}
      >
        {loading ? <Loader2 size={18} className="animate-spin" /> : 'Verify & continue'}
      </button>
    </div>
  );
}
