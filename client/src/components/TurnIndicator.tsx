import { useState, useEffect } from 'react';
import { RoundPhase } from '@bull-em/shared';
import type { Player, PlayerId } from '@bull-em/shared';

interface Props {
  currentPlayerId: PlayerId;
  roundPhase: RoundPhase;
  players: Player[];
  myPlayerId: string | null;
  turnDeadline?: number | null;
}

const PHASE_LABELS: Record<RoundPhase, string> = {
  [RoundPhase.CALLING]: 'Call or Raise',
  [RoundPhase.BULL_PHASE]: 'Bull, True, or Raise',
  [RoundPhase.LAST_CHANCE]: 'Last Chance to Raise',
  [RoundPhase.RESOLVING]: 'Revealing\u2026',
};

export function TurnIndicator({ currentPlayerId, roundPhase, players, myPlayerId, turnDeadline }: Props) {
  const isMyTurn = currentPlayerId === myPlayerId;
  const currentPlayer = players.find((p) => p.id === currentPlayerId);
  const isBotTurn = currentPlayer?.isBot && !isMyTurn;

  const turnLabel = isMyTurn
    ? 'Your Turn'
    : `${currentPlayer?.name ?? '\u2026'}\u2019s Turn`;

  const phaseLabel = isBotTurn ? 'Thinking\u2026' : PHASE_LABELS[roundPhase];

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!turnDeadline || !isMyTurn) {
      setSecondsLeft(null);
      return;
    }

    const update = () => {
      const remaining = Math.max(0, Math.ceil((turnDeadline - Date.now()) / 1000));
      setSecondsLeft(remaining);
    };

    update();
    const interval = setInterval(update, 250);
    return () => clearInterval(interval);
  }, [turnDeadline, isMyTurn]);

  const isWarning = secondsLeft !== null && secondsLeft <= 5;
  const isTimedOut = secondsLeft === 0;

  return (
    <div className={`text-center py-1.5 px-3 rounded-lg transition-all duration-300 ${
      isMyTurn
        ? isWarning
          ? 'glass-raised border-[var(--danger)] animate-shake'
          : 'glass-raised animate-pulse-glow border-[var(--gold)]'
        : 'glass'
    }`}>
      <p className={`font-display text-base font-bold ${isMyTurn ? isWarning ? 'text-[var(--danger)]' : 'text-[var(--gold)]' : ''}`}>
        {isTimedOut ? "Time\u2019s up!" : turnLabel}
        <span className={`text-xs font-normal ml-2 ${isWarning ? 'text-[var(--danger)]' : 'text-[var(--gold-dim)]'}`}>
          {phaseLabel}
        </span>
        {secondsLeft !== null && secondsLeft > 0 && (
          <span className={`ml-2 text-sm font-mono ${isWarning ? 'text-[var(--danger)] font-bold' : 'text-[var(--gold-dim)]'}`}>
            {secondsLeft}s
          </span>
        )}
      </p>
    </div>
  );
}
