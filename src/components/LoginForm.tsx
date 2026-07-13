import { useState } from 'react';
import { Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { config } from '@/lib/config';

interface LoginFormProps {
  onSubmit: (username: string, password: string) => void;
  loading?: boolean;
}

export default function LoginForm({ onSubmit, loading = false }: LoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username && password) onSubmit(username, password);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Email / Username */}
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">
          {config.useApi ? 'Email' : 'Username'}
        </label>
        <div className="group relative">
          <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-emerald-600" />
          <input
            type="text"
            placeholder={config.useApi ? 'you@company.com' : 'Enter your username'}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-11 pr-4 text-sm text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,.04)] outline-none transition-all placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
          />
        </div>
      </div>

      {/* Password */}
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-slate-700">Password</label>
        <div className="group relative">
          <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-emerald-600" />
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-11 pr-11 text-sm text-slate-900 shadow-[inset_0_1px_2px_rgba(15,23,42,.04)] outline-none transition-all placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>

      {/* Remember / forgot */}
      <div className="flex items-center justify-between text-sm">
        <label className="flex cursor-pointer items-center gap-2 select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-4 w-4 cursor-pointer rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span className="text-slate-600">Remember me</span>
        </label>
        <a href="#" className="font-semibold text-emerald-600 hover:text-emerald-700">Forgot password?</a>
      </div>

      {/* Gradient Sign In button */}
      <button
        type="submit"
        disabled={loading}
        className="group relative flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-green-600 to-emerald-500 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-emerald-500/40 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
      >
        <span>{loading ? 'Signing in…' : 'Sign In'}</span>
        {!loading && <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />}
      </button>
    </form>
  );
}
