import { useNavigate } from 'react-router-dom';
import type { RivalryRecord } from '@bull-em/shared';
import { PlayerAvatarContent } from '../PlayerAvatar.js';

interface Props {
  rivalries: RivalryRecord[];
}

/** Format seconds into a human-readable duration. */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

/** Streak badge with color/label. */
function StreakBadge({ streak }: { streak: number }) {
  if (streak === 0) return null;

  const isWin = streak > 0;
  const count = Math.abs(streak);

  return (
    <span
      className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
      style={{
        background: isWin ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
        color: isWin ? '#22c55e' : '#ef4444',
      }}
    >
      {count}{isWin ? 'W' : 'L'} streak
    </span>
  );
}

/**
 * Rich rivalry stats showing head-to-head data with frequent opponents.
 * Includes recent form indicators, win streaks, and avg game duration.
 */
export function RivalryStats({ rivalries }: Props) {
  const navigate = useNavigate();

  if (rivalries.length === 0) return null;

  return (
    <div className="w-full mb-6">
      <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-3 px-1">
        Rivalries
      </p>
      <div className="flex flex-col gap-2">
        {rivalries.map(rival => {
          const winRate = rival.gamesPlayed > 0
            ? Math.round((rival.wins / rival.gamesPlayed) * 100)
            : 0;

          return (
            <button
              key={rival.opponentId}
              onClick={() => navigate(`/u/${encodeURIComponent(rival.opponentUsername)}`)}
              className="glass px-4 py-3 w-full text-left cursor-pointer bg-transparent border-none transition-colors hover:bg-white/5 active:scale-[0.98]"
            >
              {/* Top row: avatar, name, W-L */}
              <div className="flex items-center gap-3 mb-2">
                <div className="relative w-10 h-10 rounded-full bg-[var(--gold)]/10 border border-white/10 flex items-center justify-center text-base shrink-0 overflow-hidden">
                  <PlayerAvatarContent name={rival.opponentName} avatar={rival.opponentAvatar} photoUrl={rival.opponentPhotoUrl} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--gold)] font-semibold truncate">{rival.opponentName}</p>
                  <p className="text-[10px] text-[var(--gold-dim)]">
                    {rival.gamesPlayed} games &middot; avg {formatDuration(rival.avgDurationSeconds)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-[var(--gold)]">
                    {rival.wins}W - {rival.losses}L
                  </p>
                  <p className="text-[10px]" style={{ color: winRate >= 50 ? '#22c55e' : '#ef4444' }}>
                    {winRate}% win rate
                  </p>
                </div>
              </div>

              {/* Win rate bar */}
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${winRate}%`,
                    background: winRate >= 50
                      ? 'linear-gradient(90deg, #22c55e, #4ade80)'
                      : 'linear-gradient(90deg, #ef4444, #f87171)',
                  }}
                />
              </div>

              {/* Bottom row: recent form + streak */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-0.5">
                  {rival.recentForm.map((result, i) => (
                    <span
                      key={i}
                      className="inline-block w-4 h-4 rounded-sm text-[8px] font-bold flex items-center justify-center"
                      style={{
                        background: result === 'W' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
                        color: result === 'W' ? '#22c55e' : '#ef4444',
                      }}
                    >
                      {result}
                    </span>
                  ))}
                  {rival.recentForm.length > 0 && (
                    <span className="text-[8px] text-[var(--gold-dim)] ml-1">recent</span>
                  )}
                </div>
                <StreakBadge streak={rival.currentStreak} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
