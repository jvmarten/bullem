import { RoundPhase } from '@bull-em/shared';
import type { Player, PlayerId } from '@bull-em/shared';

interface Props {
  currentPlayerId: PlayerId;
  roundPhase: RoundPhase;
  players: Player[];
  myPlayerId: string | null;
}

const PHASE_LABELS: Record<RoundPhase, string> = {
  [RoundPhase.CALLING]: 'Call or Raise',
  [RoundPhase.BULL_PHASE]: 'Bull, True, or Raise',
  [RoundPhase.LAST_CHANCE]: 'Last Chance to Raise',
  [RoundPhase.RESOLVING]: 'Revealing\u2026',
};

export function TurnIndicator({ currentPlayerId, roundPhase, players, myPlayerId }: Props) {
  const isMyTurn = currentPlayerId === myPlayerId;
  const currentPlayer = players.find((p) => p.id === currentPlayerId);
  const isBotTurn = currentPlayer?.isBot && !isMyTurn;

  const turnLabel = isMyTurn
    ? 'Your Turn'
    : `${currentPlayer?.name ?? '\u2026'}\u2019s Turn`;

  const phaseLabel = isBotTurn ? 'Thinking\u2026' : PHASE_LABELS[roundPhase];

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
      </p>
    </div>
  );
}
