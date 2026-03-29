import { useCallback, useRef, useState } from 'react';

/**
 * Gesture hook for hiding/showing cards via long-press + swipe.
 *
 * - Press and hold on the card area, then swipe down to flip face-down.
 * - Hold + swipe up to flip them back face-up.
 * - Uses setPointerCapture so the gesture never gets lost mid-swipe.
 * - Works at any time — not gated by turn state.
 */

/** Minimum hold time before swipe is tracked (ms) */
const HOLD_MS = 200;
/** Minimum swipe distance to trigger the flip (px) */
const SWIPE_PX = 80;

export function useCardHide(): {
  cardsHidden: boolean;
  flipProgress: number;
  gestureHandlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
  };
} {
  const [cardsHidden, setCardsHidden] = useState(false);
  const [flipProgress, setFlipProgress] = useState(0);

  const pointerIdRef = useRef<number | null>(null);
  const elementRef = useRef<Element | null>(null);
  const startYRef = useRef(0);
  const startTimeRef = useRef(0);
  const hiddenRef = useRef(false);

  const reset = useCallback(() => {
    // Release pointer capture if we hold it
    if (pointerIdRef.current !== null && elementRef.current) {
      try { elementRef.current.releasePointerCapture(pointerIdRef.current); } catch { /* already released */ }
    }
    pointerIdRef.current = null;
    elementRef.current = null;
    setFlipProgress(0);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (pointerIdRef.current !== null) return;
    pointerIdRef.current = e.pointerId;
    elementRef.current = e.currentTarget;
    startYRef.current = e.clientY;
    startTimeRef.current = Date.now();
    // Capture pointer so we get all move/up events even if finger drifts off
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* touch may not support */ }
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.pointerId !== pointerIdRef.current) return;

    const elapsed = Date.now() - startTimeRef.current;
    if (elapsed < HOLD_MS) return;

    const deltaY = e.clientY - startYRef.current;
    const isHidden = hiddenRef.current;

    // To hide: swipe down. To show: swipe up.
    const relevantDelta = isHidden ? -deltaY : deltaY;

    if (relevantDelta <= 0) {
      setFlipProgress(0);
      return;
    }

    const progress = Math.min(relevantDelta / SWIPE_PX, 1);
    setFlipProgress(progress);

    if (progress >= 1) {
      const newHidden = !isHidden;
      hiddenRef.current = newHidden;
      setCardsHidden(newHidden);
      reset();
    }
  }, [reset]);

  const onPointerUp = useCallback(() => {
    reset();
  }, [reset]);

  const onPointerCancel = useCallback(() => {
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
