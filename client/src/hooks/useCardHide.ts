import { useCallback, useRef, useState } from 'react';

/**
 * Gesture hook for hiding/showing cards via swipe.
 *
 * Swipe up or down on the card area to trigger a card flip animation.
 * The swipe is a trigger — once the distance threshold is met (or the
 * user releases past halfway), a smooth CSS keyframe animation plays
 * the full flip. Content swaps at the midpoint (90° = edge-on = invisible).
 *
 * Works at any time, not gated by turn state.
 */

/** Swipe distance to trigger the flip (px) */
const SWIPE_PX = 80;
/** Duration of the CSS flip animation (ms) — must match CSS */
const FLIP_DURATION_MS = 400;

export function useCardHide(): {
  cardsHidden: boolean;
  swipeHint: number;
  isFlipping: boolean;
  gestureHandlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
  };
} {
  const [cardsHidden, setCardsHidden] = useState(false);
  const [swipeHint, setSwipeHint] = useState(0); // 0-1 visual feedback during swipe
  const [isFlipping, setIsFlipping] = useState(false);

  const pointerIdRef = useRef<number | null>(null);
  const elementRef = useRef<Element | null>(null);
  const startYRef = useRef(0);
  const hiddenRef = useRef(false);
  const progressRef = useRef(0);
  const flippingRef = useRef(false); // prevents re-entrance during animation

  const releasePointer = useCallback(() => {
    if (pointerIdRef.current !== null && elementRef.current) {
      try { elementRef.current.releasePointerCapture(pointerIdRef.current); } catch { /* ok */ }
    }
    pointerIdRef.current = null;
    elementRef.current = null;
  }, []);

  const triggerFlip = useCallback(() => {
    if (flippingRef.current) return;
    flippingRef.current = true;
    setSwipeHint(0);
    setIsFlipping(true);
    releasePointer();

    // Swap content at the midpoint of the animation (when cards are edge-on at 90°)
    const swapTimer = setTimeout(() => {
      hiddenRef.current = !hiddenRef.current;
      setCardsHidden(hiddenRef.current);
    }, FLIP_DURATION_MS / 2);

    // End the animation
    const endTimer = setTimeout(() => {
      setIsFlipping(false);
      flippingRef.current = false;
    }, FLIP_DURATION_MS);

    // Safety cleanup
    return () => { clearTimeout(swapTimer); clearTimeout(endTimer); };
  }, [releasePointer]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (pointerIdRef.current !== null || flippingRef.current) return;
    pointerIdRef.current = e.pointerId;
    elementRef.current = e.currentTarget;
    startYRef.current = e.clientY;
    progressRef.current = 0;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ok */ }
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.pointerId !== pointerIdRef.current || flippingRef.current) return;

    const deltaY = Math.abs(e.clientY - startYRef.current);
    const progress = Math.min(deltaY / SWIPE_PX, 1);
    progressRef.current = progress;
    setSwipeHint(progress);

    if (progress >= 1) {
      triggerFlip();
    }
  }, [triggerFlip]);

  const onPointerUp = useCallback(() => {
    if (flippingRef.current) { releasePointer(); return; }

    if (progressRef.current >= 0.5) {
      // Past halfway — auto-complete
      triggerFlip();
    } else {
      // Snap back
      setSwipeHint(0);
      releasePointer();
    }
    progressRef.current = 0;
  }, [triggerFlip, releasePointer]);

  const onPointerCancel = useCallback(() => {
    if (flippingRef.current) { releasePointer(); return; }
    setSwipeHint(0);
    progressRef.current = 0;
    releasePointer();
  }, [releasePointer]);

  return {
    cardsHidden,
    swipeHint,
    isFlipping,
    gestureHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
  };
}
