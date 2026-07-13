import { motion } from 'framer-motion';
import Logo from './Logo';

// Highlights of what the platform does — honest for an early-stage product
// (capabilities, not inflated vanity metrics).
const STATS = [
  { value: '6', label: 'Loan Types' },
  { value: 'Real-time', label: 'Collections' },
  { value: '256-bit', label: 'Encryption' },
  { value: '100%', label: 'Paperless KYC' },
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: 0.1 + i * 0.12, duration: 0.6, ease: [0.16, 1, 0.3, 1] as const } }),
};

export default function Hero() {
  return (
    <div className="relative flex h-full flex-col overflow-hidden p-8 md:p-12 lg:p-14">
      {/* ── Background effects ── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* radial glow */}
        <div className="absolute right-[10%] top-[24%] h-[26rem] w-[26rem] rounded-full bg-emerald-400/25 blur-[110px]" />
        <div className="absolute -left-20 bottom-10 h-72 w-72 rounded-full bg-blue-400/15 blur-[90px]" />
        {/* blurred rings */}
        <div className="absolute right-[14%] top-[20%] h-[24rem] w-[24rem] rounded-full border border-emerald-300/20" />
        <div className="absolute right-[10%] top-[14%] h-[32rem] w-[32rem] rounded-full border border-emerald-300/10" />
        {/* floating particles */}
        {[...Array(6)].map((_, i) => (
          <motion.span
            key={i}
            className="absolute h-2 w-2 rounded-full bg-emerald-400/40"
            style={{ top: `${15 + i * 13}%`, left: `${20 + ((i * 37) % 60)}%` }}
            animate={{ y: [0, -18, 0], opacity: [0.3, 0.7, 0.3] }}
            transition={{ duration: 4 + i, repeat: Infinity, ease: 'easeInOut', delay: i * 0.5 }}
          />
        ))}
      </div>

      {/* ── Logo ── */}
      <motion.div variants={fadeUp} custom={0} initial="hidden" animate="show" className="relative z-10 mb-8">
        <Logo size="md" />
      </motion.div>

      {/* ── Headline + copy (top-aligned) ── */}
      <div className="relative z-10 flex flex-1 flex-col pt-2">
        <div className="max-w-2xl">
          <motion.h1
            variants={fadeUp} custom={1} initial="hidden" animate="show"
            className="font-display font-extrabold leading-[1.05] tracking-tight text-slate-900"
            style={{ fontSize: 'clamp(2.5rem, 5.5vw, 5rem)' }}
          >
            One Platform.<br />
            <span className="bg-gradient-to-r from-green-600 to-emerald-500 bg-clip-text text-transparent">Every Loan.</span><br />
            Every Possibility.
          </motion.h1>

          <motion.p
            variants={fadeUp} custom={2} initial="hidden" animate="show"
            className="mt-6 max-w-lg text-lg leading-relaxed text-slate-600"
          >
            Manage customers, loans, collections, expenses and reports from one
            intelligent loan management platform.
          </motion.p>
        </div>
      </div>

      {/* ── Statistics — centered at the bottom of the hero ── */}
      <motion.div
        variants={fadeUp} custom={4} initial="hidden" animate="show"
        className="relative z-10 mx-auto mt-6 grid w-full max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4"
      >
        {STATS.map((s) => (
          <div key={s.label} className="rounded-2xl border border-white/50 bg-white/60 px-4 py-3 text-center backdrop-blur-xl">
            <div className="text-lg font-extrabold tracking-tight text-slate-900">{s.value}</div>
            <div className="mt-0.5 text-[11px] font-medium text-slate-500">{s.label}</div>
          </div>
        ))}
      </motion.div>
    </div>
  );
}
