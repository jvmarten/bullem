import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { useAuth } from '../context/AuthContext.js';

const isCodespaces = typeof window !== 'undefined' && window.location.hostname.includes('.app.github.dev');
const API_BASE = import.meta.env.DEV && !isCodespaces ? 'http://localhost:3001' : '';

export function LoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Dev auth detection — one-tap login in dev mode
  const [devAuth, setDevAuth] = useState(false);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fetch(`${API_BASE}/api/dev-status`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.devAuth) setDevAuth(true); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (searchParams.get('error') === 'oauth_failed') {
      setError('Sign-in failed. Please try again.');
    }
    if (searchParams.get('reset') === 'success') {
      setSuccessMessage('Password reset successfully. You can now sign in with your new password.');
    }
  }, [searchParams]);

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

        {successMessage && (
          <div className="w-full glass px-4 py-3 text-sm text-green-400 border border-green-400/30 mb-4">
            {successMessage}
          </div>
        )}

        {error && (
          <div className="w-full glass px-4 py-3 text-sm text-red-400 border border-red-400/30 mb-4">
            {error}
          </div>
        )}

        {/* One-tap dev login — only in dev mode without DB */}
        {devAuth && (
          <button
            type="button"
            onClick={async () => {
              setSubmitting(true);
              try {
                await login('DevPlayer', 'dev');
                navigate('/');
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Dev login failed');
              } finally {
                setSubmitting(false);
              }
            }}
            disabled={submitting}
            className="w-full py-3 rounded-lg font-medium transition-colors mb-4"
            style={{
              background: 'linear-gradient(135deg, rgba(255,200,0,0.2), rgba(255,200,0,0.1))',
              border: '1px solid rgba(255,200,0,0.4)',
              color: 'var(--gold)',
            }}
          >
            {submitting ? 'Signing in\u2026' : '\u26A1 Dev Login (any credentials)'}
          </button>
        )}

        {/* OAuth buttons — primary sign-in method */}
        <a
          href={`${API_BASE}/auth/google`}
          className="w-full flex items-center justify-center gap-3 py-3 rounded-lg text-[#333] font-medium transition-colors"
          style={{ backgroundColor: 'rgba(255,255,255,0.95)' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,1)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.95)'; }}
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.003 24.003 0 0 0 0 21.56l7.98-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Continue with Google
        </a>

        <a
          href={`${API_BASE}/auth/apple`}
          className="w-full flex items-center justify-center gap-3 py-3 rounded-lg text-white font-medium transition-colors mt-3"
          style={{ backgroundColor: '#000' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#1a1a1a'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#000'; }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
          </svg>
          Continue with Apple
        </a>

        {/* Divider */}
        <div className="w-full flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-[var(--gold-dim)] opacity-30" />
          <span className="text-xs text-[var(--gold-dim)]">&mdash; or &mdash;</span>
          <div className="flex-1 h-px bg-[var(--gold-dim)] opacity-30" />
        </div>

        {/* Email/password form — always visible for returning users */}
        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
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

        <Link
          to="/forgot-password"
          className="text-sm text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors mt-3"
        >
          Forgot password?
        </Link>

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
