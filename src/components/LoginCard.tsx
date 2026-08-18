import { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
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
        className="relative rounded-[28px] border border-white/[.08] bg-[#2e0196]/75 p-8 backdrop-blur-2xl md:p-10 shadow-[0_32px_90px_-20px_rgba(0,0,0,.7),0_0_0_1px_rgba(255,255,255,.05),inset_0_1px_0_rgba(255,255,255,.06)]"
      >
        <div className="pointer-events-none absolute -top-20 left-1/2 h-40 w-80 -translate-x-1/2 rounded-full bg-[#3a14a8]/35 blur-3xl" />

        <div className="relative z-10">
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="flex items-center gap-4">
              <motion.div
                initial={{ scale: 0, rotate: -30 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ duration: 0.7, ease: [0.34, 1.56, 0.64, 1], delay: 0.1 }}
                className="h-16 w-16 shrink-0 overflow-hidden rounded-[20px] border-2 border-white/55 shadow-[0_8px_24px_rgba(46,1,150,.45),0_0_0_3px_rgba(255,255,255,.14)]"
              >
                <img
                  src="/logo-mark.png"
                  alt="Anush Finserv"
                  className="h-full w-full object-cover"
                />
              </motion.div>
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, ease: 'easeOut', delay: 0.4 }}
                className="leading-none"
              >
                <img
                  src="/anush-text.svg"
                  alt="Anush Finserv"
                  style={{ height: '44px', width: 'auto', objectFit: 'contain' }}
                />
              </motion.div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut', delay: 0.55 }}
              className="mt-6"
            >
              <h1 className="font-display text-xl font-bold tracking-tight text-slate-50">
                Welcome back
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                Sign in to manage your loan portfolio
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

          <motion.div
            animate={loading ? { scale: 0.992, filter: 'brightness(0.96)' } : { scale: 1, filter: 'brightness(1)' }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <LoginForm onSubmit={onSubmit} loading={loading} mode={mode} onModeChange={setMode} />
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
}