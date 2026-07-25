import { memo } from 'react';
import { motion } from 'framer-motion';

interface ShineSweepProps {
  delay?: number;
  duration?: number;
  repeat?: number;
  repeatDelay?: number;
  width?: string;
  opacity?: number;
}

function ShineSweepBase({
  delay = 0,
  duration = 1.2,
  repeat = 0,
  repeatDelay = 0,
  width = '50%',
  opacity = 1,
}: ShineSweepProps) {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ borderRadius: 'inherit' }}
    >
      <motion.div
        initial={{ x: '-160%' }}
        animate={{ x: '260%' }}
        transition={{
          duration,
          delay,
          repeat,
          repeatDelay,
          ease: 'easeInOut',
        }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width,
          height: '100%',
          background:
            'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.05) 30%, rgba(224,242,254,0.6) 50%, rgba(255,255,255,0.05) 70%, transparent 100%)',
          filter: 'blur(2px)',
          mixBlendMode: 'screen',
          willChange: 'transform',
          opacity,
        }}
      />
    </div>
  );
}

export const ShineSweep = memo(ShineSweepBase);