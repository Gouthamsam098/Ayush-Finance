import { useRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Mouse-tracking 3D tilt + spotlight glow on hover. */
  tilt?: boolean;
  /** Max tilt angle in degrees (default 7). */
  tiltMax?: number;
}

export function Card({ className, tilt, tiltMax = 7, onMouseMove, onMouseLeave, ...props }: CardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tilt) {
      const el = ref.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        el.style.setProperty('--ry', `${(px - 0.5) * tiltMax * 2}deg`);
        el.style.setProperty('--rx', `${(0.5 - py) * tiltMax * 2}deg`);
        el.style.setProperty('--gx', `${px * 100}%`);
        el.style.setProperty('--gy', `${py * 100}%`);
      }
    }
    onMouseMove?.(e);
  };
  const handleLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tilt) {
      const el = ref.current;
      if (el) { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); }
    }
    onMouseLeave?.(e);
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={cn(
        'rounded-card border border-slate-200/70 dark:border-white/[.06] bg-white dark:bg-surface',
        'shadow-card dark:shadow-card-dark',
        tilt
          ? 'tilt tilt-glow hover:shadow-[0_28px_60px_-24px_rgba(79,70,229,.5)]'
          : 'tilt-raise hover:shadow-[0_20px_48px_-24px_rgba(79,70,229,.35)]',
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-6 pt-5 pb-4 flex items-start justify-between gap-3', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('font-display text-[17px] font-bold tracking-tight', className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-6 pb-6', className)} {...props} />;
}
