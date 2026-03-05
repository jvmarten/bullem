import type { Rank, Suit, BotSpeed } from './types.js';

export const RANK_VALUES: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

/** Suit tiebreaker for straight flushes (only hand type where suit matters for ordering). */
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

/** Max players is limited by deck size — each player needs at least maxCards cards. */
export function maxPlayersForMaxCards(maxCards: number): number {
  return Math.floor(DECK_SIZE / maxCards);
}

export const TURN_TIMER_OPTIONS = [0, 15, 30, 60] as const; // 0 = no timer (local only)
export const DEFAULT_TURN_TIMER = 0;
export const ONLINE_TURN_TIMER_OPTIONS = [15, 30, 60] as const; // online requires a timer
export const DEFAULT_ONLINE_TURN_TIMER = 30;
export const MAX_PLAYERS_OPTIONS = [2, 3, 4, 5, 6, 8, 10, 12] as const;
export const DEFAULT_LAST_CHANCE_MODE = 'classic' as const;
export const DEFAULT_GAME_SETTINGS: { maxCards: number; turnTimer: number } = { maxCards: MAX_CARDS, turnTimer: DEFAULT_TURN_TIMER };
export const DEFAULT_ONLINE_GAME_SETTINGS: { maxCards: number; turnTimer: number; maxPlayers: number } = { maxCards: MAX_CARDS, turnTimer: DEFAULT_ONLINE_TURN_TIMER, maxPlayers: MAX_PLAYERS };
export const DISCONNECT_TIMEOUT_MS = 30_000;
export const ROOM_CODE_LENGTH = 4;
export const PLAYER_NAME_MAX_LENGTH = 20;
export const PLAYER_NAME_PATTERN = /^[a-zA-Z0-9 _\-'.!?]+$/;

export const BOT_THINK_DELAY_MIN = 1500;
export const BOT_THINK_DELAY_MAX = 4000;
export const BOT_BULL_DELAY_MIN = 400;
export const BOT_BULL_DELAY_MAX = 1200;

export const ROOM_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
export const ROOM_MAX_INACTIVE_MS = 10 * 60 * 1000; // 10 minutes

export const DEFAULT_BOT_DIFFICULTY = 'hard' as const;
export const DEFAULT_BOT_SPEED = 'normal' as const;

/** Delay multipliers for bot playing speed. Applied to both think and bull delays. */
export const BOT_SPEED_MULTIPLIERS: Record<BotSpeed, number> = {
  slow: 1.6,
  normal: 1.0,
  fast: 0.4,
};
export const BOT_NAMES = [
  'Bot Brady', 'RoboBluff', 'CPU Carl', 'Digital Dave',
  'Silicon Sam', 'Byte Betty', 'Chip Charlie', 'Data Diana',
];
