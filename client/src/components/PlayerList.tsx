import type { Player, PlayerId } from '@bull-em/shared';
import { playerInitial, playerColor } from '../utils/cardUtils.js';

interface Props {
  players: Player[];
  currentPlayerId?: PlayerId;
  myPlayerId?: string | null;
}

export function PlayerList({ players, currentPlayerId, myPlayerId }: Props) {
  return (
    <div className="space-y-1.5">
      {players.map((p, i) => {
        const isMe = p.id === myPlayerId;
        const isCurrent = p.id === currentPlayerId;
        return (
          <div
            key={p.id}
            className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${
              p.isEliminated
                ? 'glass opacity-40'
                : isCurrent
                  ? 'glass-raised ring-1 ring-[var(--gold)] animate-pulse-glow'
                  : 'glass'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className={`avatar ${playerColor(i)} ${p.isEliminated ? 'opacity-50' : ''}`}>
                {playerInitial(p.name)}
              </div>
              <div className="flex flex-col">
                <span className="font-medium truncate">
                  {p.name}
                  {isMe && <span className="text-[var(--gold)] ml-1 text-xs">(you)</span>}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className={p.isEliminated ? 'hidden' : p.isConnected ? 'dot-connected' : 'dot-disconnected'} />
                  {p.isHost && (
                    <span className="text-[10px] text-[var(--gold-dim)] uppercase tracking-wider font-semibold">
                      host
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs flex-shrink-0">
              {p.isEliminated ? (
                <span className="text-[var(--danger)] font-bold tracking-wide">OUT</span>
              ) : (
                <>
                  {Array.from({ length: p.cardCount }, (_, j) => (
                    <span key={j} className="card-back-mini" />
                  ))}
                  {p.cardCount >= 4 && (
                    <span className={`ml-1 font-bold ${
                      p.cardCount === 5 ? 'text-[var(--danger)]' : 'text-[var(--gold)]'
                    }`}>
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
