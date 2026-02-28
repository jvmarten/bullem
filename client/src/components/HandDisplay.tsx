import type { Card } from '@bull-em/shared';
import { CardDisplay } from './CardDisplay.js';

export function HandDisplay({ cards }: { cards: Card[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="flex justify-center gap-1.5 py-1">
      {cards.map((card, i) => (
        <CardDisplay
          key={`${card.rank}-${card.suit}-${i}`}
          card={card}
          className={`animate-card-deal deal-delay-${i}`}
        />
      ))}
    </div>
  );
}
