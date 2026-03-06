import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { useAuth } from '../context/AuthContext.js';
import { AVATAR_OPTIONS } from '@bull-em/shared';
import type { AvatarId } from '@bull-em/shared';
import { useToast } from '../context/ToastContext.js';

/** Emoji icons for each avatar template. */
const AVATAR_ICONS: Record<AvatarId, string> = {
  bull: '\u{1F402}',
  ace: '\u{1F0CF}',
  crown: '\u{1F451}',
  diamond: '\u{1F48E}',
  flame: '\u{1F525}',
  skull: '\u{1F480}',
  star: '\u{2B50}',
  wolf: '\u{1F43A}',
  eagle: '\u{1F985}',
  lion: '\u{1F981}',
  fox: '\u{1F98A}',
  bear: '\u{1F43B}',
};

/** Returns the emoji for a given avatar ID, or the user's initial as fallback. */
export function avatarDisplay(avatar: AvatarId | null | undefined, fallbackName: string): string {
  if (avatar && avatar in AVATAR_ICONS) return AVATAR_ICONS[avatar];
  return fallbackName.charAt(0).toUpperCase();
}

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
  const { user, profile, loading, logout, updateAvatar } = useAuth();
  const { addToast } = useToast();
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);

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

  const handleAvatarSelect = async (avatar: AvatarId | null) => {
    setSavingAvatar(true);
    try {
      await updateAvatar(avatar);
      setShowAvatarPicker(false);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to update avatar');
    } finally {
      setSavingAvatar(false);
    }
  };

  const currentDisplay = avatarDisplay(profile.avatar, profile.displayName);
  const isEmoji = profile.avatar !== null;

  return (
    <Layout>
      <div className="flex flex-col items-center pt-8 max-w-md mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <button
            onClick={() => setShowAvatarPicker(v => !v)}
            className="w-16 h-16 rounded-full bg-[var(--gold)]/20 border-2 border-[var(--gold)] flex items-center justify-center mx-auto mb-3 hover:border-white transition-colors cursor-pointer"
            title="Change avatar"
          >
            <span className={isEmoji ? 'text-2xl' : 'text-2xl font-bold text-[var(--gold)]'}>
              {currentDisplay}
            </span>
          </button>
          <h1
            className="text-2xl font-bold text-[var(--gold)]"
            style={{ fontFamily: "'Cormorant Garamond', serif" }}
          >
            {profile.displayName}
          </h1>
          <p className="text-xs text-[var(--gold-dim)] mt-1">@{profile.username}</p>
          <p className="text-[10px] text-[var(--gold-dim)] mt-0.5">Member since {memberSince}</p>
        </div>

        {/* Avatar Picker */}
        {showAvatarPicker && (
          <div className="w-full glass px-4 py-3 mb-6 animate-fade-in">
            <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-3">
              Choose Avatar
            </p>
            <div className="grid grid-cols-6 gap-2">
              {AVATAR_OPTIONS.map(id => (
                <button
                  key={id}
                  onClick={() => handleAvatarSelect(id)}
                  disabled={savingAvatar}
                  className={`w-full aspect-square rounded-lg flex items-center justify-center text-xl transition-all ${
                    profile.avatar === id
                      ? 'bg-[var(--gold)] border-2 border-[var(--gold)] scale-110'
                      : 'glass hover:scale-105 border border-transparent hover:border-[var(--gold-dim)]'
                  }`}
                  title={id}
                >
                  {AVATAR_ICONS[id]}
                </button>
              ))}
            </div>
            {profile.avatar && (
              <button
                onClick={() => handleAvatarSelect(null)}
                disabled={savingAvatar}
                className="w-full mt-2 text-xs text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
              >
                Remove avatar (use initial)
              </button>
            )}
          </div>
        )}

        {/* Stats Grid */}
        <div className="w-full grid grid-cols-2 gap-3 mb-6">
          <StatCard label="Games Played" value={profile.gamesPlayed} />
          <StatCard label="Wins" value={profile.gamesWon} />
          <StatCard
            label="Bull Accuracy"
            value={profile.bullAccuracy !== null ? `${profile.bullAccuracy}%` : '\u2014'}
          />
          <StatCard
            label="Bluff Success"
            value={profile.bluffSuccessRate !== null ? `${profile.bluffSuccessRate}%` : '\u2014'}
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
