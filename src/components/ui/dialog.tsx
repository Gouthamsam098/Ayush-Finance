import { type ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';

export function Dialog({ open, onClose, title, subtitle, children, footer, wide }:
  { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-md" />
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative flex max-h-[90vh] w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} flex-col overflow-hidden rounded-card border border-slate-200/70 dark:border-white/[.08] bg-white dark:bg-surface shadow-[0_24px_70px_-20px_rgba(0,0,0,.35)] dark:shadow-[0_24px_70px_-20px_rgba(0,0,0,.7)] animate-rise`}
      >
        <div className="flex items-start justify-between border-b border-slate-100 dark:border-white/[.06] px-6 py-4">
          <div>
            <h3 className="font-display text-lg font-bold tracking-tight">{title}</h3>
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-slate-100 dark:hover:bg-white/[.06] transition-colors"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 dark:border-white/[.06] bg-slate-50/50 dark:bg-white/[.02] px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}
