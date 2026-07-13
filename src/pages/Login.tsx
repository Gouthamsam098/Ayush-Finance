import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { setTokens, setUser } from '@/store/authSlice';
import loginBg from '@/assets/login-bg.png';
import Hero from '@/components/Hero';
import LoginCard from '@/components/LoginCard';

export default function Login() {
  const [loading, setLoading] = useState(false);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const handleSignIn = (username: string, password: string) => {
    setLoading(true);
    setTimeout(() => {
      dispatch(setTokens({ accessToken: 'demo-token' }));
      dispatch(setUser({ id: 'demo', username, fullName: 'Administrator', role: 'ADMIN' }));
      navigate('/');
    }, 450);
  };

  return (
    <div className="relative w-screen h-screen flex overflow-hidden bg-white">
      {/* Background image with overlay */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${loginBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />

      {/* White overlay for readability */}
      <div className="absolute inset-0 bg-white/25 pointer-events-none" />

      {/* Content Container */}
      <div className="relative z-10 w-full h-full flex flex-col lg:flex-row overflow-hidden">
        {/* Left side - Hero Section (68%) */}
        <div className="relative flex-1 w-full lg:w-2/3 h-full">
          <Hero />
        </div>

        {/* Right side - Login Card (32%) */}
        <div className="relative w-full lg:w-1/3 flex flex-col justify-center items-center p-6 md:p-8 lg:p-12 bg-white lg:h-full overflow-y-auto z-40">
          <LoginCard onSubmit={handleSignIn} loading={loading} />
        </div>
      </div>
    </div>
  );
}
