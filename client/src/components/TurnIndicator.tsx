import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { RoundPhase } from '@bull-em/shared';
import type { Player, PlayerId } from '@bull-em/shared';
import { useSound } from '../hooks/useSound.js';

interface Props {
  currentPlayerId: PlayerId;
  roundPhase: RoundPhase;
  players: Player[];
  myPlayerId: string | null;
  turnDeadline?: number | null;
  hasCurrentHand?: boolean;
}

function getPhaseLabel(roundPhase: RoundPhase, hasCurrentHand: boolean): string {
  switch (roundPhase) {
    case RoundPhase.CALLING:
      return hasCurrentHand ? 'Bull or Raise' : 'Call a Hand';
    case RoundPhase.BULL_PHASE:
      return 'Bull, True, or Raise';
    case RoundPhase.LAST_CHANCE:
      return 'Last Chance Raise or Pass';
    case RoundPhase.RESOLVING:
      return 'Revealing\u2026';
  }
}

// Memoized: parent (GamePage/LocalGamePage) re-renders on every turn history
// update, but TurnIndicator's props are stable within a turn. The internal
// timer uses direct DOM manipulation (meterRef) at 10fps to avoid React
// re-renders. Without memo, each parent re-render recreates the component,
// tearing down and re-attaching the 100ms interval.
export const TurnIndicator = memo(function TurnIndicator({ currentPlayerId, roundPhase, players, myPlayerId, turnDeadline, hasCurrentHand = false }: Props) {
  const isMyTurn = currentPlayerId === myPlayerId;
  const currentPlayer = players.find((p) => p.id === currentPlayerId);
  const { play } = useSound();

  const turnLabel = isMyTurn
    ? 'Your Turn'
    : `${currentPlayer?.name ?? '\u2026'}\u2019s Turn`;

  const phaseLabel = getPhaseLabel(roundPhase, hasCurrentHand);

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [tickPulse, setTickPulse] = useState(false);
  const totalDurationRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  // Direct DOM ref for the progress bar — updated at 10fps without triggering
  // React re-renders (re-renders only when secondsLeft changes, ~1/sec).
  const meterRef = useRef<HTMLDivElement>(null);
  // Direct DOM ref for the screen edge glow overlay — updated at 10fps
  const glowRef = useRef<HTMLDivElement>(null);

  const isResolving = roundPhase === RoundPhase.RESOLVING;

  const updateMeter = useCallback((remainingMs: number) => {
    const totalMs = totalDurationRef.current;
    if (!totalMs) return;
    const pct = totalMs > 0 ? (remainingMs / totalMs) * 100 : 0;
    if (meterRef.current) {
      meterRef.current.style.width = `${pct}%`;
    }
    // Update screen edge glow intensity — ramps from 0 to 1 over last 5 seconds
    if (glowRef.current) {
      const secsRemaining = remainingMs / 1000;
      if (secsRemaining <= 5 && secsRemaining > 0) {
        const intensity = 1 - (secsRemaining / 5);
        glowRef.current.style.opacity = String(intensity);
      } else {
        glowRef.current.style.opacity = '0';
      }
    }
  }, []);

  useEffect(() => {
    if (!turnDeadline || !isMyTurn || isResolving) {
      setSecondsLeft(null);
      totalDurationRef.current = null;
      lastTickRef.current = null;
      if (meterRef.current) meterRef.current.style.width = '100%';
      if (glowRef.current) glowRef.current.style.opacity = '0';
      return;
    }

    const now = Date.now();
    if (totalDurationRef.current === null) {
      totalDurationRef.current = turnDeadline - now;
    }

    const update = () => {
      const remainingMs = Math.max(0, turnDeadline - Date.now());
      const secs = Math.ceil(remainingMs / 1000);
      setSecondsLeft(secs);
      updateMeter(remainingMs);

      // Play tick + heartbeat each second during last 5 seconds
      if (secs > 0 && secs <= 5 && secs !== lastTickRef.current) {
        lastTickRef.current = secs;
        play('timerTick');
        play('heartbeat');
        setTickPulse(true);
        setTimeout(() => setTickPulse(false), 300);
      }
    };

    update();
    const interval = setInterval(update, 100);
    return () => clearInterval(interval);
  }, [turnDeadline, isMyTurn, isResolving, play, updateMeter]);

  const isWarning = secondsLeft !== null && secondsLeft <= 5;
  const isTimedOut = secondsLeft === 0;
  const showTimer = secondsLeft !== null && secondsLeft > 0;

  const meterColor = isWarning ? 'var(--danger)' : 'var(--info)';

  return (
    <>
      {/* Screen edge glow overlay — fixed vignette that intensifies as timer runs low */}
      <div
        ref={glowRef}
        className="screen-edge-glow"
        style={{ opacity: 0 }}
        aria-hidden="true"
      />
      <div className={`text-center py-1.5 px-3 rounded-lg transition-all duration-300 ${
        isMyTurn
          ? isWarning
            ? `glass-raised border-[var(--danger)] ${tickPulse ? 'animate-timer-tick' : 'animate-shake'}`
            : roundPhase === RoundPhase.LAST_CHANCE
              ? 'glass-raised animate-pulse-glow border-[var(--danger)]'
              : 'glass-me animate-pulse-glow-blue border-[var(--info)]'
          : 'glass'
      }`}>
        <p className={`font-display text-base font-bold ${isMyTurn ? (isWarning || roundPhase === RoundPhase.LAST_CHANCE) ? 'text-[var(--danger)]' : 'text-[var(--info)]' : ''}`}>
          {isTimedOut ? "Time\u2019s up!" : turnLabel}
          <span className={`text-xs font-normal ml-2 ${isWarning || (isMyTurn && roundPhase === RoundPhase.LAST_CHANCE) ? 'text-[var(--danger)]' : isMyTurn ? 'text-[rgba(74,144,217,0.7)]' : 'text-[var(--gold-dim)]'}`}>
            {phaseLabel}
          </span>
          {showTimer && (
            <span className={`ml-2 text-sm font-mono ${isWarning ? 'text-[var(--danger)] font-bold' : 'text-[rgba(74,144,217,0.7)]'}`}>
              {secondsLeft}s
            </span>
          )}
        </p>
        {showTimer && (
          <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <div
              ref={meterRef}
              className="h-full rounded-full"
              style={{
                width: '100%',
                background: meterColor,
                transition: 'width 0.15s linear, background 0.3s ease',
              }}
            />
          </div>
        )}
      </div>
    </>
  );
});
