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
        <button onClick={onLastChancePass} className="btn-ghost px-10 py-3 text-lg">
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
        <button onClick={onBull} className="btn-danger flex-1 max-w-40 py-3 text-lg">
          BULL!
        </button>
      )}
      {showTrue && (
        <button onClick={onTrue} className="btn-info flex-1 max-w-40 py-3 text-lg">
          TRUE
        </button>
      )}
    </div>
  );
}
