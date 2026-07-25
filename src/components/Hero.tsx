import { motion } from 'framer-motion';
import { LogoMark } from './Logo';

export default function Hero() {
  return (
    <div className="relative flex h-full flex-col overflow-hidden p-8 md:p-12 lg:p-14">
      <div className="relative z-10">
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
    </div>
  );
}