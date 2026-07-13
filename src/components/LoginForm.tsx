import { useState } from 'react';
import { User, Lock, Eye, EyeOff } from 'lucide-react';
import Input from './Input';
import Button from './Button';

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
    if (username && password) {
      onSubmit(username, password);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Input
        label="Username"
        type="text"
        placeholder="Enter your username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        icon={<User size={20} />}
      />

      <div>
        <label className="block text-base font-semibold text-slate-900 mb-2">Password</label>
        <div className="relative">
          <Lock className="absolute left-4 top-4 w-5 h-5 text-slate-400" />
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full pl-12 pr-12 py-3 border border-slate-300 rounded-lg text-base transition-all focus:ring-2 focus:ring-emerald-500 focus:border-transparent focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between text-base">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="w-5 h-5 rounded border-slate-300 text-emerald-600 focus:ring-2 focus:ring-emerald-500 cursor-pointer"
          />
          <span className="text-slate-700">Remember me</span>
        </label>
        <a href="#" className="text-emerald-600 hover:text-emerald-700 font-semibold">
          Forgot password?
        </a>
      </div>

      <Button type="submit" fullWidth disabled={loading}>
        {loading ? 'Signing in...' : 'Sign in'}
      </Button>

      <div className="relative my-8">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-300" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-3 bg-white text-slate-600 font-medium">or continue with</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Button variant="secondary">
          <span className="text-red-600 font-bold mr-2 text-lg">G</span>
          Google
        </Button>
        <Button variant="secondary">
          <svg className="w-5 h-5 fill-black mr-2" viewBox="0 0 24 24">
            <path d="M17.05 20.28c-.98.95-2.05.8-3.08.38-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.38C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.48-2.53 3.23l-.35-.28zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
          </svg>
          Apple
        </Button>
      </div>

      <p className="text-center text-base text-slate-700">
        New here?{' '}
        <a href="#" className="text-emerald-600 hover:text-emerald-700 font-semibold">
          Create an account
        </a>
      </p>

      <div className="pt-8 border-t border-slate-200 flex items-center justify-center gap-2 text-sm text-slate-600">
        <svg className="w-5 h-5 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
          <path d="M5 13a3 3 0 105 5h6a1 1 0 001-1v-5a1 1 0 011-1h2a1 1 0 001-1V5a1 1 0 00-1-1H7a1 1 0 00-1 1v3a1 1 0 01-1 1H3a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-3z" />
        </svg>
        Your data is protected with 256-bit SSL encryption
      </div>
    </form>
  );
}
