import { memo, useMemo } from 'react';

interface DustParticle {
  left: number;
  top: number;
  size: number;
  duration: number;
  delay: number;
  driftX: number;
  driftY: number;
  opacity: number;
}

function generateDust(count: number): DustParticle[] {
  const arr: DustParticle[] = [];
  for (let i = 0; i < count; i++) {
    arr.push({
      left: Math.random() * 100,
      top: 60 + Math.random() * 40,
      size: 1 + Math.random() * 1.5,
      duration: 12 + Math.random() * 18,
      delay: -Math.random() * 25,
      driftX: (Math.random() - 0.5) * 40,
      driftY: -(150 + Math.random() * 200),
      opacity: 0.15 + Math.random() * 0.2,
    });
  }
  return arr;
}

interface FloatingDustProps {
  count?: number;
}

function FloatingDustBase({ count = 35 }: FloatingDustProps) {
  const dust = useMemo(() => generateDust(count), [count]);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {dust.map((d, i) => (
        <span
          key={i}
          className="pla-dust"
          style={
            {
              left: `${d.left}%`,
              top: `${d.top}%`,
              width: `${d.size}px`,
              height: `${d.size}px`,
              backgroundColor: '#bfdbfe',
              boxShadow: `0 0 ${d.size * 3}px rgba(191,219,254,0.5)`,
              animationDuration: `${d.duration}s`,
              animationDelay: `${d.delay}s`,
              '--pla-dust-x': `${d.driftX}px`,
              '--pla-dust-y': `${d.driftY}px`,
              '--pla-dust-op': d.opacity,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

export const FloatingDust = memo(FloatingDustBase);