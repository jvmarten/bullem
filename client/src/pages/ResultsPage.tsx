import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { GameStatsDisplay } from '../components/GameStatsDisplay.js';
import { useGameContext } from '../context/GameContext.js';
import { useWinConfetti } from '../hooks/useWinConfetti.js';

export function ResultsPage() {
  const navigate = useNavigate();
  const { roomCode } = useParams<{ roomCode: string }>();
  const { winnerId, gameState, gameStats, playerId, leaveRoom, requestRematch, roomState, lastReplay } = useGameContext();

  // When winnerId is cleared (rematch started), navigate back to the game page
  useEffect(() => {
    if (!winnerId && roomCode && gameState) {
      navigate(`/game/${roomCode}`);
    }
  }, [winnerId, roomCode, gameState, navigate]);

  const winnerName = gameState?.players.find((p) => p.id === winnerId)?.name ?? 'Unknown';
  const isPlayerInGame = gameState?.players.some(p => p.id === playerId) ?? false;
  const isWinner = isPlayerInGame && winnerId === playerId;
  const isSpectator = !isPlayerInGame;
  const isHost = roomState?.hostId === playerId;

  useWinConfetti(isWinner);

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
              : isSpectator
                ? `${winnerName} won the game!`
                : 'Better luck next time.'}
          </p>
        </div>

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
