import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { useAuth } from '../context/AuthContext.js';

export function LoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(identifier, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <div className="flex flex-col items-center pt-12 max-w-sm mx-auto">
        <h1
          className="text-2xl font-bold mb-6 text-[var(--gold)]"
          style={{ fontFamily: "'Cormorant Garamond', serif" }}
        >
          Sign In
        </h1>

        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
          {error && (
            <div className="glass px-4 py-3 text-sm text-red-400 border border-red-400/30">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold">
              Username or Email
            </label>
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              autoComplete="username"
              className="input-felt"
              placeholder="username or you@example.com"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              minLength={8}
              className="input-felt"
              placeholder="Enter password"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="btn-gold py-3 text-lg mt-2"
          >
            {submitting ? 'Signing in\u2026' : 'Sign In'}
          </button>
        </form>

        <p className="text-sm text-[var(--gold-dim)] mt-6">
          Don&apos;t have an account?{' '}
          <Link to="/register" className="text-[var(--gold)] hover:underline">
            Create one
          </Link>
        </p>

        <Link
          to="/"
          className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors mt-4"
        >
          Back to Home
        </Link>
      </div>
    </Layout>
  );
}

export default LoginPage;
