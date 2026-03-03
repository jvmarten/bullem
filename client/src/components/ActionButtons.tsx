import { useState, useEffect, useCallback } from 'react';
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
  const [expanded, setExpanded] = useState(false);

  // Reset expanded state when turn changes
  useEffect(() => {
    setExpanded(false);
  }, [isMyTurn, roundPhase]);

  // Close on tap outside — listen for clicks on the document
  const handleOutsideClick = useCallback((e: MouseEvent | TouchEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('[data-action-buttons]')) {
      setExpanded(false);
    }
  }, []);

  useEffect(() => {
    if (!expanded) return;
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [expanded, handleOutsideClick]);

  if (!isMyTurn) return null;

  const handleClick = (action: () => void, sound: 'uiClick' | 'bullCalled' = 'uiClick') => {
    play(sound);
    setExpanded(false);
    action();
  };

  if (roundPhase === RoundPhase.LAST_CHANCE && isLastChanceCaller) {
    return (
      <div className="flex gap-2 justify-start animate-slide-up" data-action-buttons>
        <button onClick={() => handleClick(onLastChancePass)} className="btn-ghost px-8 py-2 text-base">
          Pass
        </button>
      </div>
    );
  }

  const showBull = hasCurrentHand && (roundPhase === RoundPhase.CALLING || roundPhase === RoundPhase.BULL_PHASE);
  const showTrue = roundPhase === RoundPhase.BULL_PHASE;

  if (!showBull && !showTrue) return null;

  if (!expanded) {
    return (
      <div className="flex justify-start animate-slide-up" data-action-buttons>
        <button
          onClick={() => { play('uiClick'); setExpanded(true); }}
          className="btn-ghost border-[var(--gold-dim)] px-6 py-2 text-base font-bold"
        >
          {showTrue ? 'BULL / TRUE' : 'BULL!'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-2 justify-start animate-slide-up" data-action-buttons>
      {showBull && (
        <button onClick={() => handleClick(onBull, 'bullCalled')} className="btn-danger px-6 py-2 text-base">
          BULL!
        </button>
      )}
      {showTrue && (
        <button onClick={() => handleClick(onTrue)} className="btn-info px-6 py-2 text-base">
          TRUE
        </button>
      )}
    </div>
  );
}
