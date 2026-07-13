import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';
interface Toast { id: number; msg: string; type: ToastType }
const ToastCtx = createContext<(msg: string, type?: ToastType) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((msg: string, type: ToastType = 'success') => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, msg, type }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 3200);
  }, []);
  const Icon = { success: CheckCircle2, error: AlertCircle, info: Info };
  const chip = { success: 'bg-success-50 text-success dark:bg-success/15', error: 'bg-danger-50 text-danger dark:bg-danger/15', info: 'bg-primary-50 text-primary dark:bg-primary/15' };
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="fixed bottom-5 right-5 z-[200] flex flex-col gap-2.5">
        {items.map((t) => {
          const I = Icon[t.type];
          return (
            <div key={t.id} className="glass flex items-center gap-3 rounded-xl border border-slate-200/70 dark:border-white/[.08] pl-3 pr-4 py-3 shadow-[0_12px_32px_-8px_rgba(15,23,42,.25)] dark:shadow-[0_12px_32px_-8px_rgba(0,0,0,.6)] animate-rise">
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${chip[t.type]}`}><I size={15} /></span>
              <span className="text-sm font-medium tracking-tight">{t.msg}</span>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
