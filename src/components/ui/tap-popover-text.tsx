import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  children: string;
  className?: string;
  /** Desktop hover tooltip; mobile uses tap popover when truncated. */
  title?: string;
};

/**
 * Truncated single-line label. On narrow viewports, tap opens a fixed popover
 * with the full text (tables inside horizontal scroll clip absolute popovers).
 */
export function TruncatedTapPopoverText({ children, className, title }: Props) {
  const text = children.trim();
  const label = title ?? text;
  const id = useId();
  const measureRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  const measure = useCallback(() => {
    const el = measureRef.current;
    if (!el) return;
    setTruncated(el.scrollWidth > el.clientWidth + 1);
  }, []);

  useEffect(() => {
    measure();
    const el = measureRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, text]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const openFromTap = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!truncated) return;
    const rect = measureRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pad = 12;
    const maxW = Math.min(288, window.innerWidth - pad * 2);
    const left = Math.min(Math.max(pad, rect.left), window.innerWidth - maxW - pad);
    setAnchor({ top: rect.bottom + 6, left });
    setOpen(true);
  };

  if (!text) return <span className={className}>—</span>;

  return (
    <>
      <span className={cn('relative block min-w-0 max-w-full', className)}>
        <span
          ref={measureRef}
          className="block min-w-0 truncate"
          title={label}
        >
          {text}
        </span>
        {truncated && (
          <button
            type="button"
            className={cn(
              'absolute inset-0 z-[1] sm:hidden',
              'rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            )}
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            aria-label={`Show full name: ${text}`}
            onClick={openFromTap}
          />
        )}
      </span>

      {open && anchor && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[80] sm:hidden"
            aria-label="Close"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
          />
          <div
            id={id}
            role="dialog"
            aria-label={label}
            className={cn(
              'fixed z-[90] sm:hidden',
              'max-w-[min(18rem,calc(100vw-1.5rem))] rounded-xl border border-slate-200/90 bg-surface px-3.5 py-2.5',
              'text-[13.5px] font-semibold leading-snug text-ink shadow-card',
              'dark:border-white/[.1]',
            )}
            style={{ top: anchor.top, left: anchor.left }}
            onClick={(e) => e.stopPropagation()}
          >
            {text}
          </div>
        </>
      )}
    </>
  );
}
