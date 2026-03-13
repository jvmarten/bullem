import { memo } from 'react';
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
  /** When true, the TRUE button is never shown (e.g. 5 Draw uses strict LCR rules). */
  hideTrue?: boolean;
}

// Memoized: skips re-renders when parent state changes (e.g. timer ticks,
// turn history updates) but these props haven't changed. Without memo, each
// re-render tears down and re-attaches the document click/touch listeners.
export const ActionButtons = memo(function ActionButtons({
  roundPhase,
  isMyTurn,
  hasCurrentHand,
  isLastChanceCaller,
  onBull,
  onTrue,
  onLastChancePass,
  hideTrue,
}: Props) {
  const { play } = useSound();

  if (!isMyTurn) return null;

  const handleClick = (action: () => void, sound: 'uiClick' | 'bullCalled' = 'uiClick') => {
    play(sound);
    action();
  };

  if (roundPhase === RoundPhase.LAST_CHANCE && isLastChanceCaller) {
    return (
      <div className="flex justify-start animate-slide-up action-btn-gap" data-action-buttons role="group" aria-label="Game actions">
        <button onClick={() => handleClick(onLastChancePass)} className="btn-safe action-btn-base font-bold animate-pulse-glow-green action-btn-primary kbd-shortcut" data-kbd="P" aria-label="Pass (keyboard shortcut: P)">
          Pass
        </button>
      </div>
    );
  }

  const showBull = hasCurrentHand && (roundPhase === RoundPhase.CALLING || roundPhase === RoundPhase.BULL_PHASE);
  const showTrue = !hideTrue && roundPhase === RoundPhase.BULL_PHASE;

  if (!showBull && !showTrue) return null;

  return (
    <div className="flex justify-start animate-slide-up action-btn-gap" data-action-buttons role="group" aria-label="Game actions">
      {showBull && (
        <button onClick={() => handleClick(onBull)} className={`btn-danger action-btn-base font-bold animate-pulse-glow-red ${showTrue ? 'action-btn-secondary' : 'action-btn-primary'} kbd-shortcut`} data-kbd="B" aria-label="Call bull (keyboard shortcut: B)">
          BULL!
        </button>
      )}
      {showTrue && (
        <button onClick={() => handleClick(onTrue)} className="btn-info action-btn-base font-bold animate-pulse-glow-blue action-btn-secondary kbd-shortcut" data-kbd="T" aria-label="Call true (keyboard shortcut: T)">
          TRUE
        </button>
      )}
    </div>
  );
});
