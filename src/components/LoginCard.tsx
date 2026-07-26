import { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { LogoMark } from './Logo';
import LoginForm, { type AuthMode } from './LoginForm';

interface LoginCardProps {
  onSubmit: (username: string, password: string) => void;
  loading?: boolean;
  error?: string | null;
}

export default function LoginCard({ onSubmit, loading = false, error = null }: LoginCardProps) {
  const [mode, setMode] = useState<AuthMode>('signin');

  return (
    <motion.div
      initial={{ opacity: 0, x: 60 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-md"
    >
      <motion.div
        animate={{ y: [0, -5, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
        className="relative rounded-[28px] border border-white/[.08] bg-[#0b1220]/80 p-8 backdrop-blur-2xl md:p-10 shadow-[0_32px_90px_-20px_rgba(0,0,0,.7),0_0_0_1px_rgba(255,255,255,.05),inset_0_1px_0_rgba(255,255,255,.06)]"
      >
        <div className="pointer-events-none absolute -top-20 left-1/2 h-40 w-80 -translate-x-1/2 rounded-full bg-[#188BFC]/25 blur-3xl" />

        <div className="relative z-10">
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="flex items-center gap-4">
              <motion.div
                initial={{ scale: 0, rotate: -30 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ duration: 0.7, ease: [0.34, 1.56, 0.64, 1], delay: 0.1 }}
              >
                <LogoMark className="h-16 w-16 rounded-[20px]" svg={42} />
              </motion.div>
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, ease: 'easeOut', delay: 0.4 }}
                className="leading-none"
              >
                <div className="font-display bg-gradient-to-r from-sky-300 to-blue-400 bg-clip-text text-[26px] font-extrabold uppercase tracking-tight text-transparent">ANUSH</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="h-px w-4 bg-blue-400/40" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-blue-300/90 leading-none">FINSERV</span>
                  <span className="h-px w-4 bg-blue-400/40" />
                </div>
              </motion.div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut', delay: 0.55 }}
              className="mt-6"
            >
              <h1 className="font-display text-xl font-bold tracking-tight text-slate-50">
                {mode === 'signup' ? 'Create an account' : 'Welcome back'}
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                {mode === 'signup' ? 'Get started with your loan portfolio' : 'Sign in to manage your loan portfolio'}
              </p>
            </motion.div>
          </div>

          {mode === 'signin' && error && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
              className="mb-5 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/15 px-4 py-3 text-sm font-medium text-rose-200">
              <AlertCircle size={17} className="mt-0.5 shrink-0 text-rose-300" />
              <span>{error}</span>
            </motion.div>
          )}

          <LoginForm onSubmit={onSubmit} loading={loading} mode={mode} onModeChange={setMode} />
        </div>
      </motion.div>
    </motion.div>
  );
}