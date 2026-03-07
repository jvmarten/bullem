import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { BOT_PROFILE_MAP, BOT_AVATAR_MAP, openSkillDisplayRating } from '@bull-em/shared';
import type { PlayerStatsResponse, UserRatings, PublicProfile } from '@bull-em/shared';
import { RankBadge } from '../components/RankBadge.js';
import { avatarDisplay } from './ProfilePage.js';

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

interface ProfileData extends PublicProfile {
  isBot?: boolean;
  botProfile?: string | null;
}

export function PublicProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [stats, setStats] = useState<PlayerStatsResponse | null>(null);
  const [ratings, setRatings] = useState<UserRatings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const avatarEmoji = profile.isBot
    ? (BOT_AVATAR_MAP.get(profile.displayName) ?? avatarDisplay(profile.avatar, profile.displayName))
    : avatarDisplay(profile.avatar, profile.displayName);
  const isEmoji = profile.isBot || profile.avatar !== null;

  const memberSince = new Date(profile.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
  });

  return (
    <Layout>
      <div className="flex flex-col items-center pt-8 max-w-md mx-auto">
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
          </div>
        ) : (
          <div className="w-full glass px-4 py-6 text-center mb-6">
            <p className="text-[var(--gold-dim)] text-sm">No games played yet</p>
          </div>
        )}

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
