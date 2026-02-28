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
      <div className="flex gap-3 justify-center">
        <button
          onClick={onLastChancePass}
          className="px-6 py-3 bg-gray-600 hover:bg-gray-500 rounded-lg font-bold text-lg transition-colors"
        >
          Pass
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-3 justify-center">
      {hasCurrentHand && (roundPhase === RoundPhase.CALLING || roundPhase === RoundPhase.BULL_PHASE) && (
        <button
          onClick={onBull}
          className="px-6 py-3 bg-red-600 hover:bg-red-500 rounded-lg font-bold text-lg transition-colors"
        >
          BULL!
        </button>
      )}
      {roundPhase === RoundPhase.BULL_PHASE && (
        <button
          onClick={onTrue}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold text-lg transition-colors"
        >
          TRUE
        </button>
      )}
    </div>
  );
}
