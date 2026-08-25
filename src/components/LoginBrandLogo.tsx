import { motion } from 'framer-motion';
import { ShineSweep } from '@/components/ShineSweep';
import { cn } from '@/lib/utils';

const DIVIDER_GLOW = '#188BFC';
const BRAND_BLUE = '#022999';

export type BrandLogoVariant = 'login' | 'menu';

interface BrandLogoProps {
  /** `login` — full entrance animation; `menu` — compact sidebar lockup */
  variant?: BrandLogoVariant;
  /** Sidebar collapsed — AF mark only inside shimmer frame */
  collapsed?: boolean;
  className?: string;
}

/** AF + wordmark in one shimmer frame — shared by login card and sidebar. */
export function BrandLogo({ variant = 'login', collapsed = false, className }: BrandLogoProps) {
  const isLogin = variant === 'login';
  const showWordmark = isLogin || !collapsed;
  const animateEntrance = isLogin;

  const afSize = isLogin
    ? 'h-11 w-11 sm:h-12 sm:w-12'
    : collapsed
      ? 'h-7 w-7'
      : 'h-8 w-8';
  const textHeight = isLogin ? 'h-[30px] sm:h-[34px]' : 'h-[22px]';
  const dividerMinH = isLogin ? 'min-h-[44px] sm:min-h-[48px]' : collapsed ? 'min-h-[28px]' : 'min-h-[34px]';
  const outerRadius = isLogin ? 'rounded-[20px]' : collapsed ? 'rounded-[12px]' : 'rounded-[14px]';
  const innerRadius = isLogin ? 'rounded-[18px]' : collapsed ? 'rounded-[10px]' : 'rounded-[12px]';
  const pad = isLogin
    ? 'px-3.5 py-2.5 sm:gap-3.5 sm:px-4 sm:py-3 gap-3'
    : collapsed
      ? 'p-1'
      : 'gap-2 px-2 py-1.5';

  const Wrapper = animateEntrance ? motion.div : 'div';
  const wrapperProps = animateEntrance
    ? {
        initial: { opacity: 0, y: 12, scale: 0.94 },
        animate: { opacity: 1, y: 0, scale: 1 },
        transition: { duration: 0.65, ease: [0.16, 1, 0.3, 1] as const },
      }
    : {};

  const AfWrapper = animateEntrance ? motion.div : 'div';
  const afWrapperProps = animateEntrance
    ? {
        initial: { scale: 0.45, opacity: 0, rotate: -28 },
        animate: { scale: 1, opacity: 1, rotate: 0 },
        transition: { delay: 0.2, duration: 0.75, ease: [0.34, 1.56, 0.64, 1] as const },
      }
    : {};

  const DividerWrapper = animateEntrance ? motion.div : 'div';
  const dividerWrapperProps = animateEntrance
    ? {
        initial: { scaleY: 0, opacity: 0 },
        animate: { scaleY: 1, opacity: 1 },
        transition: { delay: 0.72, duration: 0.5, ease: [0.16, 1, 0.3, 1] as const },
        style: { transformOrigin: 'top' },
      }
    : { style: { transformOrigin: 'top' } };

  const WordmarkWrapper = animateEntrance ? motion.div : 'div';
  const wordmarkWrapperProps = animateEntrance
    ? {
        initial: { clipPath: 'inset(0 100% 0 0)', opacity: 0, x: -8 },
        animate: { clipPath: 'inset(0 0% 0 0)', opacity: 1, x: 0 },
        transition: { delay: 1.05, duration: 0.85, ease: [0.16, 1, 0.3, 1] as const },
      }
    : {};

  return (
    <Wrapper
      {...wrapperProps}
      className={cn(
        'flex shrink-0',
        isLogin ? 'justify-center' : collapsed ? 'justify-center' : 'min-w-0',
        !isLogin && 'sidebar-brand-logo',
        className,
      )}
      aria-label="Anush Finserv"
    >
      <div className={cn('login-logo-shimmer p-[1.5px]', outerRadius, !isLogin && 'login-logo-shimmer-menu')}>
        <div
          className={cn(
            'relative flex items-center justify-center',
            collapsed && !isLogin ? 'overflow-visible' : 'overflow-hidden',
            innerRadius,
            pad,
          )}
          style={{ backgroundColor: BRAND_BLUE }}
        >
          {/* AF mark */}
          <AfWrapper className="relative shrink-0" {...afWrapperProps}>
            {animateEntrance && (
              <motion.span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-full"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: [0, 0.85, 0], scale: [0.6, 1.35, 1.5] }}
                transition={{ delay: 0.45, duration: 0.65, ease: 'easeOut' }}
                style={{
                  background: `radial-gradient(circle, ${DIVIDER_GLOW}55 0%, transparent 70%)`,
                  filter: 'blur(6px)',
                }}
              />
            )}
            <img
              src="/logo-clean.svg"
              alt=""
              aria-hidden
              className={cn('relative z-[1] block object-contain', afSize)}
              style={{
                filter: collapsed && !isLogin
                  ? 'drop-shadow(0 0 8px rgba(24,139,252,.35))'
                  : 'drop-shadow(0 0 12px rgba(24,139,252,.45))',
              }}
            />
          </AfWrapper>

          {showWordmark && (
            <>
              {/* Brand divider */}
              <DividerWrapper
                {...dividerWrapperProps}
                className={cn(
                  'login-logo-divider relative w-px shrink-0 self-stretch',
                  dividerMinH,
                )}
                aria-hidden
              >
                {animateEntrance && (
                  <motion.span
                    className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full"
                    initial={{ top: '0%', opacity: 0 }}
                    animate={{ top: '100%', opacity: [0, 1, 1, 0] }}
                    transition={{ delay: 0.95, duration: 0.95, ease: 'easeInOut', times: [0, 0.12, 0.88, 1] }}
                    style={{
                      background: DIVIDER_GLOW,
                      boxShadow: `0 0 10px ${DIVIDER_GLOW}, 0 0 18px ${DIVIDER_GLOW}80`,
                    }}
                  />
                )}
              </DividerWrapper>

              {/* Wordmark */}
              <WordmarkWrapper className="relative min-w-0 shrink overflow-hidden" {...wordmarkWrapperProps}>
                <img
                  src="/anush-text.svg"
                  alt="Anush Finserv"
                  className={cn('w-auto max-w-full object-contain object-left', textHeight)}
                  style={{ filter: 'drop-shadow(0 0 10px rgba(24,139,252,.28))' }}
                />
                {animateEntrance && (
                  <motion.span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 w-14"
                    initial={{ left: '-50%', opacity: 0 }}
                    animate={{ left: '130%', opacity: [0, 1, 1, 0] }}
                    transition={{ delay: 1.15, duration: 0.9, ease: 'easeInOut', times: [0, 0.1, 0.9, 1] }}
                    style={{
                      background: 'linear-gradient(to right, transparent, rgba(255,255,255,.28), transparent)',
                      filter: 'blur(2px)',
                    }}
                  />
                )}
              </WordmarkWrapper>
            </>
          )}

          <ShineSweep
            delay={isLogin ? 2.2 : 1.2}
            duration={isLogin ? 1.6 : 1.4}
            repeat={Infinity}
            repeatDelay={isLogin ? 6 : 8}
            width={isLogin ? '60%' : '55%'}
            opacity={isLogin ? 0.5 : 0.4}
          />
        </div>
      </div>
    </Wrapper>
  );
}

/** Login card — full sequential reveal on load. */
export function LoginBrandLogo() {
  return <BrandLogo variant="login" />;
}
