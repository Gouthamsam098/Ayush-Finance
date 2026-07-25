import { memo, useMemo } from 'react';

interface Particle {
  left: number;
  top: number;
  size: number;
  duration: number;
  delay: number;
  driftX: number;
  driftY: number;
  opMin: number;
  opMax: number;
  color: string;
}

const COLORS = ['#60a5fa', '#3b82f6', '#93c5fd', '#dbeafe', '#bfdbfe'];

function generateParticles(count: number): Particle[] {
  const arr: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const depth = Math.random();
    arr.push({
      left: Math.random() * 100,
      top: Math.random() * 100,
      size: 1 + depth * 2,
      duration: 8 + depth * 14 + Math.random() * 6,
      delay: -Math.random() * 20,
      driftX: (Math.random() - 0.5) * 60,
      driftY: -(60 + depth * 100),
      opMin: 0.1 + depth * 0.1,
      opMax: 0.3 + depth * 0.3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    });
  }
  return arr;
}

interface BackgroundParticlesProps {
  count?: number;
}

function BackgroundParticlesBase({ count = 110 }: BackgroundParticlesProps) {
  const particles = useMemo(() => generateParticles(count), [count]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map((p, i) => (
        <span
          key={i}
          className="pla-particle"
          style={
            {
              left: `${p.left}%`,
              top: `${p.top}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              backgroundColor: p.color,
              boxShadow: `0 0 ${p.size * 2}px ${p.color}`,
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
              '--pla-drift-x': `${p.driftX}px`,
              '--pla-drift-y': `${p.driftY}px`,
              '--pla-op-min': p.opMin,
              '--pla-op-max': p.opMax,
              '--pla-scale': 1,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

export const BackgroundParticles = memo(BackgroundParticlesBase);