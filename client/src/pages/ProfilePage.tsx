import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { useAuth } from '../context/AuthContext.js';
import { AVATAR_OPTIONS } from '@bull-em/shared';
import type { AvatarId, GameHistoryEntry } from '@bull-em/shared';
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

const isCodespaces = typeof window !== 'undefined' && window.location.hostname.includes('.app.github.dev');
const API_BASE = import.meta.env.DEV && !isCodespaces ? 'http://localhost:3001' : '';

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

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 24) {
    if (diffHours < 1) {
      const mins = Math.floor(diffMs / (1000 * 60));
      return mins <= 1 ? 'Just now' : `${mins}m ago`;
    }
    return `${Math.floor(diffHours)}h ago`;
  }
  if (diffHours < 48) return 'Yesterday';

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function positionLabel(position: number): string {
  if (position === 1) return '1st';
  if (position === 2) return '2nd';
  if (position === 3) return '3rd';
  return `${position}th`;
}

function GameHistoryItem({ game }: { game: GameHistoryEntry }) {
  const isWin = game.finishPosition === 1;
  return (
    <div className="glass px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
          isWin
            ? 'bg-[var(--gold)]/20 text-[var(--gold)] border border-[var(--gold)]'
            : 'bg-white/5 text-[var(--gold-dim)] border border-white/10'
        }`}>
          {positionLabel(game.finishPosition)}
        </div>
        <div className="min-w-0">
          <p className="text-sm text-[var(--gold)] truncate">
            {isWin ? 'Victory' : `Won by ${game.winnerName}`}
          </p>
          <p className="text-[10px] text-[var(--gold-dim)]">
            {game.playerCount} players &middot; {formatDuration(game.durationSeconds)}
          </p>
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[10px] text-[var(--gold-dim)]">{formatDate(game.endedAt)}</p>
      </div>
    </div>
  );
}

export function ProfilePage() {
  const { user, profile, loading, logout, updateAvatar } = useAuth();
  const { addToast } = useToast();
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [gameHistory, setGameHistory] = useState<GameHistoryEntry[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const fetchGameHistory = useCallback(async (offset = 0) => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/games?limit=10&offset=${offset}`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json() as { games: GameHistoryEntry[]; total: number };
      if (offset === 0) {
        setGameHistory(data.games);
      } else {
        setGameHistory(prev => [...prev, ...data.games]);
      }
      setHistoryTotal(data.total);
      setHistoryLoaded(true);
    } catch {
      addToast('Failed to load game history');
    } finally {
      setHistoryLoading(false);
    }
  }, [addToast]);

  // Fetch game history when profile loads
  useEffect(() => {
    if (profile && !historyLoaded) {
      fetchGameHistory();
    }
  }, [profile, historyLoaded, fetchGameHistory]);

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
  const hasMore = gameHistory.length < historyTotal;

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

        {/* Game History */}
        <div className="w-full mb-6">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-3 px-1">
            Recent Games {historyTotal > 0 && `(${historyTotal})`}
          </p>
          {historyLoading && gameHistory.length === 0 ? (
            <div className="flex justify-center py-4">
              <div className="w-6 h-6 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : gameHistory.length === 0 ? (
            <div className="glass px-4 py-4 text-center">
              <p className="text-[var(--gold-dim)] text-xs">No games played yet</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {gameHistory.map(game => (
                <GameHistoryItem key={`${game.id}-${game.endedAt}`} game={game} />
              ))}
              {hasMore && (
                <button
                  onClick={() => fetchGameHistory(gameHistory.length)}
                  disabled={historyLoading}
                  className="w-full glass px-4 py-2 text-sm text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
                >
                  {historyLoading ? 'Loading...' : 'Load More'}
                </button>
              )}
            </div>
          )}
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
