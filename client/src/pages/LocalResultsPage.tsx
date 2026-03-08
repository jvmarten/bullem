import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { GameStatsDisplay } from '../components/GameStatsDisplay.js';
import { PlayerRankingReveal } from '../components/PlayerRankingReveal.js';
import { ShareCard } from '../components/ShareCard.js';
import { useGameContext } from '../context/GameContext.js';
import { useWinConfetti } from '../hooks/useWinConfetti.js';
import { playerInitial, playerColor } from '../utils/cardUtils.js';
import { markFirstGamePlayed } from '../utils/tutorialProgress.js';

export function LocalResultsPage() {
  const navigate = useNavigate();
  const { winnerId, gameState, gameStats, playerId, leaveRoom, requestRematch, lastReplay } = useGameContext();
  const [rankingDone, setRankingDone] = useState(false);

  // Mark that the player has completed their first real game
  useEffect(() => {
    if (winnerId) markFirstGamePlayed();
  }, [winnerId]);

  // If state is gone (page refresh), redirect to lobby
  useEffect(() => {
    if (!winnerId && !gameState) navigate('/local');
  }, [winnerId, gameState, navigate]);

  const winnerIndex = gameState?.players.findIndex((p) => p.id === winnerId) ?? -1;
  const winnerPlayer = winnerIndex >= 0 ? gameState!.players[winnerIndex]! : null;
  const winnerName = winnerPlayer?.name ?? 'Unknown';
  const isWinner = winnerId === playerId;

  useWinConfetti(isWinner);

  const handleRankingComplete = useCallback(() => {
    setRankingDone(true);
  }, []);

  if (!winnerId && !gameState) return null;

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
              : 'Better luck next time.'}
          </p>
        </div>

        {/* Animated ranking reveal */}
        {gameStats && gameState && gameState.players.length > 1 && (
          <PlayerRankingReveal
            players={gameState.players}
            winnerId={winnerId}
            stats={gameStats}
            onRevealComplete={handleRankingComplete}
          />
        )}

        {/* Stats shown after ranking animation completes */}
        {rankingDone && gameStats && gameState && (
          <div className="animate-slide-up w-full">
            <GameStatsDisplay stats={gameStats} players={gameState.players} winnerId={winnerId} />
          </div>
        )}
        </div>{/* end results-left */}

        <div className="results-right">
        <div className="flex flex-col gap-3 w-full max-w-xs items-center">
          <button
            onClick={() => { requestRematch(); navigate('/local/game'); }}
            className="btn-gold px-10 py-3 text-lg w-full"
          >
            Play Again
          </button>

          {/* Share card */}
          {rankingDone && gameStats && gameState && (
            <div className="animate-slide-up">
              <ShareCard players={gameState.players} winnerId={winnerId} stats={gameStats} />
            </div>
          )}

          {lastReplay && (
            <button
              onClick={() => navigate('/local/replay')}
              className="text-[var(--gold)] hover:text-[var(--gold-light)] text-sm font-medium transition-colors"
            >
              Watch Replay
            </button>
          )}
          <button
            onClick={() => { leaveRoom(); navigate('/local'); }}
            className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors"
          >
            New Game
          </button>
          <button
            onClick={() => { leaveRoom(); navigate('/'); }}
            className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors"
          >
            Back to Home
          </button>
        </div>
        </div>{/* end results-right */}
      </div>
    </Layout>
  );
}
