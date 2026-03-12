import { useEffect, useState } from 'react';
import { useSound } from '../hooks/useSound.js';

interface CountdownOverlayProps {
  /** Total seconds for the countdown. */
  seconds: number;
  /** Optional label shown above the countdown (e.g. "Set 2"). */
  label?: string;
}

/**
 * Full-screen overlay showing "3… 2… 1…" countdown before the game starts
 * or before a new set in Bo3/Bo5 matches.
 */
export function CountdownOverlay({ seconds, label }: CountdownOverlayProps) {
  const [current, setCurrent] = useState(seconds);
  const { play } = useSound();

  useEffect(() => {
    play('uiClick');
  }, [current, play]);

  useEffect(() => {
    if (current <= 0) return;
    const timer = setTimeout(() => setCurrent(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [current]);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'var(--overlay)' }}
    >
      <div className="text-center space-y-4 animate-fade-in">
        {label && (
          <p className="text-[var(--gold-dim)] font-display text-lg font-semibold uppercase tracking-widest">
            {label}
          </p>
        )}
        <p
          key={current}
          className="text-[var(--gold)] font-display font-bold animate-countdown-pop"
          style={{ fontSize: 'clamp(4rem, 15vw, 8rem)' }}
        >
          {current > 0 ? current : ''}
        </p>
      </div>
    </div>
  );
}
