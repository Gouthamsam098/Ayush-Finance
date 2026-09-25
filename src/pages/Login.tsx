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

/** Demo-only roles stored in localStorage — never in the Go backend. */
function isMockOnlyRole(role: MockUser['role']): boolean {
  return role === 'CUSTOMER' || role === 'RECOVERY_AGENT';
}

export default function Login() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const handleSignIn = async (username: string, password: string) => {
    setLoading(true);
    setError(null);
    const email = username.trim();
    const preview = findMockUserByEmail(email);
    const useMockAuth = !config.useApi || (preview != null && isMockOnlyRole(preview.role));

    if (useMockAuth) {
      setTimeout(() => {
        const match = authenticateMock(email, password);
        if (match) finishMockLogin(match);
        else setError('Contact administrator');
        setLoading(false);
      }, 450);
      return;
    }

    try {
      await authApi.login(email, password);
      const me = await authApi.me();
      dispatch(setTokens({ accessToken: 'api' }));
      dispatch(setUser({ id: me.id, username: me.email, fullName: me.full_name, role: me.role, permissions: me.permissions }));
      navigate('/');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Unable to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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
          <LoginCard onSubmit={handleSignIn} loading={loading} error={error} />
        </div>
      </div>
    </div>
  );
}
