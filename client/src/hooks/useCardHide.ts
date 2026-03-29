import { useCallback, useRef, useState } from 'react';

/**
 * Gesture hook for hiding/showing cards via long-press + swipe down/up.
 *
 * - Press and hold on the card area for HOLD_MS, then swipe down SWIPE_PX
 *   to flip cards face-down (hidden).
 * - Same gesture (hold + swipe up) to flip them back face-up.
 * - The swipe threshold is long enough to avoid accidental triggers and
 *   does not interfere with Quick Draw (which is a simple tap).
 *
 * Returns:
 *  - `cardsHidden`: whether cards are currently face-down
 *  - `flipProgress`: 0 → 1 progress of the current swipe (for smooth animation)
 *  - `gestureHandlers`: pointerdown/pointermove/pointerup/pointercancel handlers
 */

/** Minimum hold time before swipe is tracked (ms) */
const HOLD_MS = 200;
/** Minimum swipe distance to trigger the flip (px) */
const SWIPE_PX = 60;

export function useCardHide(): {
  cardsHidden: boolean;
  flipProgress: number;
  gestureHandlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
} {
  const [cardsHidden, setCardsHidden] = useState(false);
  const [flipProgress, setFlipProgress] = useState(0);

  // Refs for gesture tracking (avoid re-renders during tracking)
  const pointerIdRef = useRef<number | null>(null);
  const startYRef = useRef(0);
  const startTimeRef = useRef(0);
  const holdActiveRef = useRef(false);
  const hiddenRef = useRef(false); // mirrors cardsHidden without stale closure

  const reset = useCallback(() => {
    pointerIdRef.current = null;
    holdActiveRef.current = false;
    setFlipProgress(0);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Only track single-finger touch or primary mouse button
    if (pointerIdRef.current !== null) return;
    pointerIdRef.current = e.pointerId;
    startYRef.current = e.clientY;
    startTimeRef.current = Date.now();
    holdActiveRef.current = false;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.pointerId !== pointerIdRef.current) return;

    const elapsed = Date.now() - startTimeRef.current;
    if (elapsed < HOLD_MS) return; // not held long enough yet

    holdActiveRef.current = true;

    const deltaY = e.clientY - startYRef.current;
    const isHidden = hiddenRef.current;

    // To hide: swipe down (positive deltaY). To show: swipe up (negative deltaY).
    const relevantDelta = isHidden ? -deltaY : deltaY;

    if (relevantDelta <= 0) {
      setFlipProgress(0);
      return;
    }

    const progress = Math.min(relevantDelta / SWIPE_PX, 1);
    setFlipProgress(progress);

    if (progress >= 1) {
      // Flip completed
      const newHidden = !isHidden;
      hiddenRef.current = newHidden;
      setCardsHidden(newHidden);
      reset();
    }
  }, [reset]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (e.pointerId !== pointerIdRef.current) return;
    reset();
  }, [reset]);

  const onPointerCancel = useCallback((e: React.PointerEvent) => {
    if (e.pointerId !== pointerIdRef.current) return;
    reset();
  }, [reset]);

  return {
    cardsHidden,
    flipProgress,
    gestureHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
  };
}
