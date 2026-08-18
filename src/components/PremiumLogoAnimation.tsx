import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, useTransform } from 'framer-motion';
import '@/styles/animations.css';
import { useMousePosition } from '@/hooks/useMousePosition';
import { BackgroundParticles } from './BackgroundParticles';
import { AmbientLight } from './AmbientLight';
import { FloatingDust } from './FloatingDust';
import { LensFlare } from './LensFlare';
import { EnergyWave } from './EnergyWave';
import { ShineSweep } from './ShineSweep';
import { CursorGlow } from './CursorGlow';

const NOISE_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E";

const SPARK_COUNT = 12;

const DIVIDER_GLOW = '#188BFC';

interface Spark {
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
  driftX: number;
  driftY: number;
}

function generateSparks(): Spark[] {
  const arr: Spark[] = [];
  for (let i = 0; i < SPARK_COUNT; i++) {
    const angle = (Math.PI * 2 * i) / SPARK_COUNT + Math.random() * 0.5;
    const dist = 30 + Math.random() * 40;
    arr.push({
      x: 50 + Math.cos(angle) * 15,
      y: 50 + Math.sin(angle) * 15,
      size: 2 + Math.random() * 3,
      delay: 4.0 + Math.random() * 0.3,
      duration: 0.8 + Math.random() * 0.4,
      driftX: Math.cos(angle) * dist,
      driftY: Math.sin(angle) * dist,
    });
  }
  return arr;
}

export default function PremiumLogoAnimation() {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [idle, setIdle] = useState(false);
  const [waveActive, setWaveActive] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [hovered, setHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const sparks = useMemo(() => generateSparks(), []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(pointer: fine)');
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const waveTimer = setTimeout(() => setWaveActive(true), 3500);
    const idleTimer = setTimeout(() => setIdle(true), 4500);
    return () => {
      clearTimeout(waveTimer);
      clearTimeout(idleTimer);
    };
  }, [reducedMotion]);

  const mouseEnabled = isDesktop && idle && !reducedMotion;
  const { nx, ny, px, py } = useMousePosition(containerRef, mouseEnabled);

  const rotateY = useTransform(nx, [-0.5, 0.5], [8, -8]);
  const rotateX = useTransform(ny, [-0.5, 0.5], [-8, 8]);

  if (reducedMotion) {
    return (
      <div className="relative h-full w-full overflow-hidden">
        <BackgroundParticles count={60} />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className="absolute inset-0 flex items-center justify-center"
        >
          <div className="flex items-center gap-4 sm:gap-6">
            <div style={{ width: 'clamp(50px, 7vw, 90px)', height: 'clamp(50px, 7vw, 90px)' }}>
              <img src="/logo-clean.svg" alt="Anush Finserv" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 0 12px rgba(56,202,249,0.4))' }} />
            </div>
            <div className="w-px self-stretch bg-gradient-to-b from-transparent via-blue-500/50 to-transparent" style={{ minHeight: 'clamp(40px, 6vw, 70px)' }} />
            <img src="/anush-text.svg" alt="Anush Finserv" style={{ height: 'clamp(32px, 5vw, 58px)', width: 'auto', objectFit: 'contain' }} />
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className="absolute inset-0"
      >
        <AmbientLight />
        <BackgroundParticles count={110} />
        <FloatingDust count={35} />
        <div className="pla-noise" style={{ backgroundImage: `url("${NOISE_URI}")` }} />
      </motion.div>

      {idle && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[5] -translate-x-1/2 -translate-y-1/2">
          <motion.div
            style={{
              width: 'clamp(220px, 30vw, 380px)',
              height: 'clamp(220px, 30vw, 380px)',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(56,202,249,0.2) 0%, rgba(24,139,252,0.08) 40%, transparent 70%)',
              filter: 'blur(30px)',
              willChange: 'transform, opacity',
            }}
            animate={{
              opacity: hovered ? [0.6, 0.85, 0.6] : [0.4, 0.6, 0.4],
              scale: [1, 1.02, 1],
            }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>
      )}

      <motion.div
        initial={{ scale: 1 }}
        animate={{ scale: [1, 1.02, 1.02, 1.03] }}
        transition={{ duration: 4.5, times: [0, 0.18, 0.89, 1], ease: 'easeOut' }}
        className="absolute inset-0 z-10 flex items-center justify-center"
      >
        <motion.div
          style={{
            rotateX,
            rotateY,
            transformStyle: 'preserve-3d',
            transformPerspective: 1000,
          }}
          className="relative flex flex-col items-center"
        >
          <div className="flex items-center gap-3 sm:gap-4 md:gap-5">
            <div className="relative" style={{ width: 'clamp(56px, 8vw, 100px)', height: 'clamp(56px, 8vw, 100px)' }}>
              <motion.div
                className="absolute inset-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: idle ? [0.35, 0.55, 0.35] : 0.4 }}
                transition={idle ? { duration: 4, repeat: Infinity, ease: 'easeInOut' } : { delay: 0.8, duration: 1, ease: 'easeOut' }}
                style={{ background: `radial-gradient(circle, ${DIVIDER_GLOW}40 0%, transparent 70%)`, filter: 'blur(12px)', willChange: 'opacity' }}
              />
              <motion.img
                src="/logo-clean.svg"
                alt="Anush Finserv"
                className="relative z-10"
                style={{ width: '100%', height: '100%', objectFit: 'contain', filter: `drop-shadow(0 0 8px ${DIVIDER_GLOW}80) drop-shadow(0 0 16px ${DIVIDER_GLOW}40)` }}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.8, duration: 0.8, ease: [0.34, 1.56, 0.64, 1] }}
              />
              <motion.div
                className="absolute inset-0 z-20 rounded-full"
                style={{ background: `radial-gradient(circle, ${DIVIDER_GLOW}66 0%, transparent 60%)`, filter: 'blur(8px)', mixBlendMode: 'screen' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 0] }}
                transition={{ delay: 0.8, duration: 0.6, times: [0, 0.3, 1], ease: 'easeOut' }}
              />
              <ShineSweep delay={1.6} duration={1.2} width="60%" />
              {idle && <ShineSweep delay={0} duration={1.5} repeat={Infinity} repeatDelay={6.5} width="60%" />}
            </div>

            <motion.div
              initial={{ scaleY: 0, opacity: 0 }}
              animate={{ scaleY: 1, opacity: 1 }}
              transition={{ delay: 2.0, duration: 0.5, ease: 'easeOut' }}
              style={{ transformOrigin: 'top' }}
              className="relative w-px self-stretch bg-gradient-to-b from-transparent via-white/70 to-transparent"
            >
              <motion.div
                initial={{ top: '0%', opacity: 0 }}
                animate={{ top: '100%', opacity: [0, 1, 1, 0] }}
                transition={{ delay: 2.3, duration: 1.2, ease: 'easeInOut', times: [0, 0.1, 0.9, 1] }}
                className="absolute left-1/2 h-2 w-2 -translate-x-1/2 rounded-full"
                style={{ background: DIVIDER_GLOW, boxShadow: `0 0 12px ${DIVIDER_GLOW}, 0 0 24px ${DIVIDER_GLOW}80` }}
              />
              {idle && <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/40 to-transparent" style={{ filter: 'blur(2px)' }} />}
            </motion.div>

            <motion.div
              initial={{ clipPath: 'inset(0 100% 0 0)', opacity: 0 }}
              animate={{ clipPath: 'inset(0 0% 0 0)', opacity: 1 }}
              transition={{ delay: 2.5, duration: 0.8, ease: 'easeInOut' }}
              className="relative overflow-hidden"
              style={{ width: 'clamp(160px, 22vw, 300px)' }}
            >
              <img
                src="/anush-text.svg"
                alt="Anush Finserv"
                style={{ width: '100%', height: 'auto', display: 'block', filter: `drop-shadow(0 0 10px ${DIVIDER_GLOW}30) drop-shadow(0 0 20px ${DIVIDER_GLOW}15)` }}
              />
              <motion.div
                initial={{ left: '-40%', opacity: 0 }}
                animate={{ left: '140%', opacity: [0, 1, 1, 0] }}
                transition={{ delay: 2.5, duration: 0.8, ease: 'easeInOut', times: [0, 0.1, 0.9, 1] }}
                className="absolute inset-y-0 w-24"
                style={{ background: `linear-gradient(to right, transparent, rgba(255,255,255,0.25), transparent)`, filter: 'blur(3px)' }}
              />
              {idle && (
                <motion.div
                  initial={{ left: '-40%' }}
                  animate={{ left: '140%' }}
                  transition={{ duration: 6, repeat: Infinity, repeatDelay: 8, ease: 'easeInOut' }}
                  className="absolute inset-y-0 w-16"
                  style={{ background: `linear-gradient(to right, transparent, ${DIVIDER_GLOW}20, transparent)`, filter: 'blur(2px)' }}
                />
              )}
            </motion.div>
          </div>

          <div className="mt-4">
            <EnergyWave active={waveActive} />
          </div>
        </motion.div>
      </motion.div>

      <div className="pointer-events-none absolute inset-0 z-20">
        <LensFlare delay={4.0} duration={0.5} />
      </div>

      <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
        {sparks.map((s, i) => (
          <span
            key={i}
            style={
              {
                position: 'absolute',
                left: `${s.x}%`,
                top: `${s.y}%`,
                width: `${s.size}px`,
                height: `${s.size}px`,
                borderRadius: '50%',
                backgroundColor: '#93c5fd',
                boxShadow: `0 0 ${s.size * 3}px ${DIVIDER_GLOW}`,
                willChange: 'transform, opacity',
                animation: `pla-sparkle ${s.duration}s ease-out ${s.delay}s 1 forwards`,
                '--pla-spark-x': `${s.driftX}px`,
                '--pla-spark-y': `${s.driftY}px`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      {mouseEnabled && <CursorGlow px={px} py={py} visible={hovered} />}
    </div>
  );
}