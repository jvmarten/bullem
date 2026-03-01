import type { SpectatorPlayerCards } from '@bull-em/shared';
import { HandDisplay } from './HandDisplay.js';

interface SpectatorViewProps {
  spectatorCards: SpectatorPlayerCards[];
}

export function SpectatorView({ spectatorCards }: SpectatorViewProps) {
  if (spectatorCards.length === 0) return null;

  return (
    <div className="space-y-2 animate-fade-in">
      <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold text-center">
        All Players' Cards
      </p>
      <div className="space-y-1.5">
        {spectatorCards.map(({ playerId, playerName, cards }) => (
          <div key={playerId} className="glass px-3 py-1.5">
            <p className="text-xs text-[var(--gold-dim)] font-semibold mb-0.5">
              {playerName}
            </p>
            <HandDisplay cards={cards} />
          </div>
        ))}
      </div>
    </div>
  );
}
