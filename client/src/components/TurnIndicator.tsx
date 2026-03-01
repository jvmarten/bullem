import { useState, useEffect } from 'react';
import { RoundPhase } from '@bull-em/shared';
import type { Player, PlayerId } from '@bull-em/shared';

interface Props {
  currentPlayerId: PlayerId;
  roundPhase: RoundPhase;
  players: Player[];
  myPlayerId: string | null;
  turnDeadline?: number;
}

const PHASE_LABELS: Record<RoundPhase, string> = {
  [RoundPhase.CALLING]: 'Call or Raise',
  [RoundPhase.BULL_PHASE]: 'Bull, True, or Raise',
  [RoundPhase.LAST_CHANCE]: 'Last Chance to Raise',
  [RoundPhase.RESOLVING]: 'Revealing\u2026',
};

function useCountdown(deadline?: number): number | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!deadline) {
      setSecondsLeft(null);
      return;
    }

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(remaining);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  return secondsLeft;
}

export function TurnIndicator({ currentPlayerId, roundPhase, players, myPlayerId, turnDeadline }: Props) {
  const isMyTurn = currentPlayerId === myPlayerId;
  const currentPlayer = players.find((p) => p.id === currentPlayerId);
  const isBotTurn = currentPlayer?.isBot && !isMyTurn;
  const secondsLeft = useCountdown(turnDeadline);

  const turnLabel = isMyTurn
    ? 'Your Turn'
    : `${currentPlayer?.name ?? '\u2026'}\u2019s Turn`;

  const phaseLabel = isBotTurn ? 'Thinking\u2026' : PHASE_LABELS[roundPhase];
  const isUrgent = secondsLeft !== null && secondsLeft <= 5;

  return (
    <div className={`text-center py-1.5 px-3 rounded-lg transition-all duration-300 ${
      isMyTurn
        ? 'glass-raised animate-pulse-glow border-[var(--gold)]'
        : 'glass'
    }`}>
      <p className={`font-display text-base font-bold ${isMyTurn ? 'text-[var(--gold)]' : ''}`}>
        {turnLabel}
        <span className="text-xs font-normal text-[var(--gold-dim)] ml-2">
          {phaseLabel}
        </span>
        {secondsLeft !== null && !isBotTurn && (
          <span className={`text-xs font-semibold ml-2 ${
            isUrgent ? 'text-[var(--danger)] animate-pulse' : 'text-[var(--gold-dim)]'
          }`}>
            {secondsLeft}s
          </span>
        )}
      </p>
    </div>
  );
}
