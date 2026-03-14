import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { playerColor } from '../utils/cardUtils.js';
import { PlayerAvatarContent } from './PlayerAvatar.js';
import { useSound } from '../hooks/useSound.js';
import type { Player, PlayerId, GameStats, RatingChange } from '@bull-em/shared';

interface RankedPlayer {
  player: Player;
  position: number; // 1 = winner, 2 = 2nd, etc.
  originalIndex: number;
}

interface Props {
  players: Player[];
  winnerId: PlayerId | null;
  stats: GameStats;
  onRevealComplete: () => void;
  ratingChanges?: Record<PlayerId, RatingChange> | null;
  /** When true, skip the reveal animation and show all rankings immediately. */
  skipAnimation?: boolean;
}

/**
 * Builds a ranking from game stats: winner is 1st, then sorted by rounds survived (desc),
 * then by total calls made (desc) as tiebreaker.
 */
function buildRanking(players: Player[], winnerId: PlayerId | null, stats: GameStats): RankedPlayer[] {
  const ranked = players.map((player, originalIndex) => ({
    player,
    originalIndex,
    roundsSurvived: stats.playerStats[player.id]?.roundsSurvived ?? 0,
    callsMade: stats.playerStats[player.id]?.callsMade ?? 0,
  }));

  ranked.sort((a, b) => {
    // Winner always first
    if (a.player.id === winnerId) return -1;
    if (b.player.id === winnerId) return 1;
    // Then by rounds survived (desc)
    if (b.roundsSurvived !== a.roundsSurvived) return b.roundsSurvived - a.roundsSurvived;
    // Then by calls made (desc)
    return b.callsMade - a.callsMade;
  });

  return ranked.map((entry, i) => ({
    player: entry.player,
    position: i + 1,
    originalIndex: entry.originalIndex,
  }));
}

const POSITION_LABELS: Record<number, string> = {
  1: '1st',
  2: '2nd',
  3: '3rd',
};

function positionLabel(pos: number): string {
  return POSITION_LABELS[pos] ?? `${pos}th`;
}

/** Delay in ms between each player reveal, from last to first. */
const REVEAL_INTERVAL = 700;
/** Extra delay before the winner (1st place) reveal. */
const WINNER_EXTRA_DELAY = 400;

export function PlayerRankingReveal({ players, winnerId, stats, onRevealComplete, ratingChanges, skipAnimation }: Props) {
  const ranking = buildRanking(players, winnerId, stats);
  // Reveal order: last place first, winner last
  const revealOrder = [...ranking].reverse();

  const [revealedCount, setRevealedCount] = useState(() =>
    skipAnimation ? revealOrder.length : 0
  );
  const { play } = useSound();
  const navigate = useNavigate();

  const revealNext = useCallback(() => {
    setRevealedCount(prev => prev + 1);
  }, []);

  useEffect(() => {
    if (revealedCount >= revealOrder.length) {
      onRevealComplete();
      return;
    }

    const nextPosition = revealOrder[revealedCount]?.position ?? 0;
    const isWinnerNext = nextPosition === 1;
    const delay = isWinnerNext
      ? REVEAL_INTERVAL + WINNER_EXTRA_DELAY
      : REVEAL_INTERVAL;

    const timer = window.setTimeout(() => {
      // Play sound based on position being revealed
      if (isWinnerNext) {
        play('fanfare');
      } else {
        play('cardReveal');
      }
      revealNext();
    }, delay);

    return () => window.clearTimeout(timer);
  }, [revealedCount, revealOrder, revealNext, onRevealComplete, play]);

  return (
    <div className="flex flex-col items-center gap-2 w-full max-w-sm">
      <h3 className="font-display text-sm font-bold text-[var(--gold)] mb-1">Final Standings</h3>
      <div className="flex flex-col gap-1.5 w-full">
        {/* Show already-revealed entries from top (1st) to bottom */}
        {revealOrder.slice(0, revealedCount).reverse().map((entry) => {
          const isWinner = entry.position === 1;
          const isTopThree = entry.position <= 3;

          return (
            <div
              key={entry.player.id}
              className={`
                flex items-center gap-3 px-3 py-2 rounded-lg animate-ranking-reveal
                ${isWinner ? 'glass ring-1 ring-[var(--gold)]' : 'glass'}
              `}
              style={{
                animationDuration: isWinner ? '0.6s' : '0.4s',
              }}
            >
              {/* Position badge */}
              <div
                className={`
                  flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                  ${isWinner
                    ? 'bg-[var(--gold)] text-[var(--felt-dark)]'
                    : isTopThree
                      ? 'bg-[var(--gold-dim)] text-[var(--felt-dark)]'
                      : 'bg-[var(--surface)] text-[var(--gold-dim)]'
                  }
                `}
              >
                {positionLabel(entry.position)}
              </div>

              {/* Player avatar + name (clickable if player has a profile) */}
              <button
                className={`flex items-center gap-3 min-w-0 ${entry.player.username ? 'cursor-pointer hover:opacity-80 active:scale-95 transition-all' : 'cursor-default'}`}
                onClick={() => {
                  if (entry.player.username) {
                    navigate(`/u/${encodeURIComponent(entry.player.username)}`);
                  }
                }}
                disabled={!entry.player.username}
                type="button"
              >
                <div
                  className={`avatar ${playerColor(entry.originalIndex, entry.player.avatarBgColor)} flex items-center justify-center flex-shrink-0 overflow-hidden`}
                  style={{ width: isWinner ? '2.5rem' : '2rem', height: isWinner ? '2.5rem' : '2rem', fontSize: isWinner ? '1.1rem' : '0.9rem' }}
                >
                  <PlayerAvatarContent name={entry.player.name} avatar={entry.player.avatar} photoUrl={entry.player.photoUrl} isBot={entry.player.isBot} />
                </div>
                <span className={`truncate ${isWinner ? 'font-bold text-[var(--gold)]' : 'text-sm'}`}>
                  {entry.player.name}
                </span>
              </button>

              {/* Rating change (ranked games only) */}
              {(() => {
                const rc = ratingChanges?.[entry.player.id];
                if (!rc) return null;
                const isGain = rc.delta >= 0;
                const sign = isGain ? '+' : '\u2212';
                const color = isGain ? 'var(--safe)' : 'var(--danger)';
                return (
                  <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-xs text-[var(--gold-dim)]">
                      {Math.round(rc.after)}
                    </span>
                    <span
                      className="text-xs font-bold"
                      style={{ color }}
                    >
                      {sign}{Math.round(Math.abs(rc.delta))}
                    </span>
                  </div>
                );
              })()}

            </div>
          );
        })}
      </div>

      {/* Skip button while animation is playing */}
      {revealedCount < revealOrder.length && (
        <button
          onClick={() => {
            setRevealedCount(revealOrder.length);
            play('uiClick');
            onRevealComplete();
          }}
          className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-xs transition-colors mt-1"
        >
          Skip
        </button>
      )}
    </div>
  );
}
