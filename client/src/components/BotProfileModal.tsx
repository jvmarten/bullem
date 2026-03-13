import { useState, useEffect } from 'react';
import type { Player, InGamePlayerStats, PlayerStatsResponse, UserRatings } from '@bull-em/shared';
import { BOT_NAME_TO_USER_ID, openSkillDisplayRating } from '@bull-em/shared';
import { playerColor } from '../utils/cardUtils.js';
import { PlayerAvatarContent } from './PlayerAvatar.js';
import { RankBadge } from './RankBadge.js';
import { useFocusTrap } from '../hooks/useFocusTrap.js';

interface Props {
  player: Player;
  playerIndex: number;
  stats: InGamePlayerStats | null;
  onClose: () => void;
}

export function BotProfileModal({ player, playerIndex, stats, onClose }: Props) {
  const focusTrapRef = useFocusTrap<HTMLDivElement>(true, onClose);

  // Resolve userId: use player.userId if set, otherwise look up by bot name
  const resolvedUserId = player.userId
    ?? (player.isBot ? BOT_NAME_TO_USER_ID.get(player.name) : undefined);

  // Fetch all-time stats for any player with a userId
  const [allTimeStats, setAllTimeStats] = useState<PlayerStatsResponse | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // Fetch ratings
  const [ratings, setRatings] = useState<UserRatings | null>(null);

  useEffect(() => {
    if (!resolvedUserId) return;
    setLoadingStats(true);

    const statsPromise = fetch(`/api/stats/${resolvedUserId}`, { credentials: 'include' })
      .then(res => res.ok ? res.json() as Promise<PlayerStatsResponse> : null)
      .catch(() => null);

    const ratingsPromise = fetch(`/api/ratings/${resolvedUserId}`, { credentials: 'include' })
      .then(res => res.ok ? res.json() as Promise<UserRatings> : null)
      .catch(() => null);

    Promise.all([statsPromise, ratingsPromise])
      .then(([statsData, ratingsData]) => {
        setAllTimeStats(statsData ?? null);
        setRatings(ratingsData ?? null);
      })
      .finally(() => setLoadingStats(false));
  }, [resolvedUserId]);

  const hasUserId = !!resolvedUserId;

  // Match stats derived values
  const bullAcc = stats && stats.bullsCalled > 0
    ? Math.round((stats.correctBulls / stats.bullsCalled) * 100)
    : null;
  const trueAcc = stats && stats.truesCalled > 0
    ? Math.round((stats.correctTrues / stats.truesCalled) * 100)
    : null;
  const bluffRate = stats && stats.callsMade > 0
    ? Math.round((stats.bluffsSuccessful / stats.callsMade) * 100)
    : null;

  // Rating display values
  const headsUpRating = ratings?.headsUp?.elo ?? null;
  const multiRating = ratings?.multiplayer
    ? openSkillDisplayRating(ratings.multiplayer.mu)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose} role="presentation">
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-profile-title"
        className="glass p-6 rounded-xl max-w-xs w-full space-y-4 animate-scale-in"
        onClick={e => e.stopPropagation()}
        style={{ maxHeight: '85vh', overflowY: 'auto' }}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="text-center">
          <div className={`relative w-16 h-16 rounded-full ${playerColor(playerIndex, player.avatarBgColor)} flex items-center justify-center mx-auto mb-3 text-3xl overflow-hidden`}>
            <PlayerAvatarContent name={player.name} avatar={player.avatar} photoUrl={player.photoUrl} isBot={player.isBot} />
          </div>
          <h3 id="player-profile-title" className="text-xl font-bold text-[var(--gold)]" style={{ fontFamily: "'Cormorant Garamond', serif" }}>
            {player.name}
          </h3>
          <p className="text-xs mt-1 text-[var(--gold-dim)]">
            {player.isBot ? 'Bot' : 'Player'}
            {player.isEliminated && ' — Eliminated'}
          </p>
        </div>

        {/* Ratings */}
        {hasUserId && (
          loadingStats ? null : (headsUpRating !== null || multiRating !== null) ? (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
                Ratings
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="glass p-2 text-center">
                  {headsUpRating !== null ? (
                    <>
                      <p className="text-sm font-bold text-[#e8e0d4] flex items-center justify-center gap-1">
                        <RankBadge rating={headsUpRating} showRating size="sm" />
                      </p>
                      <p className="text-[10px] text-[var(--gold-dim)]">1v1</p>
                      {ratings?.headsUp && (
                        <p className="text-[9px] text-[var(--gold-dim)]">{ratings.headsUp.gamesPlayed} games</p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-bold text-[#e8e0d4]">—</p>
                      <p className="text-[10px] text-[var(--gold-dim)]">1v1</p>
                    </>
                  )}
                </div>
                <div className="glass p-2 text-center">
                  {multiRating !== null ? (
                    <>
                      <p className="text-sm font-bold text-[#e8e0d4] flex items-center justify-center gap-1">
                        <RankBadge rating={multiRating} showRating size="sm" />
                      </p>
                      <p className="text-[10px] text-[var(--gold-dim)]">Multiplayer</p>
                      {ratings?.multiplayer && (
                        <p className="text-[9px] text-[var(--gold-dim)]">{ratings.multiplayer.gamesPlayed} games</p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-bold text-[#e8e0d4]">—</p>
                      <p className="text-[10px] text-[var(--gold-dim)]">Multiplayer</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : null
        )}

        {/* All-time stats */}
        {hasUserId && (
          loadingStats ? (
            <p className="text-center text-sm text-[var(--gold-dim)]">Loading stats...</p>
          ) : allTimeStats ? (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
                All-Time Stats
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="glass p-2 text-center">
                  <p className="text-sm font-bold text-[#e8e0d4]">{allTimeStats.wins}/{allTimeStats.gamesPlayed}</p>
                  <p className="text-[10px] text-[var(--gold-dim)]">Wins</p>
                  {allTimeStats.winRate !== null && (
                    <p className="text-[var(--gold)] font-semibold text-xs">{allTimeStats.winRate}%</p>
                  )}
                </div>
                <div className="glass p-2 text-center">
                  <p className="text-sm font-bold text-[#e8e0d4]">{allTimeStats.bullAccuracy ?? '—'}%</p>
                  <p className="text-[10px] text-[var(--gold-dim)]">Bull Acc</p>
                </div>
                <div className="glass p-2 text-center">
                  <p className="text-sm font-bold text-[#e8e0d4]">{allTimeStats.trueAccuracy ?? '—'}%</p>
                  <p className="text-[10px] text-[var(--gold-dim)]">True Acc</p>
                </div>
                <div className="glass p-2 text-center">
                  <p className="text-sm font-bold text-[#e8e0d4]">{allTimeStats.bluffSuccessRate ?? '—'}%</p>
                  <p className="text-[10px] text-[var(--gold-dim)]">Bluff Rate</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-center text-sm text-[var(--gold-dim)]">
              No all-time stats available.
            </p>
          )
        )}

        {/* Match stats — always shown when available */}
        {stats && (stats.bullsCalled > 0 || stats.truesCalled > 0 || stats.callsMade > 0) && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
              Match Stats
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="glass p-2 text-center">
                <p className="text-sm font-bold text-[#e8e0d4]">{stats.correctBulls}/{stats.bullsCalled}</p>
                <p className="text-[10px] text-[var(--gold-dim)]">Bulls</p>
                {bullAcc !== null && (
                  <p className="text-[var(--gold)] font-semibold text-xs">{bullAcc}%</p>
                )}
              </div>
              <div className="glass p-2 text-center">
                <p className="text-sm font-bold text-[#e8e0d4]">{stats.correctTrues}/{stats.truesCalled}</p>
                <p className="text-[10px] text-[var(--gold-dim)]">Trues</p>
                {trueAcc !== null && (
                  <p className="text-[var(--gold)] font-semibold text-xs">{trueAcc}%</p>
                )}
              </div>
              <div className="glass p-2 text-center">
                <p className="text-sm font-bold text-[#e8e0d4]">{stats.callsMade}</p>
                <p className="text-[10px] text-[var(--gold-dim)]">Calls Made</p>
              </div>
              <div className="glass p-2 text-center">
                <p className="text-sm font-bold text-[#e8e0d4]">{stats.bluffsSuccessful}</p>
                <p className="text-[10px] text-[var(--gold-dim)]">Bluffs</p>
                {bluffRate !== null && (
                  <p className="text-[var(--gold)] font-semibold text-xs">{bluffRate}%</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Fallback when no stats at all */}
        {!hasUserId && (!stats || (stats.bullsCalled === 0 && stats.truesCalled === 0 && stats.callsMade === 0)) && (
          <p className="text-center text-sm text-[var(--gold-dim)]">
            No stats yet — game just started.
          </p>
        )}

        {/* Close */}
        <button
          onClick={onClose}
          className="w-full btn-ghost py-2 text-sm"
          aria-label="Close player profile"
        >
          Close
        </button>
      </div>
    </div>
  );
}
