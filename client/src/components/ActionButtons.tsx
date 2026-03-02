import { RoundPhase } from '@bull-em/shared';
import { useSound } from '../hooks/useSound.js';

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
  const { play } = useSound();

  if (!isMyTurn) return null;

  const handleClick = (action: () => void, sound: 'uiClick' | 'bullCalled' = 'uiClick') => {
    play(sound);
    action();
  };

  if (roundPhase === RoundPhase.LAST_CHANCE && isLastChanceCaller) {
    return (
      <div className="flex gap-2 justify-center animate-slide-up">
        <button onClick={() => handleClick(onLastChancePass)} className="btn-ghost px-8 py-2 text-base">
          Pass
        </button>
      </div>
    );
  }

  const showBull = hasCurrentHand && (roundPhase === RoundPhase.CALLING || roundPhase === RoundPhase.BULL_PHASE);
  const showTrue = roundPhase === RoundPhase.BULL_PHASE;

  if (!showBull && !showTrue) return null;

  return (
    <div className="flex gap-2 justify-center animate-slide-up">
      {showBull && (
        <button onClick={() => handleClick(onBull, 'bullCalled')} className="btn-danger flex-1 max-w-40 py-2 text-base">
          BULL!
        </button>
      )}
      {showTrue && (
        <button onClick={() => handleClick(onTrue)} className="btn-info flex-1 max-w-40 py-2 text-base">
          TRUE
        </button>
      )}
    </div>
  );
}
