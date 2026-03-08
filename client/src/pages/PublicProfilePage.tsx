import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { BOT_PROFILE_MAP, BOT_AVATAR_MAP, IMPOSSIBLE_BOT, openSkillDisplayRating } from '@bull-em/shared';
import type { PlayerStatsResponse, UserRatings, PublicProfile, GameHistoryEntry } from '@bull-em/shared';
import { RankBadge } from '../components/RankBadge.js';
import { avatarDisplay } from './ProfilePage.js';
import { useAuth } from '../context/AuthContext.js';
import { AdvancedStats } from '../components/AdvancedStats.js';

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

interface BotProfileData {
  name: string;
  personality: string;
  avatar: string;
  level: number;
  personalityKey: string;
}

function getBotProfileFromName(name: string): BotProfileData | null {
  for (const [key, profile] of BOT_PROFILE_MAP) {
    if (profile.name === name) {
      const levelMatch = key.match(/_lvl(\d+)$/);
      const level = levelMatch ? parseInt(levelMatch[1]!, 10) : 0;
      return {
        name: profile.name,
        personality: profile.personality,
        avatar: profile.avatar,
        level,
        personalityKey: key.replace(/_lvl\d+$/, ''),
      };
    }
  }
  return null;
}

// ── Zalgo text for The Oracle's corrupted profile ────────────────────────

/** Combining diacritical marks that stack above/below characters, creating the "Zalgo" effect. */
const ZALGO_UP = [
  '\u0300', '\u0301', '\u0302', '\u0303', '\u0304', '\u0305', '\u0306', '\u0307',
  '\u0308', '\u0309', '\u030A', '\u030B', '\u030C', '\u030D', '\u030E', '\u030F',
  '\u0310', '\u0311', '\u0312', '\u0313', '\u0314', '\u0315', '\u031A', '\u033D',
  '\u034A', '\u034B', '\u034C', '\u0350', '\u0351', '\u0352', '\u0357', '\u0358',
  '\u035B', '\u035D', '\u035E', '\u0360', '\u0361',
];
const ZALGO_DOWN = [
  '\u0316', '\u0317', '\u0318', '\u0319', '\u031C', '\u031D', '\u031E', '\u031F',
  '\u0320', '\u0321', '\u0322', '\u0323', '\u0324', '\u0325', '\u0326', '\u0327',
  '\u0328', '\u0329', '\u032A', '\u032B', '\u032C', '\u032D', '\u032E', '\u032F',
  '\u0330', '\u0331', '\u0332', '\u0333', '\u0339', '\u033A', '\u033B', '\u033C',
  '\u0345', '\u0347', '\u0348', '\u0349', '\u034D', '\u034E', '\u0353', '\u0354',
  '\u0355', '\u0356', '\u0359', '\u035A', '\u035C', '\u035F', '\u0362',
];
const ZALGO_MID = ['\u0334', '\u0335', '\u0336', '\u0337', '\u0338'];

function zalgoify(text: string, intensity = 3): string {
  const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)]!;
  return text.split('').map(ch => {
    if (ch === ' ') return ch;
    let result = ch;
    for (let i = 0; i < intensity; i++) result += pick(ZALGO_UP);
    for (let i = 0; i < intensity; i++) result += pick(ZALGO_DOWN);
    if (Math.random() < 0.5) result += pick(ZALGO_MID);
    return result;
  }).join('');
}

/** Corrupted stat display for The Oracle's dark profile. */
function CorruptedStatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="px-4 py-3 text-center" style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(220,53,69,0.3)' }}>
      <p className="text-xl font-bold" style={{ color: '#dc3545', fontFamily: 'monospace' }}>{zalgoify(String(value), 2)}</p>
      <p className="text-[10px] uppercase tracking-widest font-semibold mt-1" style={{ color: 'rgba(220,53,69,0.5)' }}>
        {zalgoify(label, 1)}
      </p>
    </div>
  );
}

// ── Game history helpers (shared with ProfilePage) ────────────────────

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
  const navigate = useNavigate();
  const isWin = game.finishPosition === 1;
  const is1v1 = game.playerCount === 2;
  return (
    <button
      onClick={() => navigate(`/replay?id=${encodeURIComponent(game.id)}`)}
      className="glass px-4 py-3 flex items-center justify-between gap-3 w-full text-left cursor-pointer bg-transparent border-none transition-colors hover:bg-white/5 active:scale-[0.98] min-h-[44px]"
    >
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
    </button>
  );
}

interface ProfileData extends PublicProfile {
  isBot?: boolean;
  botProfile?: string | null;
}

export function PublicProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const { user: currentUser } = useAuth();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [stats, setStats] = useState<PlayerStatsResponse | null>(null);
  const [ratings, setRatings] = useState<UserRatings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adminViewNormal, setAdminViewNormal] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/users/${userId}/profile`);
      if (!res.ok) {
        setError(res.status === 404 ? 'Player not found' : 'Failed to load profile');
        return;
      }
      const data = await res.json() as ProfileData;
      setProfile(data);

      // Fetch stats and ratings in parallel
      const [statsRes, ratingsRes] = await Promise.all([
        fetch(`${API_BASE}/api/stats/${userId}`).then(r => r.ok ? r.json() as Promise<PlayerStatsResponse> : null).catch(() => null),
        fetch(`${API_BASE}/api/ratings/${userId}`).then(r => r.ok ? r.json() as Promise<UserRatings> : null).catch(() => null),
      ]);
      if (statsRes) setStats(statsRes);
      if (ratingsRes) setRatings(ratingsRes);
    } catch {
      setError('Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center pt-20">
          <div className="w-8 h-8 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  if (error || !profile) {
    return (
      <Layout>
        <div className="flex flex-col items-center pt-12 max-w-sm mx-auto text-center">
          <p className="text-[var(--gold-dim)] mb-4">{error ?? 'Player not found'}</p>
          <Link to="/" className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors">
            Back to Home
          </Link>
        </div>
      </Layout>
    );
  }

  // For bot profiles, get extra info from BOT_PROFILE_MAP
  const botProfile = profile.isBot && profile.botProfile
    ? BOT_PROFILE_MAP.get(profile.botProfile) ?? null
    : null;
  const botInfo = botProfile ? getBotProfileFromName(profile.displayName) : null;
  const isOracle = profile.botProfile === IMPOSSIBLE_BOT.key;
  const isAdmin = currentUser?.role === 'admin';
  const showCorrupted = isOracle && !adminViewNormal;

  const avatarEmoji = profile.isBot
    ? (BOT_AVATAR_MAP.get(profile.displayName) ?? avatarDisplay(profile.avatar, profile.displayName))
    : avatarDisplay(profile.avatar, profile.displayName);
  const isEmoji = profile.isBot || profile.avatar !== null;

  const memberSince = new Date(profile.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
  });

  // ── The Oracle: dark corrupted profile ──────────────────────────────
  if (showCorrupted) {
    return (
      <Layout>
        <div
          className="flex flex-col items-center pt-8 max-w-md mx-auto relative"
          style={{ minHeight: '80vh' }}
        >
          {/* Admin toggle */}
          {isAdmin && (
            <button
              onClick={() => setAdminViewNormal(true)}
              className="absolute top-2 right-2 text-[10px] px-2 py-1 rounded border opacity-60 hover:opacity-100 transition-opacity z-10"
              style={{ borderColor: 'rgba(220,53,69,0.4)', color: '#dc3545', background: 'rgba(0,0,0,0.5)' }}
            >
              Admin: View Normal
            </button>
          )}

          {/* Dark corrupted header */}
          <div className="text-center mb-6">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-3 relative overflow-hidden"
              style={{
                background: 'radial-gradient(circle, rgba(220,53,69,0.2) 0%, rgba(0,0,0,0.8) 70%)',
                border: '2px solid rgba(220,53,69,0.4)',
                boxShadow: '0 0 30px rgba(220,53,69,0.3), inset 0 0 20px rgba(0,0,0,0.5)',
              }}
            >
              <span className="text-4xl" style={{ filter: 'drop-shadow(0 0 8px rgba(220,53,69,0.6))' }}>
                {IMPOSSIBLE_BOT.avatar}
              </span>
            </div>
            <h1
              className="text-2xl font-bold"
              style={{
                color: '#dc3545',
                fontFamily: 'monospace',
                textShadow: '0 0 10px rgba(220,53,69,0.5)',
                lineHeight: '2.5',
              }}
            >
              {zalgoify('The Oracle', 5)}
            </h1>
            <p className="text-xs mt-1" style={{ color: 'rgba(220,53,69,0.6)' }}>
              {zalgoify('Level 10', 3)} &mdash; {zalgoify('IMPOSSIBLE', 4)}
            </p>
            <p className="text-[10px] mt-2 max-w-[280px] mx-auto" style={{ color: 'rgba(220,53,69,0.4)', lineHeight: '2' }}>
              {zalgoify('Perfect play. Cannot be beaten by strategy alone.', 2)}
            </p>
          </div>

          {/* Corrupted ratings */}
          {(ratings?.headsUp || ratings?.multiplayer) && (
            <div className="w-full grid grid-cols-2 gap-3 mb-6">
              {ratings?.headsUp && (
                <div className="px-4 py-3" style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(220,53,69,0.3)' }}>
                  <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: 'rgba(220,53,69,0.5)' }}>
                    {zalgoify('Heads-Up', 2)}
                  </p>
                  <span className="text-xl font-bold" style={{ color: '#dc3545', fontFamily: 'monospace' }}>
                    {zalgoify(String(ratings.headsUp.elo), 3)}
                  </span>
                  <p className="text-[10px] mt-1" style={{ color: 'rgba(220,53,69,0.3)' }}>
                    {zalgoify(`${ratings.headsUp.gamesPlayed} games`, 1)}
                  </p>
                </div>
              )}
              {ratings?.multiplayer && (() => {
                const displayRating = openSkillDisplayRating(ratings.multiplayer.mu);
                return (
                  <div className="px-4 py-3" style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(220,53,69,0.3)' }}>
                    <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: 'rgba(220,53,69,0.5)' }}>
                      {zalgoify('Multiplayer', 2)}
                    </p>
                    <span className="text-xl font-bold" style={{ color: '#dc3545', fontFamily: 'monospace' }}>
                      {zalgoify(String(displayRating), 3)}
                    </span>
                    <p className="text-[10px] mt-1" style={{ color: 'rgba(220,53,69,0.3)' }}>
                      {zalgoify(`${ratings.multiplayer.gamesPlayed} games`, 1)}
                    </p>
                  </div>
                );
              })()}
              {!ratings?.headsUp && <div />}
              {!ratings?.multiplayer && <div />}
            </div>
          )}

          {/* Corrupted stats */}
          {stats && stats.gamesPlayed > 0 ? (
            <div className="w-full grid grid-cols-2 gap-3 mb-6">
              <CorruptedStatCard label="Games Played" value={stats.gamesPlayed} />
              <CorruptedStatCard label="Wins" value={stats.wins} />
              <CorruptedStatCard
                label="Win Rate"
                value={stats.winRate !== null ? `${stats.winRate}%` : '\u2014'}
              />
              <CorruptedStatCard
                label="Bull Accuracy"
                value={stats.bullAccuracy !== null ? `${stats.bullAccuracy}%` : '\u2014'}
              />
            </div>
          ) : (
            <div className="w-full px-4 py-6 text-center mb-6" style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(220,53,69,0.3)' }}>
              <p className="text-sm" style={{ color: 'rgba(220,53,69,0.4)' }}>{zalgoify('No data found', 3)}</p>
            </div>
          )}

          {/* Corrupted quotes */}
          <div className="w-full px-4 py-3 mb-6" style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(220,53,69,0.2)' }}>
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: 'rgba(220,53,69,0.4)' }}>
              {zalgoify('Transmissions', 2)}
            </p>
            <div className="space-y-2">
              <p className="text-xs" style={{ color: 'rgba(220,53,69,0.5)', fontFamily: 'monospace', lineHeight: '1.8' }}>
                &ldquo;{zalgoify('I see everything', 4)}&rdquo;
              </p>
              <p className="text-xs" style={{ color: 'rgba(220,53,69,0.5)', fontFamily: 'monospace', lineHeight: '1.8' }}>
                &ldquo;{zalgoify('Your cards betray you', 4)}&rdquo;
              </p>
              <p className="text-xs" style={{ color: 'rgba(220,53,69,0.5)', fontFamily: 'monospace', lineHeight: '1.8' }}>
                &ldquo;{zalgoify('Inevitable', 4)}&rdquo;
              </p>
            </div>
          </div>

          {/* Back link */}
          <Link
            to="/"
            className="text-sm transition-colors"
            style={{ color: 'rgba(220,53,69,0.5)' }}
          >
            {zalgoify('Back to Home', 1)}
          </Link>

          {/* Ambient floating Zalgo decorations */}
          <div
            className="absolute inset-0 pointer-events-none overflow-hidden select-none"
            aria-hidden="true"
            style={{ opacity: 0.08 }}
          >
            <div className="absolute top-[10%] left-[5%] text-2xl" style={{ color: '#dc3545', transform: 'rotate(-15deg)' }}>
              {zalgoify('\u0D9E\u0DA5\u0DB1', 6)}
            </div>
            <div className="absolute top-[30%] right-[8%] text-xl" style={{ color: '#dc3545', transform: 'rotate(10deg)' }}>
              {zalgoify('\u0621\u0639\u0645\u0649', 6)}
            </div>
            <div className="absolute top-[55%] left-[10%] text-lg" style={{ color: '#dc3545', transform: 'rotate(-5deg)' }}>
              {zalgoify('\u4E16\u754C\u5929', 6)}
            </div>
            <div className="absolute top-[75%] right-[15%] text-2xl" style={{ color: '#dc3545', transform: 'rotate(20deg)' }}>
              {zalgoify('\u0E17\u0E33\u0E44\u0E21', 6)}
            </div>
            <div className="absolute top-[45%] left-[50%] text-sm" style={{ color: '#dc3545', transform: 'rotate(-30deg)' }}>
              {zalgoify('01101001', 5)}
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // ── Normal profile rendering ────────────────────────────────────────
  return (
    <Layout>
      <div className="flex flex-col items-center pt-8 max-w-md mx-auto">
        {/* Admin toggle to switch back to corrupted view for Oracle */}
        {isOracle && isAdmin && adminViewNormal && (
          <button
            onClick={() => setAdminViewNormal(false)}
            className="self-end text-[10px] px-2 py-1 rounded border mb-2 opacity-60 hover:opacity-100 transition-opacity"
            style={{ borderColor: 'rgba(220,53,69,0.4)', color: '#dc3545', background: 'rgba(0,0,0,0.3)' }}
          >
            Admin: View Corrupted
          </button>
        )}

        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-[var(--gold)]/20 border-2 border-[var(--gold)] flex items-center justify-center mx-auto mb-3 overflow-hidden">
            {profile.photoUrl ? (
              <img src={profile.photoUrl} alt={profile.displayName} className="w-full h-full object-cover" />
            ) : (
              <span className={isEmoji ? 'text-2xl' : 'text-2xl font-bold text-[var(--gold)]'}>
                {avatarEmoji}
              </span>
            )}
          </div>
          <h1
            className="text-2xl font-bold text-[var(--gold)]"
            style={{ fontFamily: "'Cormorant Garamond', serif" }}
          >
            {profile.displayName}
          </h1>
          {profile.isBot && botInfo && (
            <>
              <p className="text-xs text-[var(--gold-dim)] mt-1">Level {botInfo.level} Bot</p>
              <p className="text-[10px] text-[var(--gold-dim)] mt-0.5 max-w-[280px] mx-auto">
                {botInfo.personality}
              </p>
            </>
          )}
          {!profile.isBot && (
            <>
              <p className="text-xs text-[var(--gold-dim)] mt-1">@{profile.username}</p>
              <p className="text-[10px] text-[var(--gold-dim)] mt-0.5">Member since {memberSince}</p>
            </>
          )}
        </div>

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
            {!ratings.headsUp && <div />}
            {!ratings.multiplayer && <div />}
          </div>
        )}

        {/* Stats Grid */}
        {stats && stats.gamesPlayed > 0 ? (
          isAdmin ? (
            /* Admin sees full stats — same as the player's own profile */
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
              <div className="w-full grid grid-cols-2 gap-3 mb-6">
                <StatCard
                  label="Bluff Success"
                  value={stats.bluffSuccessRate !== null ? `${stats.bluffSuccessRate}%` : '\u2014'}
                />
                <StatCard label="Ranked Games" value={stats.rankedGamesPlayed} />
              </div>

              {/* Games by Player Count */}
              {(() => {
                const playerCountEntries = Object.entries(stats.gamesByPlayerCount)
                  .sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10));
                return playerCountEntries.length > 0 ? (
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
                ) : null;
              })()}
            </>
          ) : (
            /* Non-admin sees limited stats */
            <div className="w-full grid grid-cols-2 gap-3 mb-6">
              <StatCard label="Games Played" value={stats.gamesPlayed} />
              <StatCard label="Wins" value={stats.wins} />
              <StatCard
                label="Win Rate"
                value={stats.winRate !== null ? `${stats.winRate}%` : '\u2014'}
              />
              <StatCard
                label="Bull Accuracy"
                value={stats.bullAccuracy !== null ? `${stats.bullAccuracy}%` : '\u2014'}
              />
              <StatCard label="Ranked Games" value={stats.rankedGamesPlayed} />
            </div>
          )
        ) : (
          <div className="w-full glass px-4 py-6 text-center mb-6">
            <p className="text-[var(--gold-dim)] text-sm">No games played yet</p>
          </div>
        )}

        {/* Recent Games — admin only */}
        {isAdmin && stats && stats.recentGames.length > 0 && (
          <div className="w-full mb-6">
            <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-3 px-1">
              Recent Games ({stats.recentGames.length})
            </p>
            <div className="flex flex-col gap-2">
              {stats.recentGames.map(game => (
                <GameHistoryItem key={`${game.id}-${game.endedAt}`} game={game} />
              ))}
            </div>
          </div>
        )}

        {/* Advanced Stats — admin only */}
        {isAdmin && userId && <AdvancedStats userId={userId} />}

        {/* Bot flavor text */}
        {profile.isBot && botProfile && (
          <div className="w-full glass px-4 py-3 mb-6">
            <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
              Personality
            </p>
            <div className="space-y-1.5">
              <p className="text-xs text-[var(--gold-dim)]">
                <span className="text-[var(--gold)]">Calls bull:</span> &ldquo;{botProfile.flavorText.callBull[0]}&rdquo;
              </p>
              <p className="text-xs text-[var(--gold-dim)]">
                <span className="text-[var(--gold)]">Big raise:</span> &ldquo;{botProfile.flavorText.bigRaise[0]}&rdquo;
              </p>
              <p className="text-xs text-[var(--gold-dim)]">
                <span className="text-[var(--gold)]">Wins:</span> &ldquo;{botProfile.flavorText.winRound[0]}&rdquo;
              </p>
            </div>
          </div>
        )}

        {/* Back link */}
        <Link
          to="/"
          className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors"
        >
          Back to Home
        </Link>
      </div>
    </Layout>
  );
}

export default PublicProfilePage;
