import type { Suit, Rank } from '@bull-em/shared';

export const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: '\u2660',
  hearts: '\u2665',
  diamonds: '\u2666',
  clubs: '\u2663',
};

export const SUIT_COLORS: Record<Suit, string> = {
  spades: 'text-gray-900',
  hearts: 'text-red-600',
  diamonds: 'text-red-600',
  clubs: 'text-gray-900',
};

export function rankDisplay(rank: Rank): string {
  return rank;
}
