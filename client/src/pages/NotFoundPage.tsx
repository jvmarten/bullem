import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="felt-bg text-[#e8e0d4] items-center justify-center p-4">
      <div className="text-center space-y-4 glass p-8 max-w-sm">
        <h1 className="font-display text-4xl font-bold text-[var(--gold)]">404</h1>
        <p className="text-[var(--gold-dim)] text-sm">
          Page not found. The URL you followed may be outdated or mistyped.
        </p>
        <Link to="/" className="btn-gold px-6 py-2 inline-block">
          Go Home
        </Link>
      </div>
    </div>
  );
}
