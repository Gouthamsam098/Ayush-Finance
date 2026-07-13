import Logo from './Logo';
import LoginForm from './LoginForm';

interface LoginCardProps {
  onSubmit: (username: string, password: string) => void;
  loading?: boolean;
}

export default function LoginCard({ onSubmit, loading = false }: LoginCardProps) {
  return (
    <div className="w-full max-w-lg rounded-[36px] bg-white shadow-2xl p-16">
      <div className="mb-10 flex items-center justify-center">
        <Logo size="lg" />
      </div>

      <h1 className="text-3xl font-black text-center text-slate-900 mb-3">Welcome back</h1>
      <p className="text-center text-slate-600 text-base mb-10">Sign in to continue</p>

      <LoginForm onSubmit={onSubmit} loading={loading} />
    </div>
  );
}
