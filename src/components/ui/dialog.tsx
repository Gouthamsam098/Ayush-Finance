import { type ReactNode, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

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

export function Dialog({ open, onClose, title, subtitle, children, footer, footerClassName, wide, xl, hideShell, nested, centerOnMobile }:
  { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode; footerClassName?: string; wide?: boolean; xl?: boolean; /** Renders children only — for a child modal to own the overlay (avoids double blur). */ hideShell?: boolean; /** Second modal on the stack: no extra backdrop-blur (parent already dimmed the page). */ nested?: boolean; /** Center the panel on small screens (default: bottom sheet). */ centerOnMobile?: boolean }) {
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
  if (hideShell) return <>{children}</>;

  const shellZ = nested ? 'z-[110]' : 'z-[100]';
  const backdropClass = nested
    ? 'absolute inset-0 bg-slate-950/45'
    : 'absolute inset-0 bg-slate-950/60 backdrop-blur-md';

  return (
    <div
      className={cn(
        `fixed inset-0 ${shellZ} flex justify-center`,
        centerOnMobile
          ? 'items-center p-3 pt-safe pb-safe sm:p-4 md:p-6'
          : 'items-end px-safe pb-safe pt-safe sm:items-center sm:p-4 md:p-6',
      )}
      onClick={onClose}
    >
      <div className={backdropClass} />
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
        // min-w-0 + calc width: iPad Air / tablet split-view must not let
        // native date controls blow past the panel and misalign Remarks, etc.
        className={cn(
          'relative flex max-h-[min(90dvh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1rem))] w-full min-w-0 flex-col overflow-hidden border border-slate-200/70 bg-white shadow-[0_24px_70px_-20px_rgba(0,0,0,.35)] animate-rise dark:border-white/[.08] dark:bg-surface dark:shadow-[0_24px_70px_-20px_rgba(0,0,0,.7)] sm:rounded-card',
          centerOnMobile ? 'rounded-card' : 'rounded-t-[1.25rem]',
          xl ? 'max-w-[min(84rem,calc(100vw-1.5rem))]' : wide ? 'max-w-[min(48rem,calc(100vw-1.5rem))]' : 'max-w-[min(32rem,calc(100vw-1.5rem))]',
        )}
      >
        <div
          className={cn(
            'flex items-start justify-between border-b border-slate-100 px-4 py-4 dark:border-white/[.06] sm:px-6',
            centerOnMobile && 'relative text-center sm:text-left',
          )}
        >
          <div className={cn('min-w-0 pr-3', centerOnMobile && 'mx-auto max-w-[calc(100%-2.5rem)] sm:mx-0 sm:max-w-none')}>
            <h3 id={titleId} className="font-display text-lg font-bold tracking-tight">{title}</h3>
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            title="Close"
            className={cn(
              'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-slate-100 dark:hover:bg-white/[.06]',
              centerOnMobile && 'absolute right-3 top-4 sm:static',
            )}
          >
            <X size={18} />
          </button>
        </div>
        <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-5 sm:px-6">{children}</div>
        {footer && (
          <div
            className={cn(
              'flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/50 px-4 py-4 dark:border-white/[.06] dark:bg-white/[.02] sm:px-6',
              footerClassName,
            )}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
