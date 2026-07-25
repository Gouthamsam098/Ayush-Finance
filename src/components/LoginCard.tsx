import { motion } from 'framer-motion';
import { LogoMark } from './Logo';
import LoginForm from './LoginForm';

interface LoginCardProps {
  onSubmit: (username: string, password: string) => void;
  loading?: boolean;
  error?: string | null;
}

export default function LoginCard({ onSubmit, loading = false, error = null }: LoginCardProps) {
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
        className="relative rounded-[28px] border border-white/20 bg-white/90 p-8 backdrop-blur-2xl md:p-10 shadow-[0_32px_80px_-16px_rgba(15,23,42,.45),0_0_0_1px_rgba(255,255,255,.1),inset_0_1px_0_rgba(255,255,255,.6)]"
      >
        <div className="pointer-events-none absolute -top-20 left-1/2 h-40 w-80 -translate-x-1/2 rounded-full bg-blue-500/10 blur-3xl" />

        <div className="relative z-10">
          <div className="mb-8 flex flex-col items-center text-center">
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
                <div className="font-display text-[26px] font-extrabold uppercase tracking-tight text-blue-700">ANUSH</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="h-px w-4 bg-blue-500/50" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-blue-700 leading-none">FINSERV</span>
                  <span className="h-px w-4 bg-blue-500/50" />
                </div>
              </motion.div>
            </div>
          </div>

          {error && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
              className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </motion.div>
          )}

          <LoginForm onSubmit={onSubmit} loading={loading} />
        </div>
      </motion.div>
    </motion.div>
  );
}