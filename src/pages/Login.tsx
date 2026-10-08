import { useEffect, useState } from 'react';
import { ensureDemoPortalUserFromEnv } from '@/lib/demoPortalBootstrap';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { setTokens, setUser } from '@/store/authSlice';
import { config } from '@/lib/config';
import { authApi } from '@/services/authApi';
import { authenticateMock, findMockUserByEmail, type MockUser } from '@/lib/mockUsers';
import { ApiError } from '@/lib/api';
import LoginCard from '@/components/LoginCard';
import PremiumLogoAnimation from '@/components/PremiumLogoAnimation';
import { TotpLoginPanel } from '@/components/TotpLoginPanel';
import { isTotpEnabled, getTotpSecret } from '@/lib/totpStore';
import { verifyTotpCode } from '@/lib/totp';
import {
  clearPendingLogin, getPendingApiToken, getPendingLogin, setPendingLogin,
} from '@/lib/pendingLogin';
import { tokenStore } from '@/lib/tokenStore';
import { motion } from 'framer-motion';

/** Demo-only roles stored in localStorage — never in the Go backend. */
function isMockOnlyRole(role: MockUser['role']): boolean {
  return role === 'CUSTOMER' || role === 'RECOVERY_AGENT';
}

type LoginStep = 'signin' | 'totp';

export default function Login() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<LoginStep>('signin');
  const [totpEmail, setTotpEmail] = useState('');
  const dispatch = useDispatch();
  const navigate = useNavigate();

  useEffect(() => {
    ensureDemoPortalUserFromEnv();
  }, []);

  const finishMockLogin = (match: MockUser) => {
    dispatch(setTokens({ accessToken: 'demo-token' }));
    dispatch(setUser({
      id: match.id,
      username: match.email,
      fullName: match.fullName,
      role: match.role,
      permissions: match.permissions ?? {},
      customerId: match.role === 'CUSTOMER' ? match.linkedCustomerId : undefined,
    }));
    navigate(
      match.role === 'RECOVERY_AGENT' ? '/collections'
        : match.role === 'CUSTOMER' ? '/portal'
          : '/',
    );
  };

  const backToSignIn = () => {
    clearPendingLogin();
    tokenStore.clear();
    setStep('signin');
    setTotpEmail('');
    setError(null);
  };

  const handleSignIn = async (username: string, password: string) => {
    setLoading(true);
    setError(null);
    const email = username.trim();
    const preview = findMockUserByEmail(email);
    const useMockAuth = !config.useApi || (preview != null && isMockOnlyRole(preview.role));

    if (useMockAuth) {
      setTimeout(() => {
        const match = authenticateMock(email, password);
        if (!match) {
          setError('Contact administrator');
          setLoading(false);
          return;
        }
        if (isTotpEnabled(match.email)) {
          setPendingLogin({ email: match.email, mode: 'mock', mockUser: match });
          setTotpEmail(match.email);
          setStep('totp');
          setLoading(false);
          return;
        }
        finishMockLogin(match);
        setLoading(false);
      }, 450);
      return;
    }

    try {
      await authApi.login(email, password);
      const me = await authApi.me();
      if (isTotpEnabled(me.email)) {
        const token = tokenStore.get();
        if (token) {
          tokenStore.clear();
          setPendingLogin({ email: me.email, mode: 'api', apiUser: me }, token);
        }
        setTotpEmail(me.email);
        setStep('totp');
        return;
      }
      dispatch(setTokens({ accessToken: 'api' }));
      dispatch(setUser({
        id: me.id,
        username: me.email,
        fullName: me.full_name,
        role: me.role as MockUser['role'],
        permissions: me.permissions,
      }));
      navigate('/');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Unable to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleTotpVerify = async (code: string) => {
    setLoading(true);
    setError(null);
    const secret = getTotpSecret(totpEmail);
    if (!secret) {
      setError('Two-factor is not configured on this device. Sign in and set up 2FA in Settings.');
      setLoading(false);
      return;
    }
    const ok = await verifyTotpCode(secret, code);
    if (!ok) {
      setError('Invalid authenticator code. Try again.');
      setLoading(false);
      return;
    }
    const pending = getPendingLogin();
    if (!pending) {
      backToSignIn();
      setLoading(false);
      return;
    }
    try {
      if (pending.mode === 'mock' && pending.mockUser) {
        clearPendingLogin();
        finishMockLogin(pending.mockUser);
      } else if (pending.mode === 'api' && pending.apiUser) {
        const token = getPendingApiToken();
        if (token) tokenStore.set(token);
        clearPendingLogin();
        dispatch(setTokens({ accessToken: 'api' }));
        dispatch(setUser({
          id: pending.apiUser.id,
          username: pending.apiUser.email,
          fullName: pending.apiUser.full_name,
          role: pending.apiUser.role as MockUser['role'],
          permissions: pending.apiUser.permissions,
        }));
        navigate('/');
      } else {
        setError('Session expired. Please sign in again.');
        backToSignIn();
      }
    } finally {
      setLoading(false);
    }
  };

  const cardShell = (
    <motion.div
      initial={{ opacity: 0, x: 60 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-[min(100%,28rem)]"
    >
      <motion.div
        animate={{ y: [0, -5, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
        className="relative rounded-[22px] border border-white/[.08] bg-[#022999]/75 p-5 backdrop-blur-2xl sm:rounded-[28px] sm:p-8 md:p-10 shadow-[0_32px_90px_-20px_rgba(0,0,0,.7),0_0_0_1px_rgba(255,255,255,.05),inset_0_1px_0_rgba(255,255,255,.06)]"
      >
        <div className="pointer-events-none absolute -top-20 left-1/2 h-40 w-80 -translate-x-1/2 rounded-full bg-[#0538cc]/35 blur-3xl" />
        {step === 'signin' ? (
          <LoginCard onSubmit={handleSignIn} loading={loading} error={error} embedded />
        ) : (
          <TotpLoginPanel
            email={totpEmail}
            loading={loading}
            error={error}
            onBack={backToSignIn}
            onSubmit={handleTotpVerify}
          />
        )}
      </motion.div>
    </motion.div>
  );

  return (
    <div className="relative h-dvh min-h-app w-full overflow-hidden bg-[#022999]">
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, #0538cc 0%, #022999 58%, #01186b 100%)' }}
      />
      <div className="relative z-10 flex h-full w-full flex-col overflow-y-auto overscroll-y-contain md:flex-row md:overflow-hidden">
        <div className="relative hidden h-full min-h-0 shrink-0 md:block md:w-[58%]">
          <PremiumLogoAnimation />
        </div>

        <div className="relative z-40 flex min-h-full w-full flex-1 items-center justify-center overflow-x-hidden px-safe py-6 pt-safe pb-safe sm:p-8 md:h-full md:min-h-0 md:w-[42%] md:max-w-none md:py-10">
          <div
            className="pla-noise"
            style={{
              backgroundImage:
                'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'200\' height=\'200\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'2\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")',
            }}
          />
          {cardShell}
        </div>
      </div>
    </div>
  );
}
