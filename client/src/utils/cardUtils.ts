import type { Suit, Rank } from '@bull-em/shared';

export const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: '\u2660',
  hearts: '\u2665',
  diamonds: '\u2666',
  clubs: '\u2663',
};

export const SUIT_CSS: Record<Suit, string> = {
  spades: 'suit-black',
  hearts: 'suit-red',
  diamonds: 'suit-red',
  clubs: 'suit-black',
};

/** Four-color deck: clubs green, diamonds blue for easier suit distinction. */
export const SUIT_CSS_FOUR_COLOR: Record<Suit, string> = {
  spades: 'suit-black',
  hearts: 'suit-red',
  diamonds: 'suit-blue',
  clubs: 'suit-green',
};

/** Standard two-color hex values for inline style usage. */
const SUIT_HEX: Record<Suit, string> = {
  spades: '#1a1a1a',
  hearts: '#c0392b',
  diamonds: '#c0392b',
  clubs: '#1a1a1a',
};

/** Four-color hex values for inline style usage. */
const SUIT_HEX_FOUR_COLOR: Record<Suit, string> = {
  spades: '#1a1a1a',
  hearts: '#c0392b',
  diamonds: '#2563eb',
  clubs: '#16803c',
};

/** Returns the hex color for a suit, respecting four-color deck preference. */
export function getSuitHex(suit: Suit, fourColor: boolean): string {
  return fourColor ? SUIT_HEX_FOUR_COLOR[suit] : SUIT_HEX[suit];
}

const AVATAR_COLORS = [
  'bg-amber-700',
  'bg-emerald-700',
  'bg-sky-700',
  'bg-purple-700',
  'bg-rose-700',
  'bg-teal-700',
  'bg-orange-700',
  'bg-indigo-700',
  'bg-pink-700',
];

export function rankDisplay(rank: Rank): string {
  return rank;
}

export function playerInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

export function playerColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length]!;
}
