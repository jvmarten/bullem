import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { GameStatsDisplay } from '../components/GameStatsDisplay.js';
import { useGameContext } from '../context/GameContext.js';
import { useWinConfetti } from '../hooks/useWinConfetti.js';
import { RankBadge } from '../components/RankBadge.js';
import { playerInitial, playerColor } from '../utils/cardUtils.js';
import type { RatingChange } from '@bull-em/shared';

function RatingChangeDisplay({ change }: { change: RatingChange }) {
  const isGain = change.delta >= 0;
  const sign = isGain ? '+' : '\u2212';
  const color = isGain ? 'var(--safe)' : 'var(--danger)';
  const modeLabel = change.mode === 'heads_up' ? '1v1 Rating' : 'Multiplayer Rating';

  return (
    <div className="glass px-6 py-4 text-center animate-rating-slide-up" style={{ animationDelay: '0.3s' }}>
      <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
        {modeLabel}
      </p>
      <div className="flex items-center justify-center gap-3">
        <span className="text-sm text-[var(--gold-dim)]">
          {change.before}
        </span>
        <span className="text-[var(--gold-dim)]">&rarr;</span>
        <span className="text-lg font-bold text-[var(--gold)] flex items-center gap-1">
          {change.after}
          <RankBadge rating={change.after} size="md" />
        </span>
      </div>
      <p
        className="text-lg font-bold mt-1 animate-rating-slide-up"
        style={{ color, animationDelay: '0.6s' }}
      >
        {sign}{Math.abs(change.delta)}
      </p>
    </div>
  );
}

export function ResultsPage() {
  const navigate = useNavigate();
  const { roomCode } = useParams<{ roomCode: string }>();
  const { winnerId, gameState, gameStats, playerId, leaveRoom, requestRematch, roomState, lastReplay, ratingChanges } = useGameContext();

  // When winnerId is cleared (rematch started), navigate back to the game page
  useEffect(() => {
    if (!winnerId && roomCode && gameState) {
      navigate(`/game/${roomCode}`);
    }
  }, [winnerId, roomCode, gameState, navigate]);

  const winnerIndex = gameState?.players.findIndex((p) => p.id === winnerId) ?? -1;
  const winnerPlayer = winnerIndex >= 0 ? gameState!.players[winnerIndex]! : null;
  const winnerName = winnerPlayer?.name ?? 'Unknown';
  const isPlayerInGame = gameState?.players.some(p => p.id === playerId) ?? false;
  const isWinner = isPlayerInGame && winnerId === playerId;
  const isSpectator = !isPlayerInGame;
  const isHost = roomState?.hostId === playerId;

  useWinConfetti(isWinner);

  return (
    <Layout>
      <div className="results-content flex flex-col items-center gap-6 pt-8 text-center animate-scale-in">
        <div className="results-left">
        <div className="animate-float">
          <div className={`avatar ${playerColor(winnerIndex >= 0 ? winnerIndex : 0)} flex items-center justify-center`}
               style={{ width: '4rem', height: '4rem', fontSize: '1.75rem' }}>
            {winnerPlayer?.isBot ? '\u2699' : playerInitial(winnerName)}
          </div>
        </div>

        <div>
          <h2 className="font-display text-3xl font-bold text-[var(--gold)]">
            {isWinner ? 'You Win!' : `${winnerName} Wins!`}
          </h2>
          <p className="text-[var(--gold-dim)] mt-1 text-sm">
            {isWinner
              ? 'You outsmarted everyone at the table.'
              : isSpectator
                ? `${winnerName} won the game!`
                : 'Better luck next time.'}
          </p>
        </div>

        {/* Rating change for ranked games */}
        {playerId && ratingChanges && ratingChanges[playerId] && (
          <RatingChangeDisplay change={ratingChanges[playerId]} />
        )}

        {gameStats && gameState && (
          <GameStatsDisplay stats={gameStats} players={gameState.players} winnerId={winnerId} />
        )}
        </div>{/* end results-left */}

        <div className="results-right">
        <div className="flex flex-col gap-3 w-full max-w-xs">
          {isHost && !isSpectator && (
            <button
              onClick={requestRematch}
              className="btn-gold px-10 py-3 text-lg"
            >
              Rematch
            </button>
          )}
          {!isHost && !isSpectator && (
            <p className="text-[var(--gold-dim)] text-sm">
              Waiting for host to start rematch...
            </p>
          )}
          {lastReplay && (
            <button
              onClick={() => navigate('/replay')}
              className="text-[var(--gold)] hover:text-[var(--gold-light)] text-sm font-medium transition-colors"
            >
              Watch Replay
            </button>
          )}
          <button
            onClick={() => { leaveRoom(); navigate('/'); }}
            className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors"
          >
            Leave Game
          </button>
        </div>
        </div>{/* end results-right */}
      </div>
    </Layout>
  );
}
