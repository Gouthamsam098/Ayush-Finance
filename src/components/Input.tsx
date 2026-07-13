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
      <label className="block text-sm font-semibold text-slate-900 ml-1">{label}</label>
      <div className="relative group">
        {icon && <div className="absolute left-4 top-3.5 text-slate-400 group-focus-within:text-slate-700 transition-colors">{icon}</div>}
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          className={`w-full ${icon ? 'pl-12' : 'pl-4'} pr-4 py-3 border rounded-lg text-base transition-all shadow-sm hover:shadow-md ${
            error
              ? 'border-red-300 bg-red-50 focus:ring-2 focus:ring-red-500 focus:border-transparent focus:bg-white'
              : 'border-slate-200 bg-slate-50 hover:bg-white focus:ring-2 focus:ring-slate-700 focus:border-slate-300 focus:bg-white'
          } focus:outline-none placeholder:text-slate-400`}
        />
      </div>
      {error && <p className="text-xs text-red-600 ml-1">{error}</p>}
    </div>
  );
}
