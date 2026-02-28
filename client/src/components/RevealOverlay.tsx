import { handToString } from '@bull-em/shared';
import type { RoundResult, Player } from '@bull-em/shared';
import { CardDisplay } from './CardDisplay.js';

interface Props {
  result: RoundResult;
  players: Player[];
  onDismiss: () => void;
}

export function RevealOverlay({ result, players, onDismiss }: Props) {
  const callerName = players.find((p) => p.id === result.callerId)?.name ?? 'Unknown';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-green-800 rounded-xl p-6 max-w-sm w-full space-y-4 text-center">
        <h2 className="text-xl font-bold">Round Over</h2>

        <p className="text-green-200">
          {callerName} called: <span className="text-yellow-300 font-bold">{handToString(result.calledHand)}</span>
        </p>

        <div className={`text-2xl font-bold ${result.handExists ? 'text-blue-400' : 'text-red-400'}`}>
          {result.handExists ? 'The hand EXISTS!' : 'The hand is BULL!'}
        </div>

        {result.revealedCards.length > 0 && (
          <div className="flex justify-center gap-1 flex-wrap">
            {result.revealedCards.map((card, i) => (
              <CardDisplay key={i} card={card} />
            ))}
          </div>
        )}

        {result.eliminatedPlayerIds.length > 0 && (
          <p className="text-red-400 text-sm">
            Eliminated: {result.eliminatedPlayerIds.map(
              (id) => players.find((p) => p.id === id)?.name
            ).join(', ')}
          </p>
        )}

        <button
          onClick={onDismiss}
          className="px-6 py-2 bg-green-600 hover:bg-green-500 rounded-lg font-medium transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
