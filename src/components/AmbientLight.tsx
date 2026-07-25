import { memo } from 'react';

function AmbientLightBase() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="pla-ambient"
        style={{
          width: '55%',
          height: '55%',
          top: '15%',
          left: '20%',
          background: 'radial-gradient(circle, rgba(37,99,235,0.35), rgba(6,21,46,0) 70%)',
          animation: 'pla-ambient-drift 24s ease-in-out infinite',
        }}
      />
      <div
        className="pla-ambient"
        style={{
          width: '45%',
          height: '45%',
          bottom: '5%',
          right: '10%',
          background: 'radial-gradient(circle, rgba(59,130,246,0.25), rgba(6,21,46,0) 70%)',
          animation: 'pla-ambient-drift-alt 30s ease-in-out infinite',
        }}
      />
      <div
        className="pla-ambient"
        style={{
          width: '35%',
          height: '35%',
          top: '40%',
          left: '50%',
          background: 'radial-gradient(circle, rgba(96,165,250,0.18), rgba(6,21,46,0) 70%)',
          animation: 'pla-ambient-drift 28s ease-in-out infinite reverse',
        }}
      />
    </div>
  );
}

export const AmbientLight = memo(AmbientLightBase);