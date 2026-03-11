import { useEffect } from 'react';
import confetti from 'canvas-confetti';

/**
 * Fires a short confetti burst when the player has won.
 * No-ops when `isWinner` is false, so it's safe to call unconditionally.
 */
export function useWinConfetti(isWinner: boolean): void {
  useEffect(() => {
    if (!isWinner) return;

    // Respect prefers-reduced-motion — skip confetti entirely
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motionQuery.matches) return;

    // Gold-themed burst matching the Bull 'Em palette
    const colors = ['#FFD700', '#FFA500', '#FFEC8B', '#DAA520'];

    // Fire two bursts from left and right for a fuller effect
    const fire = (angle: number, originX: number) =>
      confetti({
        particleCount: 80,
        angle,
        spread: 60,
        origin: { x: originX, y: 0.6 },
        colors,
        gravity: 1.2,
        ticks: 120,
        disableForReducedMotion: true,
      });

    fire(60, 0.15);
    fire(120, 0.85);

    // Second volley after a short delay for extended celebration
    const timer = window.setTimeout(() => {
      fire(75, 0.3);
      fire(105, 0.7);
    }, 400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isWinner]);
}
