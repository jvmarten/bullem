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
      <div className="flex flex-col items-center gap-6 pt-12 text-center">
        <h2 className="text-3xl font-bold">
          {isWinner ? 'You Win!' : `${winnerName} Wins!`}
        </h2>
        <p className="text-green-300">
          {isWinner
            ? 'You outsmarted everyone at the table.'
            : 'Better luck next time.'}
        </p>
        <button
          onClick={() => { leaveRoom(); navigate('/'); }}
          className="px-8 py-3 bg-yellow-500 hover:bg-yellow-400 text-gray-900 rounded-lg font-bold text-lg transition-colors"
        >
          Play Again
        </button>
      </div>
    </Layout>
  );
}
