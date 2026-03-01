import type { SpectatorPlayerCards } from '@bull-em/shared';
import { CardDisplay } from './CardDisplay.js';

interface Props {
  spectatorCards: SpectatorPlayerCards[];
}

export function SpectatorView({ spectatorCards }: Props) {
  if (spectatorCards.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold text-center">
        All Players' Cards
      </p>
      {spectatorCards.map(({ playerId, playerName, cards }) => (
        <div key={playerId} className="glass px-3 py-2">
          <p className="text-xs text-[var(--gold-dim)] font-medium mb-1">{playerName}</p>
          <div className="flex gap-1.5 flex-wrap">
            {cards.map((card, i) => (
              <CardDisplay
                key={`${card.rank}-${card.suit}-${i}`}
                card={card}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
