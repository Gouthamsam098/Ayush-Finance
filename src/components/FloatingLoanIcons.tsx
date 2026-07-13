import { motion } from 'framer-motion';
import { Home, Car, Bike, Landmark, Coins, Gem, Wallet, Building2 } from 'lucide-react';

/**
 * Decorative loan-themed icons (house, car, bike, gold, property…) drifting and
 * orbiting in 3D behind the login card. Pure vector + emoji — no asset files.
 */
const ITEMS = [
  { Icon: Home,      top: '14%', left: '12%', size: 34, dur: 7,  delay: 0,   rot: -8 },
  { Icon: Car,       top: '22%', left: '78%', size: 40, dur: 9,  delay: 0.6, rot: 6 },
  { Icon: Bike,      top: '68%', left: '10%', size: 32, dur: 8,  delay: 1.1, rot: -5 },
  { Icon: Landmark,  top: '74%', left: '82%', size: 38, dur: 10, delay: 0.3, rot: 7 },
  { Icon: Coins,     top: '44%', left: '6%',  size: 28, dur: 6,  delay: 1.4, rot: 4 },
  { Icon: Gem,       top: '82%', left: '46%', size: 30, dur: 7.5,delay: 0.9, rot: -6 },
  { Icon: Building2, top: '10%', left: '48%', size: 34, dur: 9.5,delay: 0.2, rot: 5 },
  { Icon: Wallet,    top: '52%', left: '88%', size: 30, dur: 8.5,delay: 1.6, rot: -4 },
];

export function FloatingLoanIcons() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {ITEMS.map(({ Icon, top, left, size, dur, delay, rot }, i) => (
        <motion.div
          key={i}
          className="absolute"
          style={{ top, left }}
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{
            opacity: [0, 0.9, 0.6, 0.9],
            scale: 1,
            y: [0, -26, 0],
            rotate: [rot, rot + 8, rot],
          }}
          transition={{
            opacity: { delay, duration: 1.2 },
            scale: { delay, duration: 1, ease: [0.16, 1, 0.3, 1] },
            y: { delay, duration: dur, repeat: Infinity, ease: 'easeInOut' },
            rotate: { delay, duration: dur, repeat: Infinity, ease: 'easeInOut' },
          }}
        >
          <div className="relative grid place-items-center">
            {/* glow halo */}
            <span
              className="absolute inset-0 -z-10 rounded-full bg-primary/30 blur-2xl"
              style={{ width: size * 2, height: size * 2, left: -size / 2, top: -size / 2 }}
            />
            {/* glass tile holding the icon */}
            <div
              className="grid place-items-center rounded-2xl border border-white/20 bg-white/10 text-white/90 shadow-[0_8px_32px_-8px_rgba(0,0,0,.5)] backdrop-blur-md"
              style={{ width: size + 22, height: size + 22 }}
            >
              <Icon size={size} strokeWidth={1.6} />
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
