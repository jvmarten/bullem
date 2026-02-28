import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { useGameContext } from '../context/GameContext.js';

export function ResultsPage() {
  const navigate = useNavigate();
  const { winnerId, gameState, playerId, leaveRoom } = useGameContext();

  const winnerName = gameState?.players.find((p) => p.id === winnerId)?.name ?? 'Unknown';
  const isWinner = winnerId === playerId;

  return (
    <Layout>
      <div className="flex flex-col items-center gap-8 pt-12 text-center animate-scale-in">
        {/* Trophy / crown */}
        <div className="text-6xl animate-float">
          {isWinner ? '\u265A' : '\u2664'}
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

        <button
          onClick={() => { leaveRoom(); navigate('/'); }}
          className="btn-gold px-10 py-3 text-lg"
        >
          Play Again
        </button>
      </div>
    </Layout>
  );
}
