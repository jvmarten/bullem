import { RoundPhase } from '@bull-em/shared';

interface Props {
  roundPhase: RoundPhase;
  isMyTurn: boolean;
  hasCurrentHand: boolean;
  isLastChanceCaller: boolean;
  onBull: () => void;
  onTrue: () => void;
  onLastChancePass: () => void;
}

export function ActionButtons({
  roundPhase,
  isMyTurn,
  hasCurrentHand,
  isLastChanceCaller,
  onBull,
  onTrue,
  onLastChancePass,
}: Props) {
  if (!isMyTurn) return null;

  if (roundPhase === RoundPhase.LAST_CHANCE && isLastChanceCaller) {
    return (
      <div className="flex gap-3 justify-center animate-slide-up">
        <button
          onClick={onLastChancePass}
          className="px-8 py-3 bg-gray-600 hover:bg-gray-500 rounded-lg font-bold text-lg transition-all duration-150 active:scale-95"
        >
          Pass
        </button>
      </div>
    );
  }

  const showBull = hasCurrentHand && (roundPhase === RoundPhase.CALLING || roundPhase === RoundPhase.BULL_PHASE);
  const showTrue = roundPhase === RoundPhase.BULL_PHASE;

  if (!showBull && !showTrue) return null;

  return (
    <div className="flex gap-3 justify-center animate-slide-up">
      {showBull && (
        <button
          onClick={onBull}
          className="flex-1 max-w-40 py-3 bg-red-600 hover:bg-red-500 rounded-lg font-bold text-lg transition-all duration-150 active:scale-95 shadow-lg"
        >
          BULL!
        </button>
      )}
      {showTrue && (
        <button
          onClick={onTrue}
          className="flex-1 max-w-40 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold text-lg transition-all duration-150 active:scale-95 shadow-lg"
        >
          TRUE
        </button>
      )}
    </div>
  );
}
