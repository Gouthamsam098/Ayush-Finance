import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { setTokens, setUser } from '@/store/authSlice';
import { config } from '@/lib/config';
import { authApi } from '@/services/authApi';
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
        dispatch(setTokens({ accessToken: 'demo-token' }));
        dispatch(setUser({ id: 0, username, fullName: 'Administrator', role: 'ADMIN' }));
        navigate('/');
      }, 450);
      return;
    }
    try {
      await authApi.login(username, password);
      const me = await authApi.me();
      dispatch(setTokens({ accessToken: 'api' }));
      dispatch(setUser({ id: me.id, username: me.email, fullName: me.full_name, role: 'ADMIN' }));
      navigate('/');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Unable to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex h-screen w-screen overflow-hidden" style={{ background: '#020617' }}>
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, #0a1f3d 0%, #020617 60%, #000510 100%)' }}
      />
      <div className="relative z-10 flex h-full w-full flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <div className="relative hidden h-[42vh] w-full md:block md:h-full md:w-[58%]">
          <PremiumLogoAnimation />
        </div>

        <div className="relative z-40 flex h-full w-full items-center justify-center p-6 md:p-10 md:w-[42%] md:h-full">
          <LoginCard onSubmit={handleSignIn} loading={loading} error={error} />
        </div>
      </div>
    </div>
  );
}
