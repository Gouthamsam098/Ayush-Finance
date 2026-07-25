import { memo } from 'react';
import { motion, useTransform, type MotionValue } from 'framer-motion';

interface CursorGlowProps {
  px: MotionValue<number>;
  py: MotionValue<number>;
  visible: boolean;
}

function CursorGlowBase({ px, py, visible }: CursorGlowProps) {
  const left = useTransform(px, (v) => `${v}%`);
  const top = useTransform(py, (v) => `${v}%`);

  return (
    <motion.div
      style={{
        position: 'absolute',
        width: '300px',
        height: '300px',
        borderRadius: '50%',
        background:
          'radial-gradient(circle, rgba(96,165,250,0.18) 0%, rgba(59,130,246,0.08) 40%, transparent 70%)',
        left,
        top,
        translateX: '-50%',
        translateY: '-50%',
        pointerEvents: 'none',
        mixBlendMode: 'screen',
        willChange: 'left, top',
        opacity: visible ? 1 : 0,
      }}
      transition={{ opacity: { duration: 0.4 } }}
    />
  );
}

export const CursorGlow = memo(CursorGlowBase);