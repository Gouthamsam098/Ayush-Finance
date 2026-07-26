import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Drawer is a right-side slide-over panel used for create/edit forms that are
 * richer than a centered Dialog can comfortably hold. It mirrors the Dialog
 * API (open/onClose/title/footer) so callers can swap between the two.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  width = 'md',
  closeOnScrimClick = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'md' | 'lg' | 'xl';
  /** Set false for forms where an accidental outside click shouldn't discard in-progress input. Defaults to true to preserve existing drawers' behaviour. */
  closeOnScrimClick?: boolean;
}) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) {
      document.addEventListener('keydown', onEsc);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', onEsc);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const widthClass = width === 'xl' ? 'max-w-3xl' : width === 'lg' ? 'max-w-2xl' : 'max-w-xl';

  // Rendered through a portal to <body> so the fixed overlay is measured
  // against the real viewport — not a scrolled/transformed ancestor, which is
  // what caused a gap at the top.
  return createPortal(
    // z-index sits above the app shell (header z-30, mobile nav z-50) so no
    // logo/profile bleeds through. Scrim is opaque enough to fully hide the app.
    <div className="fixed inset-0 z-[200]">
      {/* Scrim */}
      <div
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
        onClick={closeOnScrimClick ? onClose : undefined}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        className={`absolute right-0 top-0 flex h-full w-full ${widthClass} flex-col bg-white dark:bg-surface shadow-[-8px_0_40px_-12px_rgba(0,0,0,.35)] animate-slide-in-right`}
      >
        {/* Header pinned; only the body scrolls. */}
        <div className="flex shrink-0 items-start justify-between border-b border-slate-100 dark:border-white/[.06] px-6 py-4">
          <div className="flex items-start gap-3">
            {icon && (
              <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary dark:bg-primary/15">
                {icon}
              </div>
            )}
            <div>
              <h3 className="font-display text-lg font-bold tracking-tight">{title}</h3>
              {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-slate-100 dark:hover:bg-white/[.06] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* scroll-smooth + overscroll-contain keep scrolling fluid and stop it
            from chaining to the page behind the drawer. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth px-6 py-5">
          {children}
        </div>

        {footer && (
          <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 dark:border-white/[.06] bg-slate-50/50 dark:bg-white/[.02] px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
