import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Lock, Eye, EyeOff, ArrowRight, User, Loader2, Mail, ArrowLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';

export type AuthMode = 'signin' | 'signup';

interface LoginFormProps {
  onSubmit: (u: string, p: string) => void;
  loading?: boolean;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
}

function AuthField({
  id, label, icon, focused, onFocus, onBlur, error, right, ...inputProps
}: {
  id: string;
  label: string;
  icon: ReactNode;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  error?: string;
  right?: ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-400">
        {label}
      </label>
      <div
        className={cn(
          'relative rounded-2xl border-2 transition-all duration-300',
          error
            ? 'border-danger/60 bg-danger/[.06]'
            : focused
              ? 'border-[#188BFC] bg-white/[.08] shadow-[0_0_0_4px_rgba(24,139,252,.18)]'
              : 'border-white/10 bg-white/[.04] hover:border-white/20 hover:bg-white/[.06]',
        )}
      >
        <div className="absolute left-4 top-1/2 -translate-y-1/2">
          <span className={focused ? 'text-sky-400' : 'text-slate-500'}>{icon}</span>
        </div>
        <input
          id={id}
          onFocus={onFocus}
          onBlur={onBlur}
          className={cn(
            'h-[52px] w-full rounded-2xl bg-transparent px-4 pl-12 text-[15px] font-medium text-white outline-none placeholder:text-slate-500',
            right && 'pr-12',
          )}
          {...inputProps}
        />
        {right && <div className="absolute right-4 top-1/2 -translate-y-1/2">{right}</div>}
      </div>
      {error && <p className="mt-1.5 px-1 text-[12px] font-medium text-rose-300">{error}</p>}
    </div>
  );
}

export default function LoginForm({ onSubmit, loading = false, mode, onModeChange }: LoginFormProps) {
  const toast = useToast();

  // Sign in state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Sign up state
  const [suUsername, setSuUsername] = useState('');
  const [suEmail, setSuEmail] = useState('');
  const [suPassword, setSuPassword] = useState('');
  const [suConfirm, setSuConfirm] = useState('');
  const [showSuPassword, setShowSuPassword] = useState(false);
  const [showSuConfirm, setShowSuConfirm] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [focused, setFocused] = useState<string | null>(null);
  const [pressRipple, setPressRipple] = useState(0);

  const handleSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    if (username && password) {
      setPressRipple((n) => n + 1);
      onSubmit(username, password);
    }
  };

  const handleSignUp = (e: React.FormEvent) => {
    e.preventDefault();
    if (suPassword !== suConfirm) {
      setConfirmError('Passwords do not match');
      return;
    }
    setConfirmError(null);
    setCreating(true);
    setTimeout(() => {
      setCreating(false);
      toast('Sign-up requests aren’t enabled yet — please contact your administrator for access.', 'info');
    }, 600);
  };

  if (mode === 'signup') {
    return (
      <form onSubmit={handleSignUp} className="space-y-5">
        <AuthField
          id="signup-username"
          label="Username"
          icon={<User size={18} />}
          focused={focused === 'su-user'}
          onFocus={() => setFocused('su-user')}
          onBlur={() => setFocused(null)}
          type="text"
          name="username"
          autoComplete="username"
          required
          placeholder="Choose a username"
          value={suUsername}
          onChange={(e) => setSuUsername(e.target.value)}
        />

        <AuthField
          id="signup-email"
          label="Email"
          icon={<Mail size={18} />}
          focused={focused === 'su-email'}
          onFocus={() => setFocused('su-email')}
          onBlur={() => setFocused(null)}
          type="email"
          name="email"
          autoComplete="email"
          required
          placeholder="you@company.com"
          value={suEmail}
          onChange={(e) => setSuEmail(e.target.value)}
        />

        <AuthField
          id="signup-password"
          label="Password"
          icon={<Lock size={18} />}
          focused={focused === 'su-pass'}
          onFocus={() => setFocused('su-pass')}
          onBlur={() => setFocused(null)}
          type={showSuPassword ? 'text' : 'password'}
          name="new-password"
          autoComplete="new-password"
          required
          placeholder="Create a password"
          value={suPassword}
          onChange={(e) => { setSuPassword(e.target.value); setConfirmError(null); }}
          right={(
            <button type="button" onClick={() => setShowSuPassword((s) => !s)}
              className="text-slate-500 transition-colors hover:text-sky-300"
              aria-label={showSuPassword ? 'Hide password' : 'Show password'}>
              {showSuPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          )}
        />

        <AuthField
          id="signup-confirm-password"
          label="Confirm password"
          icon={<Lock size={18} />}
          focused={focused === 'su-confirm'}
          onFocus={() => setFocused('su-confirm')}
          onBlur={() => setFocused(null)}
          error={confirmError ?? undefined}
          type={showSuConfirm ? 'text' : 'password'}
          name="confirm-password"
          autoComplete="new-password"
          required
          placeholder="Re-enter your password"
          value={suConfirm}
          onChange={(e) => { setSuConfirm(e.target.value); setConfirmError(null); }}
          right={(
            <button type="button" onClick={() => setShowSuConfirm((s) => !s)}
              className="text-slate-500 transition-colors hover:text-sky-300"
              aria-label={showSuConfirm ? 'Hide password' : 'Show password'}>
              {showSuConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          )}
        />

        <button type="submit" disabled={creating}
          className="group relative flex h-[52px] w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-[#188BFC] to-sky-400 text-[15px] font-semibold text-white shadow-lg shadow-[#188BFC]/30 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[#188BFC]/45 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0">
          <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-white/0 via-white/15 to-white/0 transition-transform duration-700 group-hover:translate-x-full" />
          <span className="relative z-10">{creating ? 'Creating account…' : 'Create account'}</span>
          {creating
            ? <Loader2 size={18} className="relative z-10 animate-spin" />
            : <ArrowRight size={18} className="relative z-10 transition-transform duration-300 group-hover:translate-x-1" />}
        </button>

        <div className="flex items-center justify-center gap-1.5 text-[13px] text-slate-400">
          Already have an account?
          <button type="button" onClick={() => onModeChange('signin')}
            className="inline-flex items-center gap-1 font-semibold text-sky-300 transition-colors hover:text-sky-200">
            <ArrowLeft size={13} /> Sign in
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={handleSignIn} className="space-y-5">
      <AuthField
        id="login-username"
        label="Username"
        icon={<User size={18} />}
        focused={focused === 'user'}
        onFocus={() => setFocused('user')}
        onBlur={() => setFocused(null)}
        type="text"
        name="username"
        autoComplete="username"
        autoFocus
        required
        placeholder="Enter your username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        disabled={loading}
      />

      <AuthField
        id="login-password"
        label="Password"
        icon={<Lock size={18} />}
        focused={focused === 'pass'}
        onFocus={() => setFocused('pass')}
        onBlur={() => setFocused(null)}
        type={showPassword ? 'text' : 'password'}
        name="password"
        autoComplete="current-password"
        required
        placeholder="Enter your password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={loading}
        right={(
          <button type="button" onClick={() => setShowPassword((s) => !s)} disabled={loading}
            className="text-slate-500 transition-colors hover:text-sky-300 disabled:opacity-50"
            aria-label={showPassword ? 'Hide password' : 'Show password'}>
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      />

      <div className="flex items-center justify-between px-1">
        <label className="flex cursor-pointer items-center gap-2 select-none">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
            disabled={loading}
            className="h-[18px] w-[18px] cursor-pointer rounded-[5px] border-2 border-white/20 bg-white/5 text-[#188BFC] focus:ring-2 focus:ring-[#188BFC]/30 focus:ring-offset-0 checked:border-[#188BFC] checked:bg-[#188BFC]" />
          <span className="text-[13px] font-medium text-slate-300">Remember me</span>
        </label>
        <a href="#" className="text-[13px] font-semibold text-sky-300 transition-colors hover:text-sky-200">Forgot password?</a>
      </div>

      <motion.button
        type="submit"
        disabled={loading}
        whileHover={loading ? undefined : { y: -2, scale: 1.01 }}
        whileTap={loading ? undefined : { scale: 0.985, y: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 28 }}
        className={cn(
          'group relative flex h-[52px] w-full items-center justify-center gap-2 overflow-hidden rounded-2xl text-[15px] font-semibold text-white',
          'bg-gradient-to-r from-blue-600 via-[#188BFC] to-sky-400',
          'shadow-[0_12px_28px_-8px_rgba(24,139,252,.55)]',
          'disabled:cursor-not-allowed',
        )}
      >
        {/* Ambient sheen on hover */}
        <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent_20%,rgba(255,255,255,.18)_50%,transparent_80%)] bg-[length:200%_100%] opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-hover:animate-[signin-sheen_1.1s_ease]" />

        {/* Click ripple */}
        <AnimatePresence>
          {pressRipple > 0 && (
            <motion.span
              key={pressRipple}
              initial={{ scale: 0, opacity: 0.45 }}
              animate={{ scale: 2.6, opacity: 0 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="pointer-events-none absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/35"
            />
          )}
        </AnimatePresence>

        {/* Loading progress sweep */}
        {loading && (
          <motion.span
            className="pointer-events-none absolute inset-y-0 left-0 bg-white/15"
            initial={{ width: '8%' }}
            animate={{ width: ['12%', '72%', '88%'] }}
            transition={{ duration: 1.4, ease: 'easeInOut', repeat: Infinity, repeatType: 'mirror' }}
          />
        )}

        <AnimatePresence mode="wait" initial={false}>
          {loading ? (
            <motion.span
              key="loading"
              initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="relative z-10 flex items-center gap-2.5"
            >
              <span className="relative grid h-5 w-5 place-items-center">
                <span className="absolute inset-0 rounded-full border-2 border-white/25" />
                <motion.span
                  className="absolute inset-0 rounded-full border-2 border-transparent border-t-white"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.75, repeat: Infinity, ease: 'linear' }}
                />
              </span>
              <span>Signing in…</span>
            </motion.span>
          ) : (
            <motion.span
              key="idle"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22 }}
              className="relative z-10 flex items-center gap-2"
            >
              <span>Sign in</span>
              <motion.span
                className="inline-flex"
                animate={{ x: [0, 3, 0] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              >
                <ArrowRight size={18} />
              </motion.span>
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </form>
  );
}
