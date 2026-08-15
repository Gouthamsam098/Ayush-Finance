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
    // Errors linger: a toast is the ONLY confirmation channel for money
    // mutations, and a screen reader needs time to queue and read the message
    // before it is removed from the DOM (WCAG 2.2.1).
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), type === 'error' ? 6000 : 3200);
  }, []);
  const Icon = { success: CheckCircle2, error: AlertCircle, info: Info };
  const chip = { success: 'bg-success-50 text-success dark:bg-success/15', error: 'bg-danger-50 text-danger dark:bg-danger/15', info: 'bg-primary-50 text-primary dark:bg-primary/15' };
  const row = (t: Toast) => {
    const I = Icon[t.type];
    return (
      <div key={t.id} className="glass flex items-center gap-3 rounded-xl border border-slate-200/70 dark:border-white/[.08] pl-3 pr-4 py-3 shadow-[0_12px_32px_-8px_rgba(15,23,42,.25)] dark:shadow-[0_12px_32px_-8px_rgba(0,0,0,.6)] animate-rise">
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${chip[t.type]}`} aria-hidden="true"><I size={15} /></span>
        <span className="text-sm font-medium tracking-tight">{t.msg}</span>
      </div>
    );
  };
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      {/* Two live regions, because urgency differs and a single region cannot
          mix politeness levels:
            • errors  → role="alert" + assertive: interrupts, so a refused
              action ("Cannot close — outstanding balance remains") is never
              missed. Silence here previously read as success.
            • success/info → role="status" + polite: queued, non-interrupting.
          Both containers are always mounted so assistive tech observes the
          region before content arrives (a region added at the same time as its
          text is often not announced). */}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[200] flex flex-col gap-2.5">
        <div role="alert" aria-live="assertive" aria-atomic="false" className="flex flex-col gap-2.5">
          {items.filter((t) => t.type === 'error').map(row)}
        </div>
        <div role="status" aria-live="polite" aria-atomic="false" className="flex flex-col gap-2.5">
          {items.filter((t) => t.type !== 'error').map(row)}
        </div>
      </div>
    </ToastCtx.Provider>
  );
}
