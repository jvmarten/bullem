import type { Suit, Rank, AvatarBgColor } from '@bull-em/shared';

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

/** Maps user-chosen AvatarBgColor to Tailwind CSS background class. */
const AVATAR_BG_COLOR_MAP: Record<AvatarBgColor, string> = {
  amber: 'bg-amber-700',
  emerald: 'bg-emerald-700',
  sky: 'bg-sky-700',
  purple: 'bg-purple-700',
  rose: 'bg-rose-700',
  teal: 'bg-teal-700',
  orange: 'bg-orange-700',
  indigo: 'bg-indigo-700',
  pink: 'bg-pink-700',
};

/** Returns the Tailwind bg class for a player.
 *  If the player has a chosen avatarBgColor, use it; otherwise fall back to index-based color. */
export function playerColor(index: number, avatarBgColor?: AvatarBgColor | null): string {
  if (avatarBgColor && avatarBgColor in AVATAR_BG_COLOR_MAP) {
    return AVATAR_BG_COLOR_MAP[avatarBgColor];
  }
  return AVATAR_COLORS[index % AVATAR_COLORS.length]!;
}

/** Returns the hex value for an avatar background color (for CSS vars / inline styles). */
export const AVATAR_BG_COLOR_HEX: Record<AvatarBgColor, string> = {
  amber: '#b45309',
  emerald: '#047857',
  sky: '#0369a1',
  purple: '#7e22ce',
  rose: '#be123c',
  teal: '#0f766e',
  orange: '#c2410c',
  indigo: '#4338ca',
  pink: '#be185d',
};
