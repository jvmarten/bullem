import type { Card } from '@bull-em/shared';
import { SUIT_SYMBOLS, SUIT_COLORS, rankDisplay } from '../utils/cardUtils.js';

export function CardDisplay({ card }: { card: Card }) {
  return (
    <div className="inline-flex flex-col items-center justify-center w-14 h-20 bg-white rounded-lg shadow-md border border-gray-300 mx-0.5">
      <span className={`text-lg font-bold ${SUIT_COLORS[card.suit]}`}>
        {rankDisplay(card.rank)}
      </span>
      <span className={`text-xl ${SUIT_COLORS[card.suit]}`}>
        {SUIT_SYMBOLS[card.suit]}
      </span>
    </div>
  );
}
