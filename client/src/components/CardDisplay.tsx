import type { Card } from '@bull-em/shared';
import { SUIT_SYMBOLS, SUIT_COLORS, rankDisplay } from '../utils/cardUtils.js';

export function CardDisplay({ card, small }: { card: Card; small?: boolean }) {
  if (small) {
    return (
      <div className="inline-flex items-center gap-0.5 bg-white rounded px-1.5 py-0.5 shadow-sm border border-gray-200">
        <span className={`text-sm font-bold ${SUIT_COLORS[card.suit]}`}>
          {rankDisplay(card.rank)}
        </span>
        <span className={`text-sm ${SUIT_COLORS[card.suit]}`}>
          {SUIT_SYMBOLS[card.suit]}
        </span>
      </div>
    );
  }

  return (
    <div className="inline-flex flex-col items-center justify-center w-14 h-20 bg-white rounded-lg shadow-md border border-gray-300 mx-0.5 select-none">
      <span className={`text-lg font-bold leading-tight ${SUIT_COLORS[card.suit]}`}>
        {rankDisplay(card.rank)}
      </span>
      <span className={`text-xl leading-tight ${SUIT_COLORS[card.suit]}`}>
        {SUIT_SYMBOLS[card.suit]}
      </span>
    </div>
  );
}
