import type { Player, PlayerId } from '@bull-em/shared';
import { playerInitial, playerColor } from '../utils/cardUtils.js';

interface Props {
  players: Player[];
  currentPlayerId?: PlayerId;
  myPlayerId?: string | null;
  showRemoveBot?: boolean;
  onRemoveBot?: (botId: string) => void;
}

export function PlayerList({ players, currentPlayerId, myPlayerId, showRemoveBot, onRemoveBot }: Props) {
  return (
    <div className="space-y-0.5">
      {players.map((p, i) => {
        const isMe = p.id === myPlayerId;
        const isCurrent = p.id === currentPlayerId;
        return (
          <div
            key={p.id}
            className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-all duration-200 ${
              p.isEliminated
                ? 'glass opacity-40'
                : isCurrent
                  ? 'glass-raised ring-1 ring-[var(--gold)] animate-pulse-glow'
                  : 'glass'
            }`}
          >
            <div className="flex items-center gap-2">
              <div className={`avatar ${playerColor(i)} ${p.isEliminated ? 'opacity-50' : ''}`}>
                {p.isBot ? '\u2699' : playerInitial(p.name)}
              </div>
              <div className="flex flex-col">
                <span className="font-medium truncate text-xs">
                  {p.name}
                  {isMe && <span className="text-[var(--gold)] ml-1 text-[10px]">(you)</span>}
                  {p.isBot && <span className="text-[var(--gold-dim)] ml-1 text-[10px]">[BOT]</span>}
                </span>
                <div className="flex items-center gap-1">
                  <span className={p.isEliminated ? 'hidden' : p.isConnected ? 'dot-connected' : 'dot-disconnected'} />
                  {p.isHost && (
                    <span className="text-[9px] text-[var(--gold-dim)] uppercase tracking-wider font-semibold">
                      host
                    </span>
                  )}
                  {p.isBot && isCurrent && !p.isEliminated && (
                    <span className="text-[9px] italic text-[var(--gold-dim)] animate-pulse">
                      thinking&hellip;
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs flex-shrink-0">
              {p.isEliminated ? (
                <span className="text-[var(--danger)] font-bold tracking-wide text-[10px]">OUT</span>
              ) : (
                <span className={`font-bold text-xs ${
                  p.cardCount === 5 ? 'text-[var(--danger)]' : 'text-[var(--gold-dim)]'
                }`}>
                  {p.cardCount}/{5}
                </span>
              )}
              {showRemoveBot && p.isBot && onRemoveBot && (
                <button
                  onClick={() => onRemoveBot(p.id)}
                  className="text-[var(--danger)] hover:text-red-400 transition-colors text-xs ml-1"
                  title="Remove bot"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
