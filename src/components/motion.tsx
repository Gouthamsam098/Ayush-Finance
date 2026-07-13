import { useEffect, useRef, useState, type ReactNode, type HTMLAttributes } from 'react';
import { motion, useInView, useMotionValue, animate, type Variants } from 'framer-motion';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────
   TiltCard — mouse-tracking 3D tilt + spotlight glow.
   Wraps any content; sets CSS vars consumed by .tilt / .tilt-glow.
   ──────────────────────────────────────────────────────────── */
export function TiltCard({
  children, className, max = 9, glow = true, style, ...rest
}: { children: ReactNode; className?: string; max?: number; glow?: boolean } & HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;   // 0..1
    const py = (e.clientY - r.top) / r.height;   // 0..1
    el.style.setProperty('--ry', `${(px - 0.5) * max * 2}deg`);
    el.style.setProperty('--rx', `${(0.5 - py) * max * 2}deg`);
    el.style.setProperty('--gx', `${px * 100}%`);
    el.style.setProperty('--gy', `${py * 100}%`);
  };
  const reset = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      className={cn('tilt', glow && 'tilt-glow', className)}
      style={style}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Reveal — staggered fade/slide/pop as elements scroll into view.
   ──────────────────────────────────────────────────────────── */
const revealVariants: Variants = {
  hidden: { opacity: 0, y: 26, rotateX: 8, scale: 0.97 },
  show: (i: number) => ({
    opacity: 1, y: 0, rotateX: 0, scale: 1,
    transition: { delay: i * 0.06, duration: 0.55, ease: [0.16, 1, 0.3, 1] },
  }),
};
export function Reveal({
  children, className, index = 0, once = true,
}: { children: ReactNode; className?: string; index?: number; once?: boolean }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once, margin: '-40px' });
  return (
    <motion.div
      ref={ref}
      custom={index}
      variants={revealVariants}
      initial="hidden"
      animate={inView ? 'show' : 'hidden'}
      style={{ transformPerspective: 900 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ────────────────────────────────────────────────────────────
   CountUp — animate a number from 0 → value when it mounts / changes.
   `format` lets callers render currency etc.
   ──────────────────────────────────────────────────────────── */
export function CountUp({
  value, format = (n) => Math.round(n).toLocaleString('en-IN'), duration = 1.1, className,
}: { value: number; format?: (n: number) => string; duration?: number; className?: string }) {
  const mv = useMotionValue(0);
  const [display, setDisplay] = useState(() => format(0));
  useEffect(() => {
    const controls = animate(mv, value, {
      duration, ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(format(v)),
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);
  return <span className={className}>{display}</span>;
}
