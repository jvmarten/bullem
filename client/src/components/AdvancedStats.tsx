import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { HandType } from '@bull-em/shared';
import type {
  AdvancedStatsResponse,
  HandTypeBreakdown,
  RatingHistoryEntry,
  PerformanceByPlayerCount,
  TodaySession,
  OpponentRecord,
} from '@bull-em/shared';
import { avatarDisplay } from '../pages/ProfilePage.js';

// Vite proxies /auth and /api to the server in dev — relative URLs work from any device.
const API_BASE = '';

const HAND_TYPE_LABELS: Record<number, string> = {
  [HandType.HIGH_CARD]: 'High Card',
  [HandType.PAIR]: 'Pair',
  [HandType.TWO_PAIR]: 'Two Pair',
  [HandType.FLUSH]: 'Flush',
  [HandType.THREE_OF_A_KIND]: 'Three of a Kind',
  [HandType.STRAIGHT]: 'Straight',
  [HandType.FULL_HOUSE]: 'Full House',
  [HandType.FOUR_OF_A_KIND]: 'Four of a Kind',
  [HandType.STRAIGHT_FLUSH]: 'Straight Flush',
  [HandType.ROYAL_FLUSH]: 'Royal Flush',
};

/** Color for accuracy percentage bars. */
function accuracyColor(pct: number): string {
  if (pct >= 70) return 'var(--gold)';
  if (pct >= 40) return '#c0a050';
  return '#885533';
}

// ── Rating History Chart ────────────────────────────────────────────────

function RatingHistoryChart({ entries }: { entries: RatingHistoryEntry[] }) {
  const modes = [...new Set(entries.map(e => e.mode))];
  const [activeMode, setActiveMode] = useState<string>(modes[0] ?? 'heads_up');

  const filtered = entries.filter(e => e.mode === activeMode);
  const chartData = filtered.map((e, i) => ({
    index: i + 1,
    rating: e.ratingAfter,
    delta: e.delta,
  }));

  if (chartData.length === 0) return null;

  return (
    <div className="w-full mb-6">
      <div className="flex items-center justify-between mb-3 px-1">
        <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold">
          Rating History
        </p>
        {modes.length > 1 && (
          <div className="flex gap-1">
            {modes.map(mode => (
              <button
                key={mode}
                onClick={() => setActiveMode(mode)}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                  activeMode === mode
                    ? 'bg-[var(--gold)] text-black font-semibold'
                    : 'text-[var(--gold-dim)] hover:text-[var(--gold)]'
                }`}
              >
                {mode === 'heads_up' ? '1v1' : 'Multi'}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="glass px-2 py-3" style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <XAxis dataKey="index" hide />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fill: '#8b7340', fontSize: 10 }}
              width={35}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: '#1a1410',
                border: '1px solid rgba(212,175,55,0.3)',
                borderRadius: 8,
                fontSize: 12,
                color: '#d4af37',
              }}
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const data = payload[0].payload as { index: number; rating: number; delta: number };
                const sign = data.delta >= 0 ? '+' : '';
                return (
                  <div style={{
                    background: '#1a1410',
                    border: '1px solid rgba(212,175,55,0.3)',
                    borderRadius: 8,
                    padding: '6px 10px',
                    fontSize: 12,
                    color: '#d4af37',
                  }}>
                    <p>Game {data.index}</p>
                    <p>Rating: {data.rating} ({sign}{data.delta})</p>
                  </div>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey="rating"
              stroke="#d4af37"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: '#d4af37' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Hand Type Breakdown ─────────────────────────────────────────────────

function HandBreakdownSection({ breakdown }: { breakdown: HandTypeBreakdown[] }) {
  if (breakdown.length === 0) return null;

  const maxCalled = Math.max(...breakdown.map(b => b.timesCalled), 1);

  return (
    <div className="w-full mb-6">
      <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-3 px-1">
        Hand Type Breakdown
      </p>
      <div className="glass px-4 py-3">
        <div className="flex flex-col gap-2">
          {breakdown.map(b => {
            const accuracy = b.timesCalled > 0
              ? Math.round((b.timesExisted / b.timesCalled) * 100)
              : 0;
            const barWidth = (b.timesCalled / maxCalled) * 100;

            return (
              <div key={b.handType} className="flex items-center gap-2">
                <div className="w-24 shrink-0 text-[10px] text-[var(--gold-dim)] truncate">
                  {HAND_TYPE_LABELS[b.handType] ?? `Type ${b.handType}`}
                </div>
                <div className="flex-1 h-4 bg-white/5 rounded-sm overflow-hidden relative">
                  <div
                    className="h-full rounded-sm transition-all"
                    style={{
                      width: `${barWidth}%`,
                      backgroundColor: accuracyColor(accuracy),
                      opacity: 0.7,
                    }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] text-white/80 font-medium">
                    {b.timesCalled}x ({accuracy}% existed)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Performance by Player Count ─────────────────────────────────────────

function PerformanceSection({ data }: { data: PerformanceByPlayerCount[] }) {
  if (data.length === 0) return null;

  return (
    <div className="w-full mb-6">
      <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-3 px-1">
        Performance by Player Count
      </p>
      <div className="grid grid-cols-2 gap-2">
        {data.map(d => (
          <div key={d.playerCount} className="glass px-3 py-2">
            <p className="text-xs text-[var(--gold-dim)] font-semibold">{d.playerCount} Players</p>
            <p className="text-lg font-bold text-[var(--gold)]">{d.winRate}%</p>
            <p className="text-[10px] text-[var(--gold-dim)]">
              {d.wins}W / {d.gamesPlayed}G &middot; Avg {d.avgFinish}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Today's Session ─────────────────────────────────────────────────────

function TodaySessionCard({ session }: { session: TodaySession }) {
  const isPositive = session.netRatingChange >= 0;

  return (
    <div className="w-full mb-6">
      <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-3 px-1">
        Today&apos;s Session
      </p>
      <div
        className="glass px-4 py-3 border"
        style={{
          borderColor: isPositive ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
          background: isPositive
            ? 'linear-gradient(135deg, rgba(34,197,94,0.05), transparent)'
            : 'linear-gradient(135deg, rgba(239,68,68,0.05), transparent)',
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-[var(--gold)]">
            {session.gamesPlayed} game{session.gamesPlayed !== 1 ? 's' : ''} today
          </span>
          {session.netRatingChange !== 0 && (
            <span
              className="text-sm font-bold"
              style={{ color: isPositive ? '#22c55e' : '#ef4444' }}
            >
              {isPositive ? '+' : ''}{session.netRatingChange}
            </span>
          )}
        </div>
        <div className="flex gap-4 text-[10px] text-[var(--gold-dim)]">
          <span>{session.wins} win{session.wins !== 1 ? 's' : ''}</span>
          {session.bullAccuracy !== null && (
            <span>Bull accuracy: {session.bullAccuracy}%</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Opponent Records ────────────────────────────────────────────────────

function OpponentRecordsSection({ records }: { records: OpponentRecord[] }) {
  const navigate = useNavigate();
  if (records.length === 0) return null;

  return (
    <div className="w-full mb-6">
      <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-3 px-1">
        Most Played Opponents
      </p>
      <div className="flex flex-col gap-2">
        {records.map(r => (
          <button
            key={r.opponentId}
            onClick={() => navigate(`/profile/${r.opponentId}`)}
            className="glass px-4 py-2.5 flex items-center gap-3 w-full text-left cursor-pointer bg-transparent border-none transition-colors hover:bg-white/5 active:scale-[0.98] min-h-[44px]"
          >
            <div className="w-8 h-8 rounded-full bg-[var(--gold)]/10 border border-white/10 flex items-center justify-center text-sm shrink-0">
              {avatarDisplay(r.opponentAvatar, r.opponentName)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[var(--gold)] truncate">{r.opponentName}</p>
              <p className="text-[10px] text-[var(--gold-dim)]">{r.gamesPlayed} games</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold text-[var(--gold)]">
                {r.wins}W - {r.losses}L
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────

function AdvancedStatsSkeleton() {
  return (
    <div className="w-full animate-pulse">
      <div className="glass px-4 py-3 mb-6">
        <div className="h-4 w-28 bg-[var(--gold)]/10 rounded mb-3" />
        <div className="h-[160px] bg-[var(--gold)]/5 rounded" />
      </div>
      <div className="glass px-4 py-3 mb-6">
        <div className="h-4 w-32 bg-[var(--gold)]/10 rounded mb-3" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-4 bg-[var(--gold)]/5 rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function AdvancedStats({ userId }: { userId: string }) {
  const [stats, setStats] = useState<AdvancedStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchAdvancedStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/stats/${userId}/advanced`, {
        credentials: 'include',
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      const data = await res.json() as AdvancedStatsResponse;
      setStats(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchAdvancedStats();
  }, [fetchAdvancedStats]);

  if (loading) return <AdvancedStatsSkeleton />;
  if (error || !stats) return null;

  // Don't render section if there's no data at all
  const hasData = stats.ratingHistory.length > 0
    || stats.handBreakdown.length > 0
    || stats.performanceByPlayerCount.length > 0
    || stats.todaySession !== null
    || stats.opponentRecords.length > 0;

  if (!hasData) return null;

  return (
    <>
      {stats.todaySession && <TodaySessionCard session={stats.todaySession} />}
      {stats.ratingHistory.length > 0 && <RatingHistoryChart entries={stats.ratingHistory} />}
      {stats.handBreakdown.length > 0 && <HandBreakdownSection breakdown={stats.handBreakdown} />}
      {stats.performanceByPlayerCount.length > 0 && (
        <PerformanceSection data={stats.performanceByPlayerCount} />
      )}
      {stats.opponentRecords.length > 0 && <OpponentRecordsSection records={stats.opponentRecords} />}
    </>
  );
}
