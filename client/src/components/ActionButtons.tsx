import { useState, useEffect, useCallback, memo } from 'react';
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
  onExpand?: () => void;
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
  onExpand,
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
    if (!expanded) {
      return (
        <div className="flex justify-start animate-slide-up" data-action-buttons>
          <button
            onClick={() => { play('uiClick'); setExpanded(true); onExpand?.(); }}
            className="btn-ghost border-[var(--gold-dim)] px-6 py-2 text-base font-bold animate-pulse-glow min-w-[9rem]"
          >
            Pass
          </button>
        </div>
      );
    }
    return (
      <div className="flex gap-2 justify-start animate-slide-up" data-action-buttons>
        <button onClick={() => handleClick(onLastChancePass)} className="btn-safe px-6 py-2 text-base font-bold min-w-[9rem] kbd-shortcut" data-kbd="P">
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
          onClick={() => { play('uiClick'); setExpanded(true); onExpand?.(); }}
          className="btn-ghost border-[var(--gold-dim)] px-6 py-2 text-base font-bold animate-pulse-glow min-w-[9rem] whitespace-nowrap shrink-0"
        >
          {showTrue ? 'BULL / TRUE' : 'BULL!'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-2 justify-start animate-slide-up" data-action-buttons>
      {showBull && (
        <button onClick={() => handleClick(onBull, 'bullCalled')} className="btn-danger px-4 py-2 text-base font-bold min-w-[7rem] kbd-shortcut" data-kbd="B">
          BULL!
        </button>
      )}
      {showTrue && (
        <button onClick={() => handleClick(onTrue)} className="btn-info px-4 py-2 text-base font-bold min-w-[7rem] kbd-shortcut" data-kbd="T">
          TRUE
        </button>
      )}
    </div>
  );
});
