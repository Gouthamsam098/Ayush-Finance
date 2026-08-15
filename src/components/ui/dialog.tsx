import { type ReactNode, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Escape-key stack. Every open Dialog pushes its id; only the TOP of the stack
 * responds to Escape. Without this, a nested dialog (the Add-collection form
 * inside LedgerDialog) and its parent both had listeners on `document`, so one
 * Escape closed BOTH — losing a half-entered payment and the ledger behind it.
 */
const escStack: string[] = [];

/** Focusable descendants, in DOM order, for the Tab cycle. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ open, onClose, title, subtitle, children, footer, wide, xl }:
  { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; wide?: boolean; xl?: boolean }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const id = useId();

  // Escape — only for the topmost dialog (see escStack).
  useEffect(() => {
    if (!open) return;
    escStack.push(id);
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (escStack[escStack.length - 1] !== id) return; // a child dialog owns it
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('keydown', onEsc);
      const i = escStack.lastIndexOf(id);
      if (i !== -1) escStack.splice(i, 1);
    };
  }, [open, onClose, id]);

  // Focus management: move focus in on open, keep Tab inside the panel, and
  // restore focus to the element that opened the dialog on close. Without this
  // a keyboard user tabs straight out into the page behind the modal.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;

    // Focus the first field (skipping the close button so the user lands on
    // content), else the panel itself.
    const panel = panelRef.current;
    const first = panel?.querySelectorAll<HTMLElement>(FOCUSABLE);
    const target = first && first.length > 1 ? first[1] : first?.[0] ?? panel;
    target?.focus();

    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !panelRef.current) return;
      // Only the topmost dialog traps, so a nested dialog cycles its own fields.
      if (escStack[escStack.length - 1] !== id) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => el.offsetParent !== null); // skip hidden
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === firstEl || !panelRef.current.contains(active))) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onTab);

    // Prevent the page behind from scrolling while the modal is up (the Drawer
    // already did this; the Dialog did not).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onTab);
      document.body.style.overflow = prevOverflow;
      // Restore focus so the user returns to the row/button they came from.
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open, id]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-md" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        // 90dvh (not vh): on mobile Safari `vh` resolves against the largest
        // viewport, so with the toolbar visible the non-scrolling footer — which
        // holds the confirm action — could sit under the browser chrome.
        className={`relative flex max-h-[90dvh] w-full ${xl ? 'max-w-6xl' : wide ? 'max-w-3xl' : 'max-w-lg'} flex-col overflow-hidden rounded-card border border-slate-200/70 dark:border-white/[.08] bg-white dark:bg-surface shadow-[0_24px_70px_-20px_rgba(0,0,0,.35)] dark:shadow-[0_24px_70px_-20px_rgba(0,0,0,.7)] animate-rise`}
      >
        <div className="flex items-start justify-between border-b border-slate-100 dark:border-white/[.06] px-6 py-4">
          <div>
            <h3 id={titleId} className="font-display text-lg font-bold tracking-tight">{title}</h3>
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close dialog" title="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-slate-100 dark:hover:bg-white/[.06] transition-colors"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 dark:border-white/[.06] bg-slate-50/50 dark:bg-white/[.02] px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}
