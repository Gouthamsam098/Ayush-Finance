import { useState } from 'react';
import { Lock, Eye, EyeOff, ArrowRight, User } from 'lucide-react';
import { config } from '@/lib/config';

interface LoginFormProps { onSubmit: (u: string, p: string) => void; loading?: boolean; }

export default function LoginForm({ onSubmit, loading = false }: LoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState<'user' | 'pass' | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username && password) onSubmit(username, password);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <div className={`relative rounded-2xl border-2 transition-all duration-300 ${focused === 'user' ? 'border-blue-500 shadow-[0_0_0_4px_rgba(59,130,246,.1)]' : 'border-slate-200 hover:border-slate-300'}`}>
          <div className="absolute left-4 top-1/2 -translate-y-1/2">
            <User size={18} className={focused === 'user' ? 'text-blue-500' : 'text-slate-400'} />
          </div>
          <input type="text" placeholder="Username" value={username}
            onChange={(e) => setUsername(e.target.value)}
            onFocus={() => setFocused('user')} onBlur={() => setFocused(null)}
            className="h-[52px] w-full rounded-2xl bg-transparent px-4 pl-12 text-[15px] font-medium text-slate-900 outline-none placeholder:text-slate-400" />
        </div>
      </div>

      <div>
        <div className={`relative rounded-2xl border-2 transition-all duration-300 ${focused === 'pass' ? 'border-blue-500 shadow-[0_0_0_4px_rgba(59,130,246,.1)]' : 'border-slate-200 hover:border-slate-300'}`}>
          <div className="absolute left-4 top-1/2 -translate-y-1/2">
            <Lock size={18} className={focused === 'pass' ? 'text-blue-500' : 'text-slate-400'} />
          </div>
          <input type={showPassword ? 'text' : 'password'} placeholder="Password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            onFocus={() => setFocused('pass')} onBlur={() => setFocused(null)}
            className="h-[52px] w-full rounded-2xl bg-transparent px-4 pl-12 pr-12 text-[15px] font-medium text-slate-900 outline-none placeholder:text-slate-400" />
          <button type="button" onClick={() => setShowPassword((s) => !s)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600"
            aria-label={showPassword ? 'Hide password' : 'Show password'}>
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between px-1">
        <label className="flex cursor-pointer items-center gap-2 select-none">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
            className="h-[18px] w-[18px] cursor-pointer rounded-[5px] border-2 border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-0 checked:border-blue-600 checked:bg-blue-600" />
          <span className="text-[13px] font-medium text-slate-600">Remember me</span>
        </label>
        <a href="#" className="text-[13px] font-semibold text-blue-600 hover:text-blue-700 transition-colors">Forgot password?</a>
      </div>

      <button type="submit" disabled={loading}
        className="group relative flex h-[52px] w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-700 via-blue-600 to-blue-500 text-[15px] font-semibold text-white shadow-lg shadow-blue-500/25 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-blue-500/35 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60">
        <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
        <span className="relative z-10">{loading ? 'Signing in…' : 'Sign In'}</span>
        {!loading && <ArrowRight size={18} className="relative z-10 transition-transform duration-300 group-hover:translate-x-1" />}
      </button>

      {!config.useApi && (
        <p className="text-center text-[12px] text-slate-400">Enter any username and password to continue</p>
      )}
    </form>
  );
}
