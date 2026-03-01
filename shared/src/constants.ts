import type { Rank, Suit } from './types.js';

export const RANK_VALUES: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

export const SUIT_ORDER: Record<Suit, number> = {
  clubs: 0, diamonds: 1, hearts: 2, spades: 3,
};

export const ALL_RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const ALL_SUITS: Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;
export const MAX_CARDS = 5;
export const MIN_MAX_CARDS = 1;
export const STARTING_CARDS = 1;
export const DECK_SIZE = 52;

export function maxPlayersForMaxCards(maxCards: number): number {
  return Math.floor(DECK_SIZE / maxCards);
}

export const DEFAULT_TURN_TIMER_SECONDS = 30;
export const DEFAULT_GAME_SETTINGS = { maxCards: MAX_CARDS } as const;
export const DISCONNECT_TIMEOUT_MS = 30_000;
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
export const ROOM_MAX_INACTIVE_MS = 10 * 60 * 1000;

export const BOT_THINK_DELAY_MIN = 1500;
export const BOT_THINK_DELAY_MAX = 4000;

export const DEFAULT_BOT_DIFFICULTY = 'easy' as const;
export const BOT_NAMES = [
  'Bot Brady', 'RoboBluff', 'CPU Carl', 'Digital Dave',
  'Silicon Sam', 'Byte Betty', 'Chip Charlie', 'Data Diana',
];
