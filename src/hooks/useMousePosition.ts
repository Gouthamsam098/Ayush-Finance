import { useEffect } from 'react';
import { useMotionValue, useSpring, type MotionValue } from 'framer-motion';

export interface MousePositionResult {
  /** Normalized -0.5 .. 0.5 relative to element center (spring-smoothed) */
  nx: MotionValue<number>;
  ny: MotionValue<number>;
  /** 0 .. 100 percent within element (spring-smoothed) */
  px: MotionValue<number>;
  py: MotionValue<number>;
}

const springConfig = { stiffness: 120, damping: 18, mass: 0.4 };

/**
 * Tracks mouse position relative to a container element.
 * Returns spring-smoothed motion values for use in Framer Motion transforms.
 * When disabled, values stay at center defaults (no listeners attached).
 */
export function useMousePosition(
  ref: React.RefObject<HTMLElement>,
  enabled: boolean,
): MousePositionResult {
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const rawPX = useMotionValue(50);
  const rawPY = useMotionValue(50);

  const nx = useSpring(rawX, springConfig);
  const ny = useSpring(rawY, springConfig);
  const px = useSpring(rawPX, springConfig);
  const py = useSpring(rawPY, springConfig);

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    const handleMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      rawX.set(x / rect.width - 0.5);
      rawY.set(y / rect.height - 0.5);
      rawPX.set((x / rect.width) * 100);
      rawPY.set((y / rect.height) * 100);
    };

    const handleLeave = () => {
      rawX.set(0);
      rawY.set(0);
      rawPX.set(50);
      rawPY.set(50);
    };

    el.addEventListener('mousemove', handleMove);
    el.addEventListener('mouseleave', handleLeave);
    return () => {
      el.removeEventListener('mousemove', handleMove);
      el.removeEventListener('mouseleave', handleLeave);
    };
  }, [ref, enabled, rawX, rawY, rawPX, rawPY]);

  return { nx, ny, px, py };
}