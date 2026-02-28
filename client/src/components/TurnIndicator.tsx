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
  [RoundPhase.RESOLVING]: 'Revealing...',
};

export function TurnIndicator({ currentPlayerId, roundPhase, players, myPlayerId }: Props) {
  const isMyTurn = currentPlayerId === myPlayerId;
  const currentPlayer = players.find((p) => p.id === currentPlayerId);

  return (
    <div className={`text-center py-3 rounded-lg transition-all duration-300 ${
      isMyTurn ? 'bg-yellow-600/30 animate-pulse-glow' : 'bg-green-800/30'
    }`}>
      <p className="text-lg font-bold">
        {isMyTurn ? 'Your Turn' : `${currentPlayer?.name ?? '...'}'s Turn`}
      </p>
      <p className="text-sm text-green-300">{PHASE_LABELS[roundPhase]}</p>
    </div>
  );
}
