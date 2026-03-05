export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  rank: Rank;
  suit: Suit;
}

/**
 * Hand types in ascending strength order. Note the custom ranking:
 * Flush (3) is LOWER than Three of a Kind (4), and both are LOWER than Straight (5).
 * This differs from standard poker rankings.
 */
export enum HandType {
  HIGH_CARD = 0,
  PAIR = 1,
  TWO_PAIR = 2,
  FLUSH = 3,
  THREE_OF_A_KIND = 4,
  STRAIGHT = 5,
  FULL_HOUSE = 6,
  FOUR_OF_A_KIND = 7,
  STRAIGHT_FLUSH = 8,
  ROYAL_FLUSH = 9,
}

/**
 * Discriminated union representing a hand claim made by a player.
 * Each variant carries the data needed to identify a specific hand
 * (e.g., "pair of 7s" or "straight flush in spades, 5 through 9").
 * Validated on the server via {@link validateHandCall} before use.
 */
export type HandCall =
  | { type: HandType.HIGH_CARD; rank: Rank }
  | { type: HandType.PAIR; rank: Rank }
  | { type: HandType.TWO_PAIR; highRank: Rank; lowRank: Rank }
  | { type: HandType.THREE_OF_A_KIND; rank: Rank }
  | { type: HandType.FLUSH; suit: Suit }
  | { type: HandType.STRAIGHT; highRank: Rank }
  | { type: HandType.FULL_HOUSE; threeRank: Rank; twoRank: Rank }
  | { type: HandType.FOUR_OF_A_KIND; rank: Rank }
  | { type: HandType.STRAIGHT_FLUSH; suit: Suit; highRank: Rank }
  | { type: HandType.ROYAL_FLUSH; suit: Suit };

export type PlayerId = string;

/** A card tagged with its owner — used during round reveal to show which player held which card. */
export interface OwnedCard extends Card {
  playerId: PlayerId;
  playerName: string;
}

/** Public player info sent to all clients. Does NOT include card data. */
export interface Player {
  id: PlayerId;
  name: string;
  cardCount: number;
  isConnected: boolean;
  isEliminated: boolean;
  isHost: boolean;
  isBot?: boolean;
}

/** Server-side player with actual cards. Never sent to other players' clients. */
export interface ServerPlayer extends Player {
  cards: Card[];
}

export enum TurnAction {
  CALL = 'call',
  BULL = 'bull',
  TRUE = 'true',
  LAST_CHANCE_RAISE = 'last_chance_raise',
  LAST_CHANCE_PASS = 'last_chance_pass',
}

/** A single action recorded in a round's turn history. */
export interface TurnEntry {
  playerId: PlayerId;
  playerName: string;
  action: TurnAction;
  /** The hand called (only present for CALL and LAST_CHANCE_RAISE actions). */
  hand?: HandCall;
  timestamp: number;
}

/**
 * Phase within a single round:
 * CALLING → BULL_PHASE → LAST_CHANCE → RESOLVING.
 * A raise resets back to CALLING (or BULL_PHASE for last-chance raises).
 */
export enum RoundPhase {
  CALLING = 'calling',
  BULL_PHASE = 'bull_phase',
  LAST_CHANCE = 'last_chance',
  RESOLVING = 'resolving',
}

/** Top-level game lifecycle: LOBBY → PLAYING ↔ ROUND_RESULT → GAME_OVER. */
export enum GamePhase {
  LOBBY = 'lobby',
  PLAYING = 'playing',
  ROUND_RESULT = 'round_result',
  GAME_OVER = 'game_over',
  FINISHED = 'finished',
}

/** Outcome of a resolved round — sent to all clients for the reveal overlay. */
export interface RoundResult {
  calledHand: HandCall;
  callerId: PlayerId;
  /** Whether the called hand actually exists across all players' combined cards. */
  handExists: boolean;
  /** Cards relevant to the called hand, tagged with ownership for reveal display. */
  revealedCards: OwnedCard[];
  /** Each player's card count after penalties are applied. */
  penalties: Record<PlayerId, number>;
  /** Players who were wrong (called bull on a real hand, or true on a fake one). */
  penalizedPlayerIds: PlayerId[];
  /** Players eliminated this round (exceeded maxCards after penalty). */
  eliminatedPlayerIds: PlayerId[];
  turnHistory?: TurnEntry[];
}

export interface SpectatorPlayerCards {
  playerId: PlayerId;
  playerName: string;
  cards: Card[];
}

/**
 * Game state sent to each client. Personalized per player:
 * - `myCards` contains only this player's cards (anti-cheat)
 * - `spectatorCards` is only populated for eliminated players / spectators
 */
export interface ClientGameState {
  gamePhase: GamePhase;
  players: Player[];
  /** This player's cards only. Other players' cards are never sent. */
  myCards: Card[];
  currentPlayerId: PlayerId;
  startingPlayerId: PlayerId;
  currentHand: HandCall | null;
  lastCallerId: PlayerId | null;
  roundPhase: RoundPhase;
  turnHistory: TurnEntry[];
  roundNumber: number;
  maxCards: number;
  roundResult?: RoundResult | null;
  /** Unix timestamp (ms) when the current turn expires. Null if no timer. */
  turnDeadline?: number | null;
  /** All active players' cards — only sent to eliminated players acting as spectators. */
  spectatorCards?: SpectatorPlayerCards[];
}

export enum BotDifficulty {
  NORMAL = 'normal',
  HARD = 'hard',
  IMPOSSIBLE = 'impossible',
}

export enum BotSpeed {
  SLOW = 'slow',
  NORMAL = 'normal',
  FAST = 'fast',
}

/** Controls what happens after a last chance raise.
 *  - 'classic': enters BULL_PHASE — all responders get bull/true/raise (current behavior).
 *  - 'strict': enters CALLING — first responder can only bull/raise. True unlocks after a bull is called. */
export type LastChanceMode = 'classic' | 'strict';

/** Configurable game settings, set by the host in the lobby. */
export interface GameSettings {
  /** Maximum cards a player can hold before elimination (1–5, default 5). */
  maxCards: number;
  /** Turn timer in seconds (0 = disabled). Online games require a timer (15/30/60s). */
  turnTimer: number;
  /** Player cap for the room (2–12). Also limited by deck size / maxCards. */
  maxPlayers?: number;
  /** Whether external spectators can join and watch the game. */
  allowSpectators?: boolean;
  /** Whether spectators can see player cards. If false, spectators see the game but not cards. */
  spectatorsCanSeeCards?: boolean;
  /** Bot playing speed — affects delay between bot turns. Defaults to 'normal'. */
  botSpeed?: BotSpeed;
  /** Last chance raise rules. Defaults to 'classic'. */
  lastChanceMode?: LastChanceMode;
}

export interface PlayerGameStats {
  bullsCalled: number;
  truesCalled: number;
  callsMade: number;
  correctBulls: number;
  correctTrues: number;
  bluffsSuccessful: number;
  roundsSurvived: number;
}

export interface GameStats {
  totalRounds: number;
  playerStats: Record<PlayerId, PlayerGameStats>;
}

/** Serializable snapshot of a GameEngine for persistence (e.g., local game save/restore). */
export interface GameEngineSnapshot {
  players: ServerPlayer[];
  settings: GameSettings;
  roundNumber: number;
  roundPhase: RoundPhase;
  currentPlayerIndex: number;
  currentHand: HandCall | null;
  lastCallerId: PlayerId | null;
  turnHistory: TurnEntry[];
  startingPlayerIndex: number;
  respondedPlayers: PlayerId[];
  lastChanceUsed: boolean;
  gameStats: GameStats;
}

/** Room info broadcast to all clients in the room (lobby and during game). */
export interface RoomState {
  roomCode: string;
  players: Player[];
  hostId: PlayerId;
  gamePhase: GamePhase;
  settings: GameSettings;
  /** Number of external spectators currently watching this game. */
  spectatorCount: number;
}

/** Summary of a room in the lobby browser (rooms waiting for players). */
export interface RoomListing {
  roomCode: string;
  playerCount: number;
  maxPlayers: number;
  hostName: string;
  settings: GameSettings;
}

// ── Auth types ──────────────────────────────────────────────────────────

/** Authenticated user stored in the database. Never send password_hash to clients. */
export interface User {
  id: string;
  username: string;
  displayName: string;
  email: string;
  authProvider: 'email';
  createdAt: string;
  lastSeenAt: string;
}

/** Public-facing profile (safe to send to any client). */
export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  createdAt: string;
  gamesPlayed: number;
  gamesWon: number;
  /** Percentage of correct bull calls (0–100). Null if no bulls called. */
  bullAccuracy: number | null;
  /** Percentage of bluffs that were not called out (0–100). Null if no bluffs. */
  bluffSuccessRate: number | null;
}

/** Response body for POST /auth/register and POST /auth/login. */
export interface AuthResponse {
  user: Omit<User, 'email'> & { email: string };
}

/** Summary of an in-progress game available for spectating. */
export interface LiveGameListing {
  roomCode: string;
  playerCount: number;
  hostName: string;
  roundNumber: number;
  spectatorsCanSeeCards: boolean;
  /** Number of external spectators currently watching. */
  spectatorCount: number;
}
