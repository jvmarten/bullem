import type { Card } from '@bull-em/shared';
import { CardDisplay } from './CardDisplay.js';

export function HandDisplay({ cards, large }: { cards: Card[]; large?: boolean }) {
  if (cards.length === 0) return null;
  const count = cards.length;
  return (
    <div className={`flex justify-center py-2${large ? ' hand-display-large' : ''}`}>
      {cards.map((card, i) => {
        // Fan: rotate each card slightly, centered around 0
        const angle = count === 1 ? 0 : (i - (count - 1) / 2) * 5;
        // Slight vertical arc: middle cards a bit higher
        const lift = count === 1 ? 0 : -Math.abs(i - (count - 1) / 2) * 2;
        return (
          <CardDisplay
            key={`${card.rank}-${card.suit}-${i}`}
            card={card}
            className={`animate-card-deal deal-delay-${i}`}
            style={{
              transform: `rotate(${angle}deg) translateY(${lift}px)`,
              marginLeft: i > 0 ? '-6px' : undefined,
              zIndex: i,
            }}
          />
        );
      })}
    </div>
  );
}
