import { memo } from 'react';

interface LensFlareProps {
  delay?: number;
  duration?: number;
}

function LensFlareBase({ delay = 0, duration = 1.5 }: LensFlareProps) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        style={{
          position: 'absolute',
          top: '10%',
          left: '10%',
          width: '180px',
          height: '180px',
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(224,242,254,0.7) 0%, rgba(96,165,250,0.4) 30%, transparent 65%)',
          filter: 'blur(8px)',
          mixBlendMode: 'screen',
          willChange: 'transform, opacity',
          animation: `pla-lens-flare ${duration}s ease-in-out ${delay}s 1 forwards`,
        }}
      />
    </div>
  );
}

export const LensFlare = memo(LensFlareBase);