import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout.js';

const isCodespaces = typeof window !== 'undefined' && window.location.hostname.includes('.app.github.dev');
const API_BASE = import.meta.env.DEV && !isCodespaces ? 'http://localhost:3001' : '';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json() as { message?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? 'Request failed');
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
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
          Reset Password
        </h1>

        {submitted ? (
          <div className="w-full flex flex-col gap-4 items-center">
            <div className="glass px-4 py-3 text-sm text-[var(--gold)] border border-[var(--gold)]/30 w-full text-center">
              Check your email for a password reset link. It may take a minute to arrive.
            </div>
            <Link
              to="/login"
              className="text-sm text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors mt-2"
            >
              Back to Sign In
            </Link>
          </div>
        ) : (
          <>
            <p className="text-sm text-[var(--gold-dim)] mb-4 text-center">
              Enter the email address associated with your account and we&apos;ll send you a link to reset your password.
            </p>

            <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
              {error && (
                <div className="glass px-4 py-3 text-sm text-red-400 border border-red-400/30">
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="input-felt"
                  placeholder="you@example.com"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="btn-gold py-3 text-lg mt-2"
              >
                {submitting ? 'Sending\u2026' : 'Send Reset Link'}
              </button>
            </form>

            <Link
              to="/login"
              className="text-sm text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors mt-4"
            >
              Back to Sign In
            </Link>
          </>
        )}
      </div>
    </Layout>
  );
}

export default ForgotPasswordPage;
