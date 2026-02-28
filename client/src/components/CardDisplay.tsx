import type { Card } from '@bull-em/shared';
import { SUIT_SYMBOLS, SUIT_CSS, rankDisplay } from '../utils/cardUtils.js';

export function CardDisplay({ card, small, className = '' }: { card: Card; small?: boolean; className?: string }) {
  const suitColor = SUIT_CSS[card.suit];

  if (small) {
    return (
      <span className={`playing-card-small inline-flex items-center gap-0.5 px-1.5 py-0.5 ${className}`}>
        <span className={`text-sm font-bold ${suitColor}`}>{rankDisplay(card.rank)}</span>
        <span className={`text-sm ${suitColor}`}>{SUIT_SYMBOLS[card.suit]}</span>
      </span>
    );
  }

  return (
    <div className={`playing-card inline-flex flex-col items-center justify-center w-10 h-14 mx-0.5 select-none ${className}`}>
      <span className={`text-sm font-bold leading-tight ${suitColor}`}>
        {rankDisplay(card.rank)}
      </span>
      <span className={`text-base leading-tight ${suitColor}`}>
        {SUIT_SYMBOLS[card.suit]}
      </span>
    </div>
  );
}
