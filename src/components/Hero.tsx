import { motion } from 'framer-motion';
import { LogoMark } from './Logo';

const STATS = [
  { value: '6', label: 'Loan Types' },
  { value: 'Real-time', label: 'Collections' },
  { value: '256-bit', label: 'Encryption' },
  { value: '100%', label: 'Paperless KYC' },
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: 0.8 + i * 0.12, duration: 0.6, ease: [0.16, 1, 0.3, 1] as const } }),
};

export default function Hero() {
  return (
    <div className="relative flex h-full flex-col overflow-hidden p-8 md:p-12 lg:p-14">
      {/* Animated Logo */}
      <div className="relative z-10 mb-10">
        <div className="flex items-center gap-3">
          <motion.div
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ duration: 0.7, ease: [0.34, 1.56, 0.64, 1], delay: 0.1 }}
          >
            <LogoMark className="h-11 w-11 rounded-2xl" svg={27} />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut', delay: 0.4 }}
            className="leading-none"
          >
            <div className="font-display text-lg font-extrabold uppercase tracking-tight text-blue-700">ANUSH</div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="h-px w-3 bg-blue-500/50" />
              <span className="text-[9px] font-bold uppercase tracking-[0.28em] text-blue-700 leading-none">FINSERV</span>
              <span className="h-px w-3 bg-blue-500/50" />
            </div>
          </motion.div>
        </div>
      </div>

      <div className="relative z-10 flex flex-1 flex-col pt-2">
        <div className="max-w-2xl">
          <motion.h1
            variants={fadeUp} custom={1} initial="hidden" animate="show"
            className="font-display font-extrabold leading-[1.05] tracking-tight text-white"
            style={{ fontSize: 'clamp(2.5rem, 5.5vw, 5rem)' }}
          >
            One Platform.<br />
            <span className="bg-gradient-to-r from-blue-400 via-sky-300 to-cyan-300 bg-clip-text text-transparent">
              Every Loan.
            </span><br />
            Every Possibility.
          </motion.h1>

          <motion.p
            variants={fadeUp} custom={2} initial="hidden" animate="show"
            className="mt-6 max-w-lg text-lg leading-relaxed text-slate-300"
          >
            Manage customers, loans, collections, expenses and reports from one
            intelligent loan management platform.
          </motion.p>
        </div>
      </div>

      <motion.div
        variants={fadeUp} custom={4} initial="hidden" animate="show"
        className="relative z-10 mx-auto mt-6 grid w-full max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4"
      >
        {STATS.map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-white/10 bg-white/[.06] px-4 py-3 text-center backdrop-blur-xl"
          >
            <div className="text-lg font-extrabold tracking-tight text-white">{s.value}</div>
            <div className="mt-0.5 text-[11px] font-medium text-slate-400">{s.label}</div>
          </div>
        ))}
      </motion.div>
    </div>
  );
}
