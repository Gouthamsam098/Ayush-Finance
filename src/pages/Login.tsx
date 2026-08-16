import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { setTokens, setUser } from '@/store/authSlice';
import { config } from '@/lib/config';
import { authApi } from '@/services/authApi';
import { authenticateMock } from '@/lib/mockUsers';
import { ApiError } from '@/lib/api';
import LoginCard from '@/components/LoginCard';
import PremiumLogoAnimation from '@/components/PremiumLogoAnimation';

export default function Login() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const handleSignIn = async (username: string, password: string) => {
    setLoading(true);
    setError(null);
    if (!config.useApi) {
      setTimeout(() => {
        const match = authenticateMock(username, password);
        if (!match) {
          setError('No account found for that email. Sign in as admin and create the user in Settings first.');
          setLoading(false);
          return;
        }
        dispatch(setTokens({ accessToken: 'demo-token' }));
        dispatch(setUser({
          id: match.id,
          username: match.email,
          fullName: match.fullName,
          role: match.role,
          permissions: match.permissions ?? {},
        }));
        navigate('/');
        setLoading(false);
      }, 450);
      return;
    }
    try {
      await authApi.login(username, password);
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
    <div className="relative flex h-screen w-screen overflow-hidden" style={{ background: '#2e0196' }}>
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, #3a14a8 0%, #2e0196 60%, #220078 100%)' }}
      />
      <div className="relative z-10 flex h-full w-full flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <div className="relative hidden h-[42vh] w-full md:block md:h-full md:w-[58%]">
          <PremiumLogoAnimation />
        </div>

        <div className="relative z-40 flex h-full w-full items-center justify-center overflow-hidden p-6 md:p-10 md:w-[42%] md:h-full">
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
