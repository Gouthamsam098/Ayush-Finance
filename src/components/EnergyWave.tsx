import { memo } from 'react';

interface EnergyWaveProps {
  active: boolean;
  width?: number;
}

function EnergyWaveBase({ active, width = 280 }: EnergyWaveProps) {
  if (!active) return null;
  return (
    <div className="pointer-events-none flex justify-center" style={{ width: '100%' }}>
      <svg
        width={width}
        height={6}
        viewBox="0 0 280 6"
        fill="none"
        style={{ overflow: 'visible' }}
      >
        <defs>
          <linearGradient id="pla-energy-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0" />
            <stop offset="20%" stopColor="#60a5fa" stopOpacity="0.8" />
            <stop offset="50%" stopColor="#93c5fd" stopOpacity="1" />
            <stop offset="80%" stopColor="#60a5fa" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect
          x={0}
          y={2}
          width={280}
          height={2}
          rx={1}
          fill="url(#pla-energy-grad)"
          style={{
            transformOrigin: 'left center',
            animation: 'pla-energy-wave 0.8s ease-out forwards, pla-energy-wave-loop 3s ease-in-out 0.8s infinite',
          }}
        />
        <rect
          x={0}
          y={1}
          width={280}
          height={4}
          rx={2}
          fill="url(#pla-energy-grad)"
          opacity={0.3}
          style={{ filter: 'blur(4px)' }}
        />
      </svg>
    </div>
  );
}

export const EnergyWave = memo(EnergyWaveBase);