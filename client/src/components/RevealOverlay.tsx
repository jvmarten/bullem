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
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-green-800 rounded-xl p-6 max-w-sm w-full space-y-4 text-center shadow-2xl border border-green-600">
        <h2 className="text-xl font-bold">Round Over</h2>

        <p className="text-green-200">
          {callerName} called:{' '}
          <span className="text-yellow-300 font-bold">{handToString(result.calledHand)}</span>
        </p>

        <div className={`text-2xl font-bold py-2 rounded-lg ${
          result.handExists
            ? 'text-blue-400 bg-blue-900/30'
            : 'text-red-400 bg-red-900/30'
        }`}>
          {result.handExists ? 'The hand EXISTS!' : 'BULL! Hand is fake!'}
        </div>

        {result.revealedCards.length > 0 && (
          <div>
            <p className="text-xs text-green-400 mb-2">Revealed Cards</p>
            <div className="flex justify-center gap-1 flex-wrap">
              {result.revealedCards.map((card, i) => (
                <CardDisplay key={i} card={card} />
              ))}
            </div>
          </div>
        )}

        <div className="text-left space-y-1">
          <p className="text-xs text-green-400 uppercase mb-1">Results</p>
          {players.filter(p => result.penalties[p.id] !== undefined).map((p) => {
            const newCardCount = result.penalties[p.id];
            const wasWrong = newCardCount > p.cardCount;
            const isEliminated = result.eliminatedPlayerIds.includes(p.id);
            return (
              <div key={p.id} className={`flex justify-between items-center text-sm px-2 py-1 rounded ${
                isEliminated ? 'bg-red-900/40 text-red-300' :
                wasWrong ? 'bg-yellow-900/30 text-yellow-300' : 'bg-green-900/30 text-green-300'
              }`}>
                <span>{p.name}</span>
                <span className="text-xs">
                  {isEliminated ? 'ELIMINATED' :
                   wasWrong ? `+1 card (${newCardCount} total)` :
                   'Safe'}
                </span>
              </div>
            );
          })}
        </div>

        <button
          onClick={onDismiss}
          className="w-full px-6 py-3 bg-green-600 hover:bg-green-500 rounded-lg font-bold transition-all duration-150 active:scale-[0.98]"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
