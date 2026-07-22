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
    <div className="relative flex h-screen w-screen overflow-hidden bg-slate-950">
      {/* Dark mesh gradient background */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-950 to-slate-950" />
        <div className="absolute right-0 top-0 h-[600px] w-[600px] rounded-full bg-blue-600/20 blur-[120px]" />
        <div className="absolute -left-20 bottom-0 h-[500px] w-[500px] rounded-full bg-indigo-600/15 blur-[100px]" />
        <div className="absolute left-1/3 top-1/2 h-[400px] w-[400px] rounded-full bg-blue-400/10 blur-[80px]" />
        {/* Subtle grid */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,.03)_1px,transparent_1px)] bg-[size:40px_40px]" />
      </div>

      <div className="relative z-10 flex h-full w-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="relative w-full lg:w-[58%]">
          <Hero />
        </div>
        <div className="relative z-40 flex w-full items-center justify-center p-6 md:p-10 lg:w-[42%] lg:h-full">
          <LoginCard onSubmit={handleSignIn} loading={loading} error={error} />
        </div>
      </div>
    </div>
  );
}
