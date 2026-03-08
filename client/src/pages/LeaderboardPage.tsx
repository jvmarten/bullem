import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { useAuth } from '../context/AuthContext.js';
import { RankBadge } from '../components/RankBadge.js';
import { avatarDisplay } from './ProfilePage.js';
import type { RankedMode, LeaderboardPeriod, LeaderboardResponse, LeaderboardEntry, LeaderboardPlayerFilter } from '@bull-em/shared';

// Vite proxies /auth and /api to the server in dev — relative URLs work from any device.
const API_BASE = '';

const PAGE_SIZE = 50;

// ── Skeleton loader ─────────────────────────────────────────────────────

function SkeletonRow({ index }: { index: number }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3"
      style={{
        borderBottom: '1px solid rgba(212,168,67,0.08)',
        animationDelay: `${index * 50}ms`,
      }}
    >
      <div className="w-8 text-center">
        <div className="h-4 w-6 rounded bg-[var(--gold-dim)] opacity-20 animate-pulse mx-auto" />
      </div>
      <div className="w-8 h-8 rounded-full bg-[var(--gold-dim)] opacity-20 animate-pulse" />
      <div className="flex-1">
        <div className="h-4 w-24 rounded bg-[var(--gold-dim)] opacity-20 animate-pulse" />
      </div>
      <div className="w-16 text-right">
        <div className="h-4 w-10 rounded bg-[var(--gold-dim)] opacity-20 animate-pulse ml-auto" />
      </div>
      <div className="w-12 text-right">
        <div className="h-3 w-8 rounded bg-[var(--gold-dim)] opacity-20 animate-pulse ml-auto" />
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="glass rounded-xl overflow-hidden">
      {Array.from({ length: 10 }, (_, i) => (
        <SkeletonRow key={i} index={i} />
      ))}
    </div>
  );
}

// ── Rank medal styling ──────────────────────────────────────────────────

function RankNumber({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span className="text-sm font-bold" style={{ color: '#ffd700', textShadow: '0 0 6px rgba(255,215,0,0.4)' }}>
        #1
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="text-sm font-bold" style={{ color: '#c0c0c0', textShadow: '0 0 4px rgba(192,192,192,0.3)' }}>
        #2
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="text-sm font-bold" style={{ color: '#cd7f32', textShadow: '0 0 4px rgba(205,127,50,0.3)' }}>
        #3
      </span>
    );
  }
  return <span className="text-sm text-[var(--gold-dim)]">#{rank}</span>;
}

// ── Main component ──────────────────────────────────────────────────────

export function LeaderboardPage() {
  const { user } = useAuth();
  const [mode, setMode] = useState<RankedMode>('heads_up');
  const [period, setPeriod] = useState<LeaderboardPeriod>('all_time');
  const [playerFilter, setPlayerFilter] = useState<LeaderboardPlayerFilter>('all');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const fetchLeaderboard = useCallback(async (m: RankedMode, p: LeaderboardPeriod, o: number, pf: LeaderboardPlayerFilter) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        period: p,
        limit: String(PAGE_SIZE),
        offset: String(o),
        playerFilter: pf,
      });
      const res = await fetch(`${API_BASE}/api/leaderboard/${m}?${params}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const result = await res.json() as LeaderboardResponse;
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLeaderboard(mode, period, offset, playerFilter);
  }, [mode, period, offset, playerFilter, fetchLeaderboard]);

  const handleModeChange = (newMode: RankedMode) => {
    setMode(newMode);
    setOffset(0);
  };

  const handlePeriodChange = (newPeriod: LeaderboardPeriod) => {
    setPeriod(newPeriod);
    setOffset(0);
  };

  const handlePlayerFilterChange = (newFilter: LeaderboardPlayerFilter) => {
    setPlayerFilter(newFilter);
    setOffset(0);
  };

  const totalPages = data ? Math.ceil(data.totalCount / PAGE_SIZE) : 0;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <Layout>
      <div className="flex flex-col items-center gap-4 pt-6 pb-8 px-4 max-w-lg mx-auto w-full">
        <h1 className="text-2xl font-bold text-[var(--gold)] font-display">Leaderboard</h1>

        {/* Mode tabs */}
        <div className="flex w-full rounded-lg overflow-hidden border border-[var(--gold-dim)]" style={{ borderColor: 'rgba(212,168,67,0.3)' }}>
          <button
            onClick={() => handleModeChange('heads_up')}
            className={`flex-1 py-3 text-sm font-semibold transition-colors ${
              mode === 'heads_up'
                ? 'bg-[var(--gold)] text-[#1a1a1a]'
                : 'bg-transparent text-[var(--gold-dim)] hover:text-[var(--gold)]'
            }`}
          >
            Heads-Up (1v1)
          </button>
          <button
            onClick={() => handleModeChange('multiplayer')}
            className={`flex-1 py-3 text-sm font-semibold transition-colors ${
              mode === 'multiplayer'
                ? 'bg-[var(--gold)] text-[#1a1a1a]'
                : 'bg-transparent text-[var(--gold-dim)] hover:text-[var(--gold)]'
            }`}
          >
            Multiplayer
          </button>
        </div>

        {/* Period filter pills */}
        <div className="flex gap-2 w-full justify-center">
          {([
            ['all_time', 'All Time'],
            ['month', 'This Month'],
            ['week', 'This Week'],
          ] as const).map(([p, label]) => (
            <button
              key={p}
              onClick={() => handlePeriodChange(p)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                period === p
                  ? 'bg-[var(--gold)] text-[#1a1a1a]'
                  : 'glass text-[var(--gold-dim)] hover:text-[var(--gold)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Player type filter */}
        <div className="flex gap-2 w-full justify-center">
          {([
            ['all', 'All'],
            ['players', 'Players Only'],
            ['bots', 'Bots Only'],
          ] as const).map(([f, label]) => (
            <button
              key={f}
              onClick={() => handlePlayerFilterChange(f)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                playerFilter === f
                  ? 'bg-[var(--gold)] text-[#1a1a1a]'
                  : 'glass text-[var(--gold-dim)] hover:text-[var(--gold)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Current user rank card */}
        {data?.currentUser && (
          <div
            className="glass w-full px-4 py-3 rounded-xl flex items-center gap-3"
            style={{ borderColor: 'rgba(212,168,67,0.3)', borderWidth: '1px' }}
          >
            <div className="text-xs text-[var(--gold-dim)] uppercase tracking-widest font-semibold shrink-0">
              Your Rank
            </div>
            <div className="flex-1 flex items-center justify-end gap-3">
              <RankBadge rating={data.currentUser.rating} tier={data.currentUser.tier} showRating size="md" />
              <span className="text-lg font-bold text-[var(--gold)]">
                #{data.currentUser.rank}
              </span>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="glass w-full px-4 py-6 text-center rounded-xl">
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={() => fetchLeaderboard(mode, period, offset, playerFilter)}
              className="mt-2 text-xs text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !error && <LoadingSkeleton />}

        {/* Leaderboard table */}
        {!loading && !error && data && (
          <>
            {data.entries.length === 0 ? (
              <div className="glass w-full px-4 py-8 text-center rounded-xl">
                <p className="text-[var(--gold-dim)] text-sm">
                  No players ranked yet. Play 5+ ranked games to appear here.
                </p>
              </div>
            ) : (
              <div className="glass rounded-xl overflow-hidden w-full">
                {/* Header */}
                <div
                  className="flex items-center gap-3 px-4 py-2 text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold"
                  style={{ borderBottom: '1px solid rgba(212,168,67,0.15)' }}
                >
                  <div className="w-8 text-center">#</div>
                  <div className="w-8" />
                  <div className="flex-1">Player</div>
                  <div className="w-16 text-right">Rating</div>
                  <div className="w-12 text-right">Games</div>
                </div>

                {/* Rows */}
                {data.entries.map((entry) => (
                  <LeaderboardRow
                    key={entry.userId}
                    entry={entry}
                    isCurrentUser={entry.userId === user?.id}
                  />
                ))}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={offset === 0}
                  className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-30"
                >
                  Prev
                </button>
                <span className="text-xs text-[var(--gold-dim)]">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={currentPage >= totalPages}
                  className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

// ── Row component ───────────────────────────────────────────────────────

function LeaderboardRow({ entry, isCurrentUser }: { entry: LeaderboardEntry; isCurrentUser: boolean }) {
  const navigate = useNavigate();
  const bgStyle = isCurrentUser
    ? { background: 'rgba(212,168,67,0.08)', borderLeft: '3px solid var(--gold)' }
    : {};

  return (
    <button
      onClick={() => navigate(`/profile/${entry.userId}`)}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/5 w-full text-left cursor-pointer bg-transparent border-none active:scale-[0.99] min-h-[44px]"
      style={{
        borderBottom: '1px solid rgba(212,168,67,0.06)',
        ...bgStyle,
      }}
    >
      {/* Rank */}
      <div className="w-8 text-center">
        <RankNumber rank={entry.rank} />
      </div>

      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0"
        style={{
          background: 'rgba(212,168,67,0.12)',
          border: '1px solid rgba(212,168,67,0.2)',
        }}
      >
        {avatarDisplay(entry.avatar, entry.displayName)}
      </div>

      {/* Name + tier + bot badge */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {entry.isBot && (
            <span
              className="text-[10px] shrink-0"
              title="Bot"
              style={{ opacity: 0.6 }}
            >
              &#9881;
            </span>
          )}
          <span
            className={`text-sm truncate ${isCurrentUser ? 'font-bold text-[var(--gold)]' : 'text-[#e8e0d4]'}`}
          >
            {entry.displayName}
          </span>
          <RankBadge rating={entry.rating} tier={entry.tier} />
        </div>
      </div>

      {/* Rating */}
      <div className="w-16 text-right">
        <span className="text-sm font-semibold text-[var(--gold)]">{entry.rating}</span>
      </div>

      {/* Games played */}
      <div className="w-12 text-right">
        <span className="text-xs text-[var(--gold-dim)]">{entry.gamesPlayed}</span>
      </div>
    </button>
  );
}
