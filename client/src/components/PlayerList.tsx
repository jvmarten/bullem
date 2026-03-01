import type { Player, PlayerId } from '@bull-em/shared';
import { playerInitial, playerColor } from '../utils/cardUtils.js';

interface Props {
  players: Player[];
  currentPlayerId?: PlayerId;
  myPlayerId?: string | null;
  maxCards?: number;
  showRemoveBot?: boolean;
  onRemoveBot?: (botId: string) => void;
  roundNumber?: number;
}

/* Mini card-back fan: shows card backs matching the player's card count */
function CardBackFan({ count, animate, playerIndex }: { count: number; animate: boolean; playerIndex: number }) {
  if (count <= 0) return null;
  const cards = Array.from({ length: count }, (_, i) => {
    // Fan angle: spread cards slightly, centered around 0
    const angle = count === 1 ? 0 : (i - (count - 1) / 2) * 6;
    const baseDelay = playerIndex * 80; // stagger per player
    const cardDelay = baseDelay + i * 60;   // stagger per card within player
    return (
      <div
        key={i}
        className={`card-back-mini${animate ? ' animate-mini-deal' : ''}`}
        style={{
          transform: `rotate(${angle}deg)`,
          marginLeft: i > 0 ? '-4px' : undefined,
          animationDelay: animate ? `${cardDelay}ms` : undefined,
        }}
      />
    );
  });
  return <div className="flex items-center">{cards}</div>;
}

export function PlayerList({ players, currentPlayerId, myPlayerId, maxCards = 5, showRemoveBot, onRemoveBot, roundNumber }: Props) {
  return (
    <div className="grid grid-cols-2 gap-1">
      {players.map((p, i) => {
        const isMe = p.id === myPlayerId;
        const isCurrent = p.id === currentPlayerId;
        return (
          <div
            key={p.id}
            className={`flex items-center justify-between px-2 py-1 rounded-lg text-sm transition-all duration-200 ${
              p.isEliminated
                ? 'glass opacity-40'
                : isCurrent
                  ? 'glass-raised ring-1 ring-[var(--gold)] animate-pulse-glow'
                  : 'glass'
            }`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <div className={`avatar avatar-sm ${playerColor(i)} ${p.isEliminated ? 'opacity-50' : ''}`}>
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
            <div className="flex items-center gap-1.5 text-xs flex-shrink-0">
              {p.isEliminated ? (
                <span className="text-[var(--danger)] font-bold tracking-wide text-[10px]">OUT</span>
              ) : (
                <>
                  <CardBackFan
                    count={p.cardCount}
                    animate={roundNumber !== undefined}
                    playerIndex={i}
                  />
                  <span className={`font-bold text-xs ${
                    p.cardCount >= maxCards ? 'text-[var(--danger)]' : 'text-[var(--gold-dim)]'
                  }`}>
                    {p.cardCount}/{maxCards}
                  </span>
                </>
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
