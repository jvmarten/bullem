import type { Player, PlayerId } from '@bull-em/shared';

interface Props {
  players: Player[];
  currentPlayerId?: PlayerId;
  myPlayerId?: string | null;
}

export function PlayerList({ players, currentPlayerId, myPlayerId }: Props) {
  return (
    <div className="space-y-1">
      {players.map((p) => {
        const isMe = p.id === myPlayerId;
        const isCurrent = p.id === currentPlayerId;
        return (
          <div
            key={p.id}
            className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
              p.isEliminated
                ? 'bg-red-900/30 opacity-50'
                : isCurrent
                  ? 'bg-yellow-600/30 ring-1 ring-yellow-400'
                  : 'bg-green-800/40'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                p.isEliminated ? 'bg-red-500' :
                p.isConnected ? 'bg-green-400' : 'bg-gray-500 animate-pulse'
              }`} />
              <span className="font-medium truncate">
                {p.name}
                {isMe && <span className="text-green-400"> (you)</span>}
              </span>
              {p.isHost && (
                <span className="text-[10px] bg-yellow-600/40 text-yellow-300 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                  host
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 text-xs text-green-300 flex-shrink-0">
              {p.isEliminated ? (
                <span className="text-red-400 font-bold">OUT</span>
              ) : (
                <>
                  {Array.from({ length: p.cardCount }, (_, i) => (
                    <span key={i} className="w-3 h-4 bg-green-600 rounded-sm border border-green-500 inline-block" />
                  ))}
                  {p.cardCount >= 4 && (
                    <span className={`ml-1 font-bold ${p.cardCount === 5 ? 'text-red-400' : 'text-yellow-400'}`}>
                      {p.cardCount}/5
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
