import { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import LoginForm, { type AuthMode } from './LoginForm';
import { LoginBrandLogo } from '@/components/LoginBrandLogo';

interface LoginCardProps {
  onSubmit: (username: string, password: string) => void;
  loading?: boolean;
  error?: string | null;
}

export default function LoginCard({ onSubmit, loading = false, error = null }: LoginCardProps) {
  const [mode, setMode] = useState<AuthMode>('signin');

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-[400px]"
    >
      <motion.div
        animate={{ y: [0, -4, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
        className="relative overflow-hidden rounded-[28px] border border-white/[.1] bg-[#022999] px-7 py-8 shadow-[0_32px_90px_-20px_rgba(0,0,0,.65),0_0_0_1px_rgba(255,255,255,.06),inset_0_1px_0_rgba(255,255,255,.08)] sm:px-8 sm:py-9"
      >
        <div className="pointer-events-none absolute -top-16 left-1/2 h-32 w-64 -translate-x-1/2 rounded-full bg-[#0538cc]/28 blur-3xl" />

        <div className="relative z-10 flex flex-col">
          <div className="mb-7 flex flex-col items-center text-center">
            <LoginBrandLogo />

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut', delay: 0.35 }}
              className="mt-6 w-full"
            >
              <h1 className="font-display text-xl font-bold tracking-tight text-slate-50">
                Welcome back
              </h1>
              <p className="mt-1.5 text-sm text-slate-400">
                Sign in to manage your loan portfolio
              </p>
            </motion.div>
          </div>

          {mode === 'signin' && error && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-5 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/15 px-4 py-3 text-sm font-medium text-rose-200"
            >
              <AlertCircle size={17} className="mt-0.5 shrink-0 text-rose-300" />
              <span>{error}</span>
            </motion.div>
          )}

          <motion.div
            animate={loading ? { scale: 0.992, filter: 'brightness(0.96)' } : { scale: 1, filter: 'brightness(1)' }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="w-full"
          >
            <LoginForm onSubmit={onSubmit} loading={loading} mode={mode} onModeChange={setMode} />
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
}
