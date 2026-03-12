import { useState, useCallback, useRef, useEffect } from 'react';
import type { RoundResult } from '@bull-em/shared';

/**
 * Orientation-independent reveal phase state.
 *
 * Manages whether the cinematic animation has completed for the current
 * roundResult so that orientation changes mid-reveal don't replay or
 * skip incorrectly. Also anchors the auto-dismiss timer to the moment
 * the round result first arrived (not when the overlay mounts).
 */
export function useRevealPhase(roundResult: RoundResult | null): {
  cinematicComplete: boolean;
  revealStartedAt: number;
  markCinematicComplete: () => void;
} {
  const [cinematicComplete, setCinematicComplete] = useState(false);
  const revealStartedAtRef = useRef<number>(0);

  // Reset when a new round result arrives
  useEffect(() => {
    if (roundResult) {
      setCinematicComplete(false);
      revealStartedAtRef.current = Date.now();
    }
  }, [roundResult]);

  const markCinematicComplete = useCallback(() => {
    setCinematicComplete(true);
  }, []);

  return {
    cinematicComplete,
    revealStartedAt: revealStartedAtRef.current,
    markCinematicComplete,
  };
}
