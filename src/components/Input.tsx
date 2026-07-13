import { ReactNode } from 'react';

interface InputProps {
  label: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  icon?: ReactNode;
  error?: string;
}

export default function Input({
  label,
  type = 'text',
  placeholder,
  value,
  onChange,
  icon,
  error,
}: InputProps) {
  return (
    <div className="space-y-2">
      <label className="block text-base font-semibold text-slate-900">{label}</label>
      <div className="relative">
        {icon && <div className="absolute left-4 top-4 text-slate-400">{icon}</div>}
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          className={`w-full ${icon ? 'pl-12' : 'pl-4'} pr-4 py-3 border rounded-lg text-base transition-all ${
            error
              ? 'border-red-500 focus:ring-2 focus:ring-red-500 focus:border-transparent'
              : 'border-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-transparent'
          } focus:outline-none`}
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
