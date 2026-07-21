import { motion } from 'framer-motion';
import { Zap, ShieldCheck, FileText, Headphones } from 'lucide-react';
import Logo from './Logo';
import LoginForm from './LoginForm';

interface LoginCardProps {
  onSubmit: (username: string, password: string) => void;
  loading?: boolean;
  error?: string | null;
}

const FEATURES = [
  { icon: Zap, title: 'Fast Approval', sub: 'Quick processing', color: 'text-amber-500 bg-amber-50' },
  { icon: ShieldCheck, title: 'Secure', sub: '256-bit encryption', color: 'text-emerald-600 bg-emerald-50' },
  { icon: FileText, title: 'Digital Docs', sub: 'Paperless process', color: 'text-blue-600 bg-blue-50' },
  { icon: Headphones, title: '24×7 Support', sub: 'Always available', color: 'text-blue-600 bg-blue-50' },
];

export default function LoginCard({ onSubmit, loading = false, error = null }: LoginCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-md"
    >
      {/* Glass card with soft green glow + gentle float */}
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        className="rounded-[28px] border border-white/60 bg-white/80 p-8 backdrop-blur-2xl md:p-10"
        style={{ boxShadow: '0 24px 70px -20px rgba(37,99,235,.38), 0 8px 24px -12px rgba(15,23,42,.15)' }}
      >
        <div className="mb-7 flex flex-col items-center text-center">
          <Logo size="lg" />
          <h1 className="mt-6 text-2xl font-bold tracking-tight text-slate-900">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your account to continue</p>
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
          >
            {error}
          </motion.div>
        )}

        <LoginForm onSubmit={onSubmit} loading={loading} />
      </motion.div>

      {/* Compact glass feature cards */}
      <div className="mt-5 grid grid-cols-2 gap-3">
        {FEATURES.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 + i * 0.08 }}
            className="flex items-center gap-2.5 rounded-2xl border border-white/50 bg-white/70 px-3 py-2.5 backdrop-blur-xl"
          >
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${f.color}`}>
              <f.icon size={16} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-xs font-bold text-slate-800">{f.title}</div>
              <div className="truncate text-[11px] text-slate-500">{f.sub}</div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
