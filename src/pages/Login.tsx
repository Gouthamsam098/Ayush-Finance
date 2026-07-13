import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { setTokens, setUser } from '@/store/authSlice';
import { config } from '@/lib/config';
import { authApi } from '@/services/authApi';
import { ApiError } from '@/lib/api';
import loginBg from '@/assets/login-bg.png';
import Hero from '@/components/Hero';
import LoginCard from '@/components/LoginCard';

export default function Login() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const handleSignIn = async (username: string, password: string) => {
    setLoading(true);
    setError(null);

    // Mock path: unchanged stub behaviour when the API flag is off.
    if (!config.useApi) {
      setTimeout(() => {
        dispatch(setTokens({ accessToken: 'demo-token' }));
        dispatch(setUser({ id: 'demo', username, fullName: 'Administrator', role: 'ADMIN' }));
        navigate('/');
      }, 450);
      return;
    }

    // Real backend: username field carries the email in API mode.
    try {
      await authApi.login(username, password);
      const me = await authApi.me();
      dispatch(setTokens({ accessToken: 'api' })); // presence gates ProtectedRoute; real token is in tokenStore
      dispatch(setUser({ id: me.id, username: me.email, fullName: me.full_name, role: 'ADMIN' }));
      navigate('/');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Unable to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-slate-50">
      {/* Family background image */}
      <div
        className="absolute inset-0"
        style={{ backgroundImage: `url(${loginBg})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
      />
      {/* Readability wash — lighter on the left (hero), stronger toward the login column */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/70 via-white/50 to-white/80" />

      <div className="relative z-10 flex h-full w-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        {/* Hero */}
        <div className="relative w-full lg:w-[62%]">
          <Hero />
        </div>

        {/* Login column */}
        <div className="relative z-40 flex w-full items-center justify-center p-6 md:p-10 lg:w-[38%] lg:h-full">
          <LoginCard onSubmit={handleSignIn} loading={loading} error={error} />
        </div>
      </div>
    </div>
  );
}
