import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { useAuth } from '../context/AuthContext.js';
import { AVATAR_OPTIONS, openSkillDisplayRating } from '@bull-em/shared';
import type { AvatarId, GameHistoryEntry, PlayerStatsResponse, UserRatings } from '@bull-em/shared';
import { useToast } from '../context/ToastContext.js';
import { RankBadge } from '../components/RankBadge.js';
import { AdvancedStats } from '../components/AdvancedStats.js';

/** Emoji icons for each avatar template. */
const AVATAR_ICONS: Record<AvatarId, string> = {
  bull: '\u{1F402}',
  ace: '\u{1F0CF}',
  crown: '\u{1F451}',
  diamond: '\u{1F48E}',
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

// Vite proxies /auth and /api to the server in dev — relative URLs work from any device.
const API_BASE = '';

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

function StatCardSkeleton() {
  return (
    <div className="glass px-4 py-3 text-center animate-pulse">
      <div className="h-7 w-12 bg-[var(--gold)]/10 rounded mx-auto mb-1" />
      <div className="h-3 w-16 bg-[var(--gold)]/10 rounded mx-auto" />
    </div>
  );
}

function GameHistorySkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="glass px-4 py-3 flex items-center gap-3 animate-pulse">
          <div className="w-8 h-8 rounded-full bg-[var(--gold)]/10 shrink-0" />
          <div className="flex-1">
            <div className="h-4 w-24 bg-[var(--gold)]/10 rounded mb-1" />
            <div className="h-3 w-16 bg-[var(--gold)]/10 rounded" />
          </div>
          <div className="h-3 w-12 bg-[var(--gold)]/10 rounded" />
        </div>
      ))}
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
  const is1v1 = game.playerCount === 2;
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
            {isWin ? 'Victory' : is1v1 ? 'Loss' : `Won by ${game.winnerName}`}
          </p>
          <p className="text-[10px] text-[var(--gold-dim)]">
            {is1v1 ? '1v1' : `${game.playerCount} players`} &middot; {formatDuration(game.durationSeconds)}
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
  const { user, profile, loading, logout, updateAvatar, uploadPhoto } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stats, setStats] = useState<PlayerStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [ratings, setRatings] = useState<UserRatings | null>(null);

  const fetchRatings = useCallback(async (userId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/ratings/${userId}`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json() as UserRatings;
      setRatings(data);
    } catch {
      // Non-critical — ratings may not exist yet
    }
  }, []);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/stats/me`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json() as PlayerStatsResponse;
      setStats(data);
      setStatsLoaded(true);
    } catch {
      addToast('Failed to load stats');
    } finally {
      setStatsLoading(false);
    }
  }, [addToast]);

  // Fetch stats and ratings when profile loads
  useEffect(() => {
    if (profile && !statsLoaded) {
      fetchStats();
      fetchRatings(profile.id);
    }
  }, [profile, statsLoaded, fetchStats, fetchRatings]);

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
          <p className="text-[var(--gold-dim)] mb-4">
            Sign in to track your stats, win rate, and game history.
          </p>
          <Link to="/login" className="btn-gold py-3 px-8 text-lg">
            Sign In
          </Link>
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

  const isAdmin = user.role === 'admin';

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      addToast('Only JPEG, PNG, and WebP images are allowed');
      return;
    }

    // Validate file size (~1.5 MB raw)
    if (file.size > 1.5 * 1024 * 1024) {
      addToast('Photo must be under 1.5 MB');
      return;
    }

    setUploadingPhoto(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
      await uploadPhoto(dataUrl);
      setShowAvatarPicker(false);
      addToast('Profile photo updated');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to upload photo');
    } finally {
      setUploadingPhoto(false);
      // Reset file input so re-selecting the same file triggers onChange
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemovePhoto = async () => {
    setUploadingPhoto(true);
    try {
      await uploadPhoto(null);
      addToast('Profile photo removed');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to remove photo');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const currentDisplay = avatarDisplay(profile.avatar, profile.displayName);
  const isEmoji = profile.avatar !== null;

  const playerCountEntries = stats
    ? Object.entries(stats.gamesByPlayerCount).sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10))
    : [];

  return (
    <Layout>
      <div className="flex flex-col items-center pt-8 max-w-md mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <button
            onClick={() => setShowAvatarPicker(v => !v)}
            className="w-16 h-16 rounded-full bg-[var(--gold)]/20 border-2 border-[var(--gold)] flex items-center justify-center mx-auto mb-3 hover:border-white transition-colors cursor-pointer overflow-hidden"
            title="Change avatar"
          >
            {profile.photoUrl ? (
              <img src={profile.photoUrl} alt={profile.displayName} className="w-full h-full object-cover" />
            ) : (
              <span className={isEmoji ? 'text-2xl' : 'text-2xl font-bold text-[var(--gold)]'}>
                {currentDisplay}
              </span>
            )}
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
            {isAdmin && (
              <div className="mt-3 pt-3 border-t border-white/10">
                <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
                  Upload Photo
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handlePhotoUpload}
                  className="hidden"
                  id="photo-upload"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingPhoto}
                  className="w-full glass py-2 px-3 text-xs text-[var(--gold)] hover:border-[var(--gold-dim)] transition-colors border border-transparent"
                >
                  {uploadingPhoto ? 'Uploading...' : 'Choose from device'}
                </button>
                {profile.photoUrl && (
                  <button
                    onClick={handleRemovePhoto}
                    disabled={uploadingPhoto}
                    className="w-full mt-1 text-xs text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
                  >
                    Remove photo
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Ranked Ratings */}
        {(ratings?.headsUp || ratings?.multiplayer) && (
          <div className="w-full grid grid-cols-2 gap-3 mb-6">
            {ratings.headsUp && (() => {
              const r = ratings.headsUp;
              return (
                <div className="glass px-4 py-3">
                  <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
                    Heads-Up 1v1
                  </p>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xl font-bold text-[var(--gold)]">{r.elo}</span>
                    <RankBadge rating={r.elo} size="md" />
                  </div>
                  <p className="text-[10px] text-[var(--gold-dim)]">
                    {r.gamesPlayed} games &middot; Peak {r.peakRating}
                  </p>
                </div>
              );
            })()}
            {ratings.multiplayer && (() => {
              const r = ratings.multiplayer;
              const displayRating = openSkillDisplayRating(r.mu);
              return (
                <div className="glass px-4 py-3">
                  <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
                    Multiplayer
                  </p>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xl font-bold text-[var(--gold)]">{displayRating}</span>
                    <RankBadge rating={displayRating} size="md" />
                  </div>
                  <p className="text-[10px] text-[var(--gold-dim)]">
                    {r.gamesPlayed} games &middot; Peak {r.peakRating}
                  </p>
                </div>
              );
            })()}
            {/* Fill empty slot if only one rating exists */}
            {!ratings.headsUp && <div />}
            {!ratings.multiplayer && <div />}
          </div>
        )}

        {/* Stats Grid */}
        {statsLoading && !stats ? (
          <div className="w-full grid grid-cols-2 gap-3 mb-6">
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </div>
        ) : stats && stats.gamesPlayed > 0 ? (
          <>
            <div className="w-full grid grid-cols-2 gap-3 mb-4">
              <StatCard label="Games Played" value={stats.gamesPlayed} />
              <StatCard label="Wins" value={stats.wins} />
              <StatCard
                label="Win Rate"
                value={stats.winRate !== null ? `${stats.winRate}%` : '\u2014'}
              />
              <StatCard
                label="Avg Finish"
                value={stats.avgFinishPercentile != null ? `${stats.avgFinishPercentile}%` : stats.avgFinishPosition !== null ? `${stats.avgFinishPosition}` : '\u2014'}
              />
              <StatCard
                label="Bull Accuracy"
                value={stats.bullAccuracy !== null ? `${stats.bullAccuracy}%` : '\u2014'}
              />
              <StatCard
                label="True Accuracy"
                value={stats.trueAccuracy !== null ? `${stats.trueAccuracy}%` : '\u2014'}
              />
            </div>
            <div className="w-full grid grid-cols-1 gap-3 mb-6">
              <StatCard
                label="Bluff Success"
                value={stats.bluffSuccessRate !== null ? `${stats.bluffSuccessRate}%` : '\u2014'}
              />
            </div>

            {/* Games by Player Count */}
            {playerCountEntries.length > 0 && (
              <div className="w-full mb-6">
                <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-3 px-1">
                  Games by Player Count
                </p>
                <div className="glass px-4 py-3">
                  <div className="flex flex-wrap gap-3">
                    {playerCountEntries.map(([count, num]) => (
                      <div key={count} className="text-center min-w-[48px]">
                        <p className="text-sm font-bold text-[var(--gold)]">{num}</p>
                        <p className="text-[10px] text-[var(--gold-dim)]">{count}p</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : stats && stats.gamesPlayed === 0 ? (
          <div className="w-full glass px-4 py-6 text-center mb-6">
            <p className="text-[var(--gold-dim)] text-sm">No games played yet</p>
            <p className="text-[var(--gold-dim)] text-xs mt-1">Play a game to start tracking your stats!</p>
          </div>
        ) : null}

        {/* Recent Game History */}
        <div className="w-full mb-6">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-3 px-1">
            Recent Games {stats && stats.gamesPlayed > 0 && `(${stats.recentGames.length})`}
          </p>
          {statsLoading && !stats ? (
            <GameHistorySkeleton />
          ) : stats && stats.recentGames.length > 0 ? (
            <div className="flex flex-col gap-2">
              {stats.recentGames.map(game => (
                <GameHistoryItem key={`${game.id}-${game.endedAt}`} game={game} />
              ))}
            </div>
          ) : (
            <div className="glass px-4 py-4 text-center">
              <p className="text-[var(--gold-dim)] text-xs">No games played yet</p>
            </div>
          )}
        </div>

        {/* Advanced Stats — loaded asynchronously so basic stats render immediately */}
        {profile && <AdvancedStats userId={profile.id} />}

        {/* Actions */}
        <div className="w-full flex flex-col gap-3">
          <Link
            to="/replays"
            className="w-full btn-ghost py-3 text-sm text-center"
          >
            My Replays
          </Link>
          <button
            onClick={async () => { await logout(); navigate('/'); }}
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
