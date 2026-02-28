import type { Player, PlayerId } from '@bull-em/shared';

interface Props {
  players: Player[];
  currentPlayerId?: PlayerId;
  myPlayerId?: string | null;
}

export function PlayerList({ players, currentPlayerId, myPlayerId }: Props) {
  return (
    <div className="space-y-1">
      {players.map((p) => (
        <div
          key={p.id}
          className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
            p.isEliminated
              ? 'bg-red-900/40 opacity-50'
              : p.id === currentPlayerId
                ? 'bg-yellow-600/30 ring-1 ring-yellow-400'
                : 'bg-green-800/50'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${p.isConnected ? 'bg-green-400' : 'bg-gray-500'}`} />
            <span className="font-medium">
              {p.name}
              {p.id === myPlayerId && ' (you)'}
              {p.isHost && ' *'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-green-300">
            {p.isEliminated ? (
              <span className="text-red-400">OUT</span>
            ) : (
              <span>{p.cardCount} {p.cardCount === 1 ? 'card' : 'cards'}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
