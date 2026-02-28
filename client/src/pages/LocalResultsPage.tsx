import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { useGameContext } from '../context/GameContext.js';

export function LocalResultsPage() {
  const navigate = useNavigate();
  const { winnerId, gameState, playerId, leaveRoom } = useGameContext();

  const winnerName = gameState?.players.find((p) => p.id === winnerId)?.name ?? 'Unknown';
  const isWinner = winnerId === playerId;

  return (
    <Layout>
      <div className="flex flex-col items-center gap-8 pt-12 text-center animate-scale-in">
        <div className="text-6xl animate-float">
          {isWinner ? '\uD83C\uDFC6' : '\uD83D\uDE14'}
        </div>

        <div>
          <h2 className="font-display text-4xl font-bold text-[var(--gold)]">
            {isWinner ? 'You Win!' : `${winnerName} Wins!`}
          </h2>
          <p className="text-[var(--gold-dim)] mt-2">
            {isWinner
              ? 'You outsmarted everyone at the table.'
              : 'Better luck next time.'}
          </p>
        </div>

        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            onClick={() => { leaveRoom(); navigate('/local'); }}
            className="btn-gold px-10 py-3 text-lg"
          >
            Play Again
          </button>
          <button
            onClick={() => { leaveRoom(); navigate('/'); }}
            className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    </Layout>
  );
}
