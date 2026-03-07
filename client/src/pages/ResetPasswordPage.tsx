import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Layout } from '../components/Layout.js';

// Vite proxies /auth and /api to the server in dev — relative URLs work from any device.
const API_BASE = '';

export function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json() as { message?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? 'Request failed');
      }
      navigate('/login?reset=success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <Layout>
        <div className="flex flex-col items-center pt-12 max-w-sm mx-auto">
          <h1
            className="text-2xl font-bold mb-6 text-[var(--gold)]"
            style={{ fontFamily: "'Cormorant Garamond', serif" }}
          >
            Invalid Link
          </h1>
          <div className="glass px-4 py-3 text-sm text-red-400 border border-red-400/30 w-full text-center">
            This password reset link is invalid. Please request a new one.
          </div>
          <Link
            to="/forgot-password"
            className="text-sm text-[var(--gold)] hover:underline mt-4"
          >
            Request a new reset link
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col items-center pt-12 max-w-sm mx-auto">
        <h1
          className="text-2xl font-bold mb-6 text-[var(--gold)]"
          style={{ fontFamily: "'Cormorant Garamond', serif" }}
        >
          Set New Password
        </h1>

        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
          {error && (
            <div className="glass px-4 py-3 text-sm text-red-400 border border-red-400/30">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold">
              New Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={8}
              className="input-felt"
              placeholder="Enter new password"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold">
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={8}
              className="input-felt"
              placeholder="Confirm new password"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="btn-gold py-3 text-lg mt-2"
          >
            {submitting ? 'Resetting\u2026' : 'Reset Password'}
          </button>
        </form>

        <Link
          to="/login"
          className="text-sm text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors mt-4"
        >
          Back to Sign In
        </Link>
      </div>
    </Layout>
  );
}

export default ResetPasswordPage;
