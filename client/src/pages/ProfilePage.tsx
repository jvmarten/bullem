import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { useAuth } from '../context/AuthContext.js';

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="glass px-4 py-3 text-center">
      <p className="text-xl font-bold text-[var(--gold)]">{value}</p>
      <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mt-1">
        {label}
      </p>
    </div>
  );
}

export function ProfilePage() {
  const { user, profile, loading, logout } = useAuth();

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center pt-20">
          <div className="w-8 h-8 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!user || !profile) {
    return (
      <Layout>
        <div className="flex flex-col items-center pt-12 max-w-sm mx-auto text-center">
          <p className="text-[var(--gold-dim)] mb-4">You need to sign in to view your profile.</p>
          <Link to="/login" className="btn-gold py-3 px-8 text-lg">
            Sign In
          </Link>
        </div>
      </Layout>
    );
  }

  const memberSince = new Date(profile.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
  });

  return (
    <Layout>
      <div className="flex flex-col items-center pt-8 max-w-md mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-[var(--gold)]/20 border-2 border-[var(--gold)] flex items-center justify-center mx-auto mb-3">
            <span className="text-2xl font-bold text-[var(--gold)]">
              {profile.displayName.charAt(0).toUpperCase()}
            </span>
          </div>
          <h1
            className="text-2xl font-bold text-[var(--gold)]"
            style={{ fontFamily: "'Cormorant Garamond', serif" }}
          >
            {profile.displayName}
          </h1>
          <p className="text-xs text-[var(--gold-dim)] mt-1">@{profile.username}</p>
          <p className="text-[10px] text-[var(--gold-dim)] mt-0.5">Member since {memberSince}</p>
        </div>

        {/* Stats Grid */}
        <div className="w-full grid grid-cols-2 gap-3 mb-6">
          <StatCard label="Games Played" value={profile.gamesPlayed} />
          <StatCard label="Wins" value={profile.gamesWon} />
          <StatCard
            label="Bull Accuracy"
            value={profile.bullAccuracy !== null ? `${profile.bullAccuracy}%` : '—'}
          />
          <StatCard
            label="Bluff Success"
            value={profile.bluffSuccessRate !== null ? `${profile.bluffSuccessRate}%` : '—'}
          />
        </div>

        {/* Actions */}
        <div className="w-full flex flex-col gap-3">
          <button
            onClick={logout}
            className="w-full btn-ghost py-3 text-sm"
          >
            Sign Out
          </button>
          <Link
            to="/"
            className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors text-center"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </Layout>
  );
}

export default ProfilePage;
