import { useState, useEffect, useRef } from 'react';
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
      return hasCurrentHand ? 'Call or Raise' : 'Call a Hand';
    case RoundPhase.BULL_PHASE:
      return 'Bull, True, or Raise';
    case RoundPhase.LAST_CHANCE:
      return 'Last Chance to Raise';
    case RoundPhase.RESOLVING:
      return 'Revealing\u2026';
  }
}

export function TurnIndicator({ currentPlayerId, roundPhase, players, myPlayerId, turnDeadline, hasCurrentHand = false }: Props) {
  const isMyTurn = currentPlayerId === myPlayerId;
  const currentPlayer = players.find((p) => p.id === currentPlayerId);
  const isBotTurn = currentPlayer?.isBot && !isMyTurn;
  const { play } = useSound();

  const turnLabel = isMyTurn
    ? 'Your Turn'
    : `${currentPlayer?.name ?? '\u2026'}\u2019s Turn`;

  const phaseLabel = isBotTurn ? 'Thinking\u2026' : getPhaseLabel(roundPhase, hasCurrentHand);

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [fraction, setFraction] = useState(1);
  const [tickPulse, setTickPulse] = useState(false);
  const totalDurationRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);

  const isResolving = roundPhase === RoundPhase.RESOLVING;

  useEffect(() => {
    if (!turnDeadline || !isMyTurn || isResolving) {
      setSecondsLeft(null);
      setFraction(1);
      totalDurationRef.current = null;
      lastTickRef.current = null;
      return;
    }

    const now = Date.now();
    if (totalDurationRef.current === null) {
      totalDurationRef.current = turnDeadline - now;
    }
    const totalMs = totalDurationRef.current;

    const update = () => {
      const remainingMs = Math.max(0, turnDeadline - Date.now());
      const secs = Math.ceil(remainingMs / 1000);
      setSecondsLeft(secs);
      setFraction(totalMs > 0 ? remainingMs / totalMs : 0);

      // Play tick sound each second during last 5 seconds
      if (secs > 0 && secs <= 5 && secs !== lastTickRef.current) {
        lastTickRef.current = secs;
        play('timerTick');
        setTickPulse(true);
        setTimeout(() => setTickPulse(false), 300);
      }
    };

    update();
    const interval = setInterval(update, 100);
    return () => clearInterval(interval);
  }, [turnDeadline, isMyTurn, isResolving, play]);

  const isWarning = secondsLeft !== null && secondsLeft <= 5;
  const isTimedOut = secondsLeft === 0;
  const showTimer = secondsLeft !== null && secondsLeft > 0;

  const meterColor = isWarning ? 'var(--danger)' : 'var(--gold)';

  return (
    <div className={`text-center py-1.5 px-3 rounded-lg transition-all duration-300 ${
      isMyTurn
        ? isWarning
          ? `glass-raised border-[var(--danger)] ${tickPulse ? 'animate-timer-tick' : 'animate-shake'}`
          : 'glass-raised animate-pulse-glow border-[var(--gold)]'
        : 'glass'
    }`}>
      <p className={`font-display text-base font-bold ${isMyTurn ? isWarning ? 'text-[var(--danger)]' : 'text-[var(--gold)]' : ''}`}>
        {isTimedOut ? "Time\u2019s up!" : turnLabel}
        <span className={`text-xs font-normal ml-2 ${isWarning ? 'text-[var(--danger)]' : 'text-[var(--gold-dim)]'}`}>
          {phaseLabel}
        </span>
        {showTimer && (
          <span className={`ml-2 text-sm font-mono ${isWarning ? 'text-[var(--danger)] font-bold' : 'text-[var(--gold-dim)]'}`}>
            {secondsLeft}s
          </span>
        )}
      </p>
      {showTimer && (
        <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.3)' }}>
          <div
            className="h-full rounded-full"
            style={{
              width: `${fraction * 100}%`,
              background: meterColor,
              transition: 'width 0.15s linear, background 0.3s ease',
            }}
          />
        </div>
      )}
    </div>
  );
}
