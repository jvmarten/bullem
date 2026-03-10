import type { Rank, Suit, BotSpeed, JokerCount } from './types.js';

/** Numeric value for each rank (2=2, ..., A=14). Used for hand comparison ordering. */
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

/** Number of jokers in the deck. Valid values: 0, 1, 2. */
export const JOKER_COUNT_OPTIONS: readonly JokerCount[] = [0, 1, 2] as const;
export const DEFAULT_JOKER_COUNT: JokerCount = 0;

/** Effective deck size including jokers. */
export function getDeckSize(jokerCount: JokerCount = 0): number {
  return DECK_SIZE + jokerCount;
}

/** Max players is limited by deck size — each player needs at least maxCards cards. */
export function maxPlayersForMaxCards(maxCards: number, jokerCount: JokerCount = 0): number {
  return Math.floor(getDeckSize(jokerCount) / maxCards);
}

export const TURN_TIMER_OPTIONS = [0, 15, 30, 60] as const; // 0 = no timer (local only)
export const DEFAULT_TURN_TIMER = 0;
export const ONLINE_TURN_TIMER_OPTIONS = [15, 30, 60] as const; // online requires a timer
export const DEFAULT_ONLINE_TURN_TIMER = 30;
export const MAX_PLAYERS_OPTIONS = [2, 3, 4, 5, 6, 8, 10, 12] as const;
export const LAST_CHANCE_MODES = ['classic', 'strict'] as const;

// Best-of series options for 1v1 games
export const BEST_OF_OPTIONS = [1, 3, 5] as const;
/** Default best-of for unranked 1v1. */
export const DEFAULT_BEST_OF = 1;
/** Forced best-of for ranked 1v1 (always Bo3). */
export const RANKED_BEST_OF = 3;
/** Delay between sets in a series (ms) — shows transition screen. */
export const SERIES_TRANSITION_DELAY_MS = 5_000;
export const DEFAULT_GAME_SETTINGS: { maxCards: number; turnTimer: number; botLevelCategory: 'mixed' } = { maxCards: MAX_CARDS, turnTimer: DEFAULT_TURN_TIMER, botLevelCategory: 'mixed' };
export const DEFAULT_ONLINE_GAME_SETTINGS: { maxCards: number; turnTimer: number; maxPlayers: number } = { maxCards: MAX_CARDS, turnTimer: DEFAULT_ONLINE_TURN_TIMER, maxPlayers: MAX_PLAYERS };
/** How long a disconnected player has to reconnect before being eliminated (ms).
 *  Set to 3 minutes — generous enough for browser restarts, app switches, and
 *  brief network outages. The game continues for other players (auto-pass for
 *  the disconnected player's turns) so this doesn't stall gameplay. */
export const DISCONNECT_TIMEOUT_MS = 180_000;
export const ROOM_CODE_LENGTH = 4;
export const PLAYER_NAME_MAX_LENGTH = 20;
/** Allowed characters in player names (alphanumeric, spaces, common punctuation). */
export const PLAYER_NAME_PATTERN = /^[a-zA-Z0-9 _\-'.!?]+$/;

// Bot delay ranges (ms) — jittered within these bounds for human-like timing
export const BOT_THINK_DELAY_MIN = 1500;
export const BOT_THINK_DELAY_MAX = 4000;
export const BOT_BULL_DELAY_MIN = 400;
export const BOT_BULL_DELAY_MAX = 1200;

/** Interval for checking and cleaning up stale/empty rooms. */
export const ROOM_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
/** Rooms with no activity for this duration are cleaned up. */
export const ROOM_MAX_INACTIVE_MS = 10 * 60 * 1000; // 10 minutes

export const DEFAULT_BOT_DIFFICULTY = 'hard' as const;
export const DEFAULT_BOT_SPEED = 'normal' as const;

/** Delay multipliers for bot playing speed. Applied to both think and bull delays. */
export const BOT_SPEED_MULTIPLIERS: Record<BotSpeed, number> = {
  slow: 1.6,
  normal: 1.0,
  fast: 0.4,
};
/** @deprecated Use BOT_PROFILES from botProfiles.ts instead. Kept for migration compatibility. */
export const BOT_NAMES = [
  'Bot Brady', 'RoboBluff', 'CPU Carl', 'Digital Dave',
  'Silicon Sam', 'Byte Betty', 'Chip Charlie', 'Data Diana',
];

// ── Chat constants ──────────────────────────────────────────────────────────

/** Maximum length of a chat message (characters). */
export const CHAT_MESSAGE_MAX_LENGTH = 200;
/** Minimum interval between chat messages per sender (ms). */
export const CHAT_RATE_LIMIT_MS = 2000;
/** Allowed characters in chat messages (printable ASCII + common punctuation). */
export const CHAT_MESSAGE_PATTERN = /^[a-zA-Z0-9 _\-'.!?,;:()@#&+="/<>*\[\]{}|\\~`$%^]+$/;

// ── Matchmaking constants ──────────────────────────────────────────────────

/** How often the matching algorithm runs (ms). */
export const MATCHMAKING_INTERVAL_MS = 2500;
/** Base Elo window: two players must be within ±this to match in heads-up. */
export const MATCHMAKING_ELO_WINDOW = 150;
/** After this many seconds in queue, widen the matching window by 50%. */
export const MATCHMAKING_WIDEN_AFTER_SECONDS = 15;
/** After this many seconds, match with a rated bot instead of waiting. */
export const MATCHMAKING_BOT_BACKFILL_SECONDS = 30;
/** Target player count for multiplayer matchmaking. */
export const MATCHMAKING_MULTIPLAYER_TARGET = 4;
/** Minimum players to start a multiplayer match (including bot backfill). */
export const MATCHMAKING_MULTIPLAYER_MIN = 3;
/** Maximum players in a multiplayer match. */
export const MATCHMAKING_MULTIPLAYER_MAX = 9;
/** Countdown after enough players found before starting a multiplayer match (ms). */
export const MATCHMAKING_COUNTDOWN_MS = 10_000;
/** Countdown shown to players after match is found (ms). */
export const MATCHMAKING_FOUND_COUNTDOWN_MS = 4_000;
/** How often to send queue status updates to waiting players (ms). */
export const MATCHMAKING_STATUS_INTERVAL_MS = 5_000;
/** Elo spread for multiplayer matching (analogous to ±3σ in OpenSkill).
 *  Players within this range of each other are considered compatible. */
export const MATCHMAKING_MULTIPLAYER_ELO_SPREAD = 400;
