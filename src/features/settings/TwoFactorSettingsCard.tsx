import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  buildOtpAuthUri, generateBase32Secret, qrCodeImageUrl, verifyTotpCode,
} from '@/lib/totp';
import {
  disableTotp, enableTotp, getTotpEnrollment, isTotpEnabled, saveTotpPending,
} from '@/lib/totpStore';
import { cn } from '@/lib/utils';
import {
  CheckCircle2, Copy, Loader2, ShieldCheck, ShieldOff, Sparkles,
} from 'lucide-react';

interface Props {
  userEmail: string;
  userName: string;
}

function TotpDigits({
  value,
  onChange,
  disabled,
  id,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  id: string;
}) {
  const digits = useMemo(() => {
    const padded = value.replace(/\D/g, '').slice(0, 6);
    return padded.split('').concat(['', '', '', '', '', '']).slice(0, 6);
  }, [value]);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const setAt = (index: number, raw: string) => {
    const d = raw.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = d;
    const joined = next.join('').replace(/\D/g, '').slice(0, 6);
    onChange(joined);
    if (d && index < 5) refs.current[index + 1]?.focus();
  };

  const onKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    onChange(pasted);
    refs.current[Math.min(pasted.length, 5)]?.focus();
  };

  return (
    <div className="flex justify-center gap-2 sm:justify-start" onPaste={onPaste} role="group" aria-labelledby={id}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          value={d}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of 6`}
          onChange={(e) => setAt(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          className={cn(
            'h-11 w-9 rounded-xl border-2 bg-surface text-center font-display text-base font-bold text-ink outline-none transition-all sm:h-12 sm:w-10',
            'border-slate-200/90 focus:border-primary focus:ring-4 focus:ring-primary/15 dark:border-white/[.1]',
            d && 'border-primary/40',
          )}
        />
      ))}
    </div>
  );
}

const SETUP_STEPS = [
  { n: 1, title: 'Install app', body: 'Google Authenticator on iOS or Android' },
  { n: 2, title: 'Scan QR', body: 'Or paste the setup key manually' },
  { n: 3, title: 'Verify', body: 'Enter the live 6-digit code' },
] as const;

function ProtectionToggle({
  on,
  onRequestOff,
  disabled,
}: {
  on: boolean;
  onRequestOff: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (disabled) return;
        if (on) onRequestOff();
      }}
      role="switch"
      aria-checked={on}
      aria-label={on ? 'Two-factor protection on' : 'Two-factor protection off'}
      disabled={disabled || !on}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200',
        on ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600',
        (disabled || !on) && 'cursor-default',
        disabled && 'opacity-50',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.25)] transition-transform duration-200',
          on ? 'translate-x-[26px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}

type Celebration = 'enabled' | 'disabled' | null;

const bodyMotion = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.38, ease: [0.16, 1, 0.3, 1] as const },
};

export function TwoFactorSettingsCard({ userEmail }: Props) {
  const toast = useToast();
  const [storeTick, setStoreTick] = useState(0);
  const enabled = useMemo(() => isTotpEnabled(userEmail), [userEmail, storeTick]);
  const enrollment = useMemo(() => getTotpEnrollment(userEmail), [userEmail, storeTick]);

  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [disablePanelOpen, setDisablePanelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [celebration, setCelebration] = useState<Celebration>(null);

  useEffect(() => {
    if (!enabled && enrollment?.secret && !enrollment.enabled) {
      setSetupSecret(enrollment.secret);
    }
  }, [enabled, enrollment?.secret, enrollment?.enabled]);

  useEffect(() => {
    if (!enabled) setDisablePanelOpen(false);
  }, [enabled]);

  const otpauthUri = useMemo(() => {
    if (!setupSecret) return '';
    return buildOtpAuthUri(userEmail, setupSecret);
  }, [setupSecret, userEmail]);

  const qrUrl = otpauthUri ? qrCodeImageUrl(otpauthUri, 200) : '';

  const startSetup = () => {
    const secret = generateBase32Secret();
    saveTotpPending(userEmail, secret);
    setSetupSecret(secret);
    setConfirmCode('');
  };

  const cancelSetup = () => {
    if (!enabled) disableTotp(userEmail);
    setSetupSecret(null);
    setConfirmCode('');
  };

  const confirmEnable = async () => {
    const secret = setupSecret ?? enrollment?.secret;
    if (!secret) return;
    setBusy(true);
    try {
      const ok = await verifyTotpCode(secret, confirmCode);
      if (!ok) {
        toast('Invalid code — check Google Authenticator and try again', 'error');
        return;
      }
      saveTotpPending(userEmail, secret);
      enableTotp(userEmail);
      setSetupSecret(null);
      setConfirmCode('');
      setStoreTick((n) => n + 1);
      setCelebration('enabled');
      toast('Two-factor authentication enabled');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    const secret = getTotpEnrollment(userEmail)?.secret;
    if (!secret) return;
    setBusy(true);
    try {
      const ok = await verifyTotpCode(secret, disableCode);
      if (!ok) {
        toast('Invalid code', 'error');
        return;
      }
      disableTotp(userEmail);
      setDisableCode('');
      setSetupSecret(null);
      setDisablePanelOpen(false);
      setStoreTick((n) => n + 1);
      setCelebration('disabled');
      toast('Two-factor authentication disabled');
    } finally {
      setBusy(false);
    }
  };

  const copySecret = async () => {
    const s = setupSecret ?? enrollment?.secret;
    if (!s) return;
    try {
      await navigator.clipboard.writeText(s);
      toast('Setup key copied');
    } catch {
      toast('Could not copy', 'error');
    }
  };

  const inSetup = Boolean(setupSecret) || Boolean(enrollment?.secret && !enabled);

  const contentKey = enabled
    ? (inSetup ? 'enabled-setup' : 'enabled')
    : (inSetup ? 'enrolling' : 'idle');

  useEffect(() => {
    if (!celebration) return;
    const id = window.setTimeout(() => setCelebration(null), 1400);
    return () => window.clearTimeout(id);
  }, [celebration]);

  return (
    <section
      className={cn(
        'anim-pop relative overflow-hidden rounded-[18px] border border-slate-200/90 bg-surface shadow-card',
        'dark:border-white/[.08]',
      )}
    >
      <AnimatePresence>
        {celebration === 'enabled' && (
          <motion.div
            key="flash-on"
            className="pointer-events-none absolute inset-0 z-20 bg-gradient-to-br from-emerald-400/25 via-emerald-500/10 to-transparent"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 1.1, ease: 'easeOut' }}
            aria-hidden
          />
        )}
        {celebration === 'disabled' && (
          <motion.div
            key="flash-off"
            className="pointer-events-none absolute inset-0 z-20 bg-gradient-to-br from-slate-400/15 via-[#0538cc]/10 to-transparent"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.85, 0] }}
            transition={{ duration: 1.1, ease: 'easeOut' }}
            aria-hidden
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {celebration && (
          <motion.div
            key="celebration-icon"
            className="pointer-events-none absolute inset-x-0 top-[4.5rem] z-30 flex justify-center"
            initial={{ opacity: 0, scale: 0.5, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: -12 }}
            transition={{ type: 'spring', stiffness: 380, damping: 22 }}
          >
            <span
              className={cn(
                'grid h-14 w-14 place-items-center rounded-2xl shadow-[0_16px_40px_-12px_rgba(0,0,0,.35)] ring-1',
                celebration === 'enabled'
                  ? 'bg-emerald-500 text-white ring-emerald-300/40'
                  : 'bg-surface text-muted ring-slate-200/80 dark:ring-white/15',
              )}
            >
              {celebration === 'enabled' ? (
                <CheckCircle2 size={28} strokeWidth={2.25} />
              ) : (
                <ShieldOff size={26} strokeWidth={2} />
              )}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="relative overflow-hidden bg-gradient-to-r from-[#022999] via-[#0538cc] to-[#0AA8F8] px-5 py-4 sm:px-6 sm:py-5">
        <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/15 text-white shadow-[0_8px_24px_-8px_rgba(0,0,0,.35)] ring-1 ring-white/20">
              <ShieldCheck size={22} strokeWidth={2} />
            </span>
            <h3 className="font-display text-[17px] font-bold tracking-tight text-white sm:text-[18px]">
              Two-factor authentication
            </h3>
          </div>
          <motion.span
            layout
            animate={
              celebration === 'enabled'
                ? { scale: [1, 1.12, 1] }
                : celebration === 'disabled'
                  ? { scale: [1, 0.92, 1] }
                  : { scale: 1 }
            }
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide ring-1',
              enabled
                ? 'bg-emerald-400/20 text-emerald-50 ring-emerald-200/30'
                : 'bg-white/15 text-white/90 ring-white/25',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                enabled
                  ? 'bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,.8)]'
                  : 'bg-white/70',
              )}
              aria-hidden
            />
            {enabled ? 'Protected' : 'Not enabled'}
          </motion.span>
        </div>
      </div>

      <div className="space-y-5 p-4 sm:p-5">
        <AnimatePresence mode="wait">
          <motion.div key={contentKey} className="space-y-5" {...bodyMotion}>
        {enabled && !inSetup && (
          <>
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.05, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="flex min-w-0 flex-1 gap-3 rounded-xl border border-success/25 bg-success/[.06] px-4 py-3.5 dark:border-success/30 dark:bg-success/[.08]"
            >
              <CheckCircle2 className="mt-0.5 shrink-0 text-success" size={20} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-ink">Your account is protected</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  Each sign-in will ask for a code from your authenticator app after your password.
                </p>
              </div>
            </motion.div>

            <div
              className={cn(
                'flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3.5 transition-colors',
                disablePanelOpen
                  ? 'border-warning/30 bg-warning/[.04] dark:border-warning/25 dark:bg-warning/[.06]'
                  : 'border-slate-200/90 bg-surface dark:border-white/[.08]',
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-ink">Authenticator at sign-in</p>
                <p className="mt-0.5 text-[12px] text-muted">
                  Turn off only if you need to remove this device&apos;s enrollment.
                </p>
              </div>
              <ProtectionToggle
                on={true}
                disabled={busy}
                onRequestOff={() => {
                  setDisablePanelOpen(true);
                  setDisableCode('');
                }}
              />
            </div>

            <AnimatePresence>
            {disablePanelOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
              <div className="rounded-xl border border-danger/20 bg-danger/[.03] p-4 dark:border-danger/25 dark:bg-danger/[.05]">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-danger">Turn off protection</p>
                <p className="mt-1 text-[12px] text-muted">
                  Enter a current authenticator code to confirm. Sign-in will return to password only.
                </p>
                <div className="mt-4">
                  <p id="disable-totp-label" className="mb-2 text-[12px] font-semibold text-ink">Authenticator code</p>
                  <TotpDigits
                    id="disable-totp-label"
                    value={disableCode}
                    onChange={setDisableCode}
                    disabled={busy}
                  />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    className="text-danger hover:bg-danger/10 hover:text-danger"
                    onClick={turnOff}
                    disabled={busy || disableCode.length !== 6}
                  >
                    {busy ? <Loader2 size={16} className="animate-spin" /> : 'Disable two-factor'}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setDisablePanelOpen(false);
                      setDisableCode('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
              </motion.div>
            )}
            </AnimatePresence>
          </>
        )}

        {!enabled && !inSetup && (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <ul className="space-y-2 text-[13px] text-muted">
              <li className="flex items-start gap-2">
                <Sparkles size={14} className="mt-0.5 shrink-0 text-primary" />
                <span>Blocks access even if someone knows your password</span>
              </li>
              <li className="flex items-start gap-2">
                <Sparkles size={14} className="mt-0.5 shrink-0 text-primary" />
                <span>Works offline on your phone — no SMS required</span>
              </li>
            </ul>
            <Button
              type="button"
              onClick={startSetup}
              className="h-11 shrink-0 bg-gradient-to-r from-[#022999] via-[#0538cc] to-[#0AA8F8] px-6 shadow-[0_8px_24px_-10px_rgba(5,56,204,.4)] hover:brightness-110"
            >
              Begin setup
            </Button>
          </div>
        )}

        {!enabled && inSetup && setupSecret && (
          <div className="space-y-5">
            <div className="grid gap-2 sm:grid-cols-3">
              {SETUP_STEPS.map((s) => (
                <div
                  key={s.n}
                  className="rounded-xl border border-slate-200/80 bg-surface/80 px-3 py-2.5 dark:border-white/[.08]"
                >
                  <p className="text-[10px] font-bold uppercase tracking-wide text-primary">Step {s.n}</p>
                  <p className="mt-0.5 text-[13px] font-semibold text-ink">{s.title}</p>
                  <p className="text-[11px] text-muted">{s.body}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-5 rounded-2xl border border-primary/15 bg-gradient-to-b from-primary/[.04] to-transparent p-4 sm:flex-row sm:p-5 dark:border-primary/25 dark:from-primary/[.08]">
              <div className="flex shrink-0 flex-col items-center">
                <div className="rounded-2xl bg-white p-3 shadow-[0_12px_40px_-16px_rgba(0,0,0,.25)] ring-1 ring-slate-200/80 dark:ring-white/10">
                  <img
                    src={qrUrl}
                    alt="QR code for Google Authenticator"
                    width={200}
                    height={200}
                    className="rounded-lg"
                  />
                </div>
                <p className="mt-2 text-[11px] font-medium text-muted">Scan with Authenticator</p>
              </div>
              <div className="min-w-0 flex-1 space-y-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Manual setup key</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <code className="max-w-full flex-1 break-all rounded-xl border border-slate-200/90 bg-surface px-3 py-2 font-mono text-[12px] font-semibold text-ink dark:border-white/[.08]">
                      {setupSecret}
                    </code>
                    <Button type="button" variant="ghost" className="shrink-0" onClick={copySecret}>
                      <Copy size={15} /> Copy
                    </Button>
                  </div>
                </div>
                <div>
                  <p id="enable-totp-label" className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
                    Verification code
                  </p>
                  <p className="mt-1 text-[12px] text-muted">Enter the 6-digit code shown in the app</p>
                  <div className="mt-3">
                    <TotpDigits
                      id="enable-totp-label"
                      value={confirmCode}
                      onChange={setConfirmCode}
                      disabled={busy}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    onClick={confirmEnable}
                    disabled={busy || confirmCode.length !== 6}
                    className="bg-gradient-to-r from-[#022999] via-[#0538cc] to-[#0AA8F8] shadow-[0_6px_20px_-8px_rgba(5,56,204,.45)] hover:brightness-110"
                  >
                    {busy ? <Loader2 size={16} className="animate-spin" /> : 'Enable protection'}
                  </Button>
                  <Button variant="ghost" onClick={cancelSetup} disabled={busy}>Cancel</Button>
                </div>
              </div>
            </div>
          </div>
        )}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
