import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { GameStatsDisplay } from '../components/GameStatsDisplay.js';
import { useGameContext } from '../context/GameContext.js';
import { useWinConfetti } from '../hooks/useWinConfetti.js';

export function LocalResultsPage() {
  const navigate = useNavigate();
  const { winnerId, gameState, gameStats, playerId, leaveRoom, requestRematch, lastReplay } = useGameContext();

  // If state is gone (page refresh), redirect to lobby
  useEffect(() => {
    if (!winnerId && !gameState) navigate('/local');
  }, [winnerId, gameState, navigate]);

  const winnerName = gameState?.players.find((p) => p.id === winnerId)?.name ?? 'Unknown';
  const isWinner = winnerId === playerId;

  useWinConfetti(isWinner);

  if (!winnerId && !gameState) return null;

  return (
    <Layout>
      <div className="results-content flex flex-col items-center gap-6 pt-8 text-center animate-scale-in">
        <div className="results-left">
        <div className="text-5xl animate-float">
          {isWinner ? '\uD83C\uDFC6' : '\uD83D\uDE14'}
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

        {gameStats && gameState && (
          <GameStatsDisplay stats={gameStats} players={gameState.players} winnerId={winnerId} />
        )}
        </div>{/* end results-left */}

        <div className="results-right">
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            onClick={() => { requestRematch(); navigate('/local/game'); }}
            className="btn-gold px-10 py-3 text-lg"
          >
            Rematch
          </button>
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
