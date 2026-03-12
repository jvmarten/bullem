export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  rank: Rank;
  suit: Suit;
  /** True if this card is a joker (wild — can substitute for any card). */
  isJoker?: boolean;
}

/** Number of jokers to include in the deck (0 = standard 52-card deck). */
export type JokerCount = 0 | 1 | 2;

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
  isAdmin?: boolean;
  /** Authenticated user ID — present for logged-in players, absent for guests/bots. */
  userId?: string;
  /** Authenticated username — present for logged-in players, absent for guests. */
  username?: string;
  /** User-chosen avatar template. Null/undefined for guests or players without an avatar. */
  avatar?: AvatarId | null;
  /** Custom profile photo URL (Tigris object storage). Takes priority over emoji avatar when present. */
  photoUrl?: string | null;
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
  /** Full intended turn duration in ms. Used by TileMeter so the countdown
   *  speed is consistent regardless of when the component mounts. */
  turnDurationMs?: number | null;
  /** All active players' cards — only sent to eliminated players acting as spectators. */
  spectatorCards?: SpectatorPlayerCards[];
  /** Series info for best-of matches. Null for single games. */
  seriesInfo?: SeriesInfo | null;
  /** Whether this game is a ranked match. */
  ranked?: boolean;
}

export enum BotDifficulty {
  NORMAL = 'normal',
  HARD = 'hard',
  IMPOSSIBLE = 'impossible',
}

/** Bot level categories for match settings. Controls which bot levels (1-9) are used. */
export type BotLevelCategory = 'easy' | 'normal' | 'hard' | 'mixed';

export enum BotSpeed {
  SLOW = 'slow',
  NORMAL = 'normal',
  FAST = 'fast',
}

/** Controls what happens after a last chance raise.
 *  - 'classic': enters BULL_PHASE — all responders get bull/true/raise (current behavior).
 *  - 'strict': enters CALLING — first responder can only bull/raise. True unlocks after a bull is called. */
export type LastChanceMode = 'classic' | 'strict';

/** Best-of series options for 1v1 games. */
export type BestOf = 1 | 3 | 5;

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
  /** Whether this game is a ranked match. */
  ranked?: boolean;
  /** Which ranked queue this game belongs to (set server-side based on player count). */
  rankedMode?: RankedMode;
  /** Best-of series length for 1v1 games. Ranked 1v1 = always Bo3.
   *  Unranked 1v1 (maxPlayers=2): host can choose Bo1/Bo3/Bo5. Default Bo1.
   *  Multiplayer (3+): always single game (ignored). */
  bestOf?: BestOf;
  /** Bot level category — controls which bot levels are used.
   *  'easy' = lvl 1-3, 'normal' = lvl 4-6, 'hard' = lvl 7-9 (includes CFR bots),
   *  'mixed' = lvl 1-9. Defaults to 'normal'. */
  botLevelCategory?: BotLevelCategory;
  /** Number of joker (wild) cards in the deck: 0, 1, or 2. Defaults to 0 (standard 52-card deck).
   *  Jokers act as wildcards — they can substitute for any card when checking hand existence. */
  jokerCount?: JokerCount;
}

// ── Series (Best-of) types ────────────────────────────────────────────

/** Tracks the state of a best-of series across multiple sets (individual games). */
export interface SeriesState {
  /** Best-of value: 1, 3, or 5. */
  bestOf: BestOf;
  /** Current set number (1-based). */
  currentSet: number;
  /** Wins per player. Keys are player IDs. */
  wins: Record<PlayerId, number>;
  /** Number of wins needed to clinch the series. */
  winsNeeded: number;
  /** Player ID of the series winner (null if series still in progress). */
  seriesWinnerId: PlayerId | null;
  /** The two player IDs in the series (for 1v1). */
  playerIds: [PlayerId, PlayerId];
}

/** Summary sent to clients during a series match. */
export interface SeriesInfo {
  bestOf: BestOf;
  currentSet: number;
  wins: Record<PlayerId, number>;
  winsNeeded: number;
  seriesWinnerId: PlayerId | null;
}

export interface PlayerGameStats {
  bullsCalled: number;
  truesCalled: number;
  callsMade: number;
  correctBulls: number;
  correctTrues: number;
  bluffsSuccessful: number;
  roundsSurvived: number;
  /** Per-hand-type breakdown. Optional for backwards compatibility with old game records. */
  handBreakdown?: HandTypeBreakdownEntry[];
}

/** Per-hand-type stats recorded per game per player. */
export interface HandTypeBreakdownEntry {
  /** HandType enum value (0–9). */
  handType: number;
  /** Times this player called this hand type. */
  called: number;
  /** Of those calls, how many times the hand actually existed across all cards. */
  existed: number;
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
  /** ID of the player who started the current round. Added to fix starting
   *  player rotation when the starter is eliminated mid-round. Optional for
   *  backwards compatibility with snapshots created before this field existed. */
  startingPlayerId?: PlayerId;
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

/** Pre-defined avatar template identifiers users can choose from. */
export const AVATAR_OPTIONS = [
  'bull', 'ace', 'crown', 'diamond', 'skull',
  'star', 'wolf', 'eagle', 'lion', 'fox', 'bear',
] as const;

export type AvatarId = typeof AVATAR_OPTIONS[number];

/** Authenticated user stored in the database. Never send password_hash to clients. */
export interface User {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: 'user' | 'admin';
  authProvider: 'email' | 'google' | 'apple' | 'email+google' | 'email+apple';
  avatar: AvatarId | null;
  /** Optional custom profile photo URL (set by admin). */
  photoUrl?: string | null;
  createdAt: string;
  lastSeenAt: string;
  /** True for bot accounts seeded in the database. */
  isBot?: boolean;
  /** Profile key referencing a BotProfileDefinition (only set for bot accounts). */
  botProfile?: string | null;
}

/** Public-facing profile (safe to send to any client). */
export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  avatar: AvatarId | null;
  /** Optional custom profile photo URL (set by admin). */
  photoUrl?: string | null;
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

/** Aggregated player statistics returned by GET /api/stats/:userId. */
export interface PlayerStatsResponse {
  userId: string;
  gamesPlayed: number;
  wins: number;
  winRate: number | null;
  avgFinishPosition: number | null;
  /** Normalized finish percentile (0–100). 100 = always 1st, 0 = always last.
   *  Accounts for game size so 2nd/2 isn't equated with 2nd/8. */
  avgFinishPercentile?: number | null;
  bullAccuracy: number | null;
  trueAccuracy: number | null;
  bluffSuccessRate: number | null;
  rankedGamesPlayed: number;
  gamesByPlayerCount: Record<string, number>;
  recentGames: GameHistoryEntry[];
}

/** A completed game in a user's game history. */
export interface GameHistoryEntry {
  id: string;
  roomCode: string;
  winnerName: string;
  playerCount: number;
  settings: GameSettings;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  finishPosition: number;
  playerName: string;
  finalCardCount: number;
  stats: PlayerGameStats;
  /** Whether this game was a ranked match. */
  isRanked: boolean;
  /** Rating change from this game (positive = gained, negative = lost). Null for non-ranked games. */
  ratingChange: number | null;
}

/**
 * Serializable push subscription matching the browser's PushSubscription.toJSON().
 * Defined here so both client and server can use it without DOM types.
 */
export interface PushSubscriptionJSON {
  endpoint: string;
  keys?: { p256dh: string; auth: string };
}

// ── Rating types ────────────────────────────────────────────────────────

/** Which ranked queue a game belongs to. */
export type RankedMode = 'heads_up' | 'multiplayer';

/** Elo rating for heads-up (1v1) games. */
export interface EloRating {
  mode: 'heads_up';
  elo: number;
  gamesPlayed: number;
  peakRating: number;
  lastUpdated: string;
}

/** OpenSkill (mu/sigma) rating for multiplayer (3-9 player) games. */
export interface OpenSkillRating {
  mode: 'multiplayer';
  mu: number;
  sigma: number;
  gamesPlayed: number;
  peakRating: number;
  lastUpdated: string;
}

export type PlayerRating = EloRating | OpenSkillRating;

/** Response body for GET /api/ratings/:userId. */
export interface UserRatings {
  userId: string;
  headsUp: EloRating | null;
  multiplayer: OpenSkillRating | null;
}

// ── Matchmaking types ────────────────────────────────────────────────────

/** Status update sent while a player is in the matchmaking queue. */
export interface MatchmakingStatus {
  /** Approximate position in the queue (1-based). */
  position: number;
  /** Estimated wait time in seconds. -1 if unknown. */
  estimatedWaitSeconds: number;
  /** Which queue the player is in. */
  mode: RankedMode;
}

/** Sent when a match is found and a room is being created. */
export interface MatchmakingFound {
  /** Room code for the matched game. */
  roomCode: string;
  /** Info about matched opponents. */
  opponents: { name: string; rating: number; tier: RankTier }[];
  /** The player's own reconnect token for the auto-joined room. */
  reconnectToken: string;
  /** The player's assigned in-game player ID. */
  playerId: string;
}

// ── Match history types (for future rating recalculation) ────────────────

/** Detailed match data stored for every ranked game. Designed so that
 *  ratings can be recalculated from scratch if the rating algorithm changes. */
export interface RankedMatchRecord {
  gameId: string;
  mode: RankedMode;
  /** Number of players when the match started (including bots). */
  playerCount: number;
  /** Number of human players when the match started. */
  humanPlayerCount: number;
  /** Whether the match was created via matchmaking (vs. custom ranked lobby). */
  fromMatchmaking: boolean;
  /** Snapshot of game settings at match time. */
  settings: GameSettings;
  startedAt: string;
  endedAt: string;
  /** Ordered results — one entry per player. */
  players: RankedMatchPlayerRecord[];
}

/** Per-player data in a ranked match record. */
export interface RankedMatchPlayerRecord {
  userId: string;
  /** Display name at the time of the match. */
  displayName: string;
  finishPosition: number;
  isBot: boolean;
  /** Rating snapshot BEFORE the match was played. */
  ratingBefore: {
    elo?: number;
    mu?: number;
    sigma?: number;
  };
  /** Rating snapshot AFTER the match was played. */
  ratingAfter: {
    elo?: number;
    mu?: number;
    sigma?: number;
  };
}

// ── Rank tier types ─────────────────────────────────────────────────────

/** Display tiers for ranked play, derived from Elo / OpenSkill display rating. */
export enum RankTier {
  BRONZE = 'bronze',
  SILVER = 'silver',
  GOLD = 'gold',
  PLATINUM = 'platinum',
  DIAMOND = 'diamond',
}

/** Determine the rank tier from a numeric rating (Elo or converted OpenSkill). */
export function getRankTier(rating: number): RankTier {
  if (rating >= 1600) return RankTier.DIAMOND;
  if (rating >= 1400) return RankTier.PLATINUM;
  if (rating >= 1200) return RankTier.GOLD;
  if (rating >= 1000) return RankTier.SILVER;
  return RankTier.BRONZE;
}

/** Convert OpenSkill mu to a display rating on the same scale as Elo. */
export function openSkillDisplayRating(mu: number): number {
  return Math.round(mu * 48);
}

// ── Leaderboard types ────────────────────────────────────────────────────

/** Time period filter for leaderboard queries. */
export type LeaderboardPeriod = 'all_time' | 'month' | 'week';

/** Player type filter for leaderboard queries. */
export type LeaderboardPlayerFilter = 'all' | 'players' | 'bots';

/** A single entry in the leaderboard response. */
export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatar: AvatarId | null;
  /** Custom profile photo URL. Takes priority over emoji avatar when present. */
  photoUrl?: string | null;
  rating: number;
  gamesPlayed: number;
  tier: RankTier;
  /** Whether this entry is a bot account. */
  isBot?: boolean;
}

/** Response body for GET /api/leaderboard/:mode. */
export interface LeaderboardResponse {
  mode: RankedMode;
  period: LeaderboardPeriod;
  entries: LeaderboardEntry[];
  totalCount: number;
  /** The requesting user's rank/rating, if logged in and qualified. */
  currentUser: LeaderboardEntry | null;
}

/** Response body for GET /api/leaderboard/:mode/nearby. */
export interface LeaderboardNearbyResponse {
  mode: RankedMode;
  entries: LeaderboardEntry[];
  /** The requesting user's entry (same as the middle entry). */
  currentUser: LeaderboardEntry;
}

/** Rating change sent to clients after a ranked game ends. */
export interface RatingChange {
  mode: RankedMode;
  before: number;
  after: number;
  delta: number;
}

// ── Advanced stats types ────────────────────────────────────────────────

/** Per-hand-type breakdown: how often this hand type was called and how often it existed. */
export interface HandTypeBreakdown {
  /** HandType enum value (0–9). */
  handType: number;
  /** How many times this player called this hand type. */
  timesCalled: number;
  /** Of those calls, how many times the hand actually existed. */
  timesExisted: number;
  /** Times opponent called bull on this hand type and it existed (opponent was wrong). */
  bullsAgainstCorrect: number;
  /** Times opponent called bull on this hand type total. */
  bullsAgainstTotal: number;
}

/** A single entry in the rating history timeline. */
export interface RatingHistoryEntry {
  gameId: string;
  mode: RankedMode;
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
  createdAt: string;
}

/** Win rate and average finish grouped by player count. */
export interface PerformanceByPlayerCount {
  playerCount: number;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  avgFinish: number;
}

/** Today's session summary. */
export interface TodaySession {
  gamesPlayed: number;
  wins: number;
  netRatingChange: number;
  bullAccuracy: number | null;
}

/** Record against a specific opponent. */
export interface OpponentRecord {
  opponentId: string;
  opponentName: string;
  opponentUsername: string;
  opponentAvatar: AvatarId | null;
  /** Opponent's profile photo URL — takes priority over emoji avatar. */
  opponentPhotoUrl?: string | null;
  gamesPlayed: number;
  wins: number;
  losses: number;
}

/** Response body for GET /api/stats/:userId/advanced. */
export interface AdvancedStatsResponse {
  userId: string;
  handBreakdown: HandTypeBreakdown[];
  ratingHistory: RatingHistoryEntry[];
  performanceByPlayerCount: PerformanceByPlayerCount[];
  todaySession: TodaySession | null;
  opponentRecords: OpponentRecord[];
  /** Bluff pattern data bucketed by round number for heat map visualization. */
  bluffHeatMap: BluffHeatMapEntry[];
  /** Win probability over time from the player's match history. */
  winProbabilityTimeline: WinProbabilityEntry[];
  /** Head-to-head rivalry data for the most-played opponents. */
  rivalries: RivalryRecord[];
  /** Career trajectory showing rating, win rate, and play style evolution. */
  careerTrajectory: CareerTrajectoryPoint[];
}

// ── Match analytics visualization types ──────────────────────────────

/** Bluff pattern data for a specific round-number bucket.
 *  Aggregated across all games to show when in a game a player bluffs most. */
export interface BluffHeatMapEntry {
  /** Round number (1-based). */
  roundNumber: number;
  /** Total bluffs attempted in rounds with this number. */
  bluffsAttempted: number;
  /** Bluffs that were caught. */
  bluffsCaught: number;
  /** Total calls made in rounds with this number (for bluff rate calculation). */
  totalCalls: number;
  /** Total bulls called in rounds with this number. */
  bullsCalled: number;
  /** Correct bulls in rounds with this number. */
  correctBulls: number;
}

/** Win probability data point from a completed match.
 *  Shows card count ratio progression during a game. */
export interface WinProbabilityEntry {
  /** Game ID for linking to replay. */
  gameId: string;
  /** Date the game was played. */
  playedAt: string;
  /** Whether the player won this game. */
  won: boolean;
  /** Round-by-round card count snapshots (lower is better). */
  snapshots: {
    roundNumber: number;
    /** Player's card count at end of this round. */
    playerCards: number;
    /** Average card count of opponents at end of this round. */
    avgOpponentCards: number;
    /** Total players still alive. */
    playersAlive: number;
  }[];
}

/** Extended rivalry data for a frequent opponent. */
export interface RivalryRecord {
  opponentId: string;
  opponentName: string;
  opponentUsername: string;
  opponentAvatar: AvatarId | null;
  opponentPhotoUrl?: string | null;
  gamesPlayed: number;
  wins: number;
  losses: number;
  /** Recent form: array of 'W' | 'L' for last 10 games, newest first. */
  recentForm: ('W' | 'L')[];
  /** Average game duration in seconds when playing this opponent. */
  avgDurationSeconds: number;
  /** Win streak (positive = user streak, negative = opponent streak, 0 = no streak). */
  currentStreak: number;
}

/** Career trajectory data point — one per week or per N games. */
export interface CareerTrajectoryPoint {
  /** ISO date string for this data point (start of period). */
  periodStart: string;
  /** Rating at the end of this period. */
  rating: number;
  /** Win rate percentage during this period. */
  winRate: number;
  /** Games played during this period. */
  gamesPlayed: number;
  /** Bluff success rate during this period (null if no bluffs). */
  bluffRate: number | null;
  /** Bull accuracy during this period (null if no bulls called). */
  bullAccuracy: number | null;
}

// ── In-game stats types ─────────────────────────────────────────────────

/** Per-player running stats accumulated during a live game. */
export interface InGamePlayerStats {
  bullsCalled: number;
  truesCalled: number;
  callsMade: number;
  correctBulls: number;
  correctTrues: number;
  bluffsSuccessful: number;
}

/** Snapshot of card counts at the end of a round, used for the timeline chart. */
export interface CardCountSnapshot {
  roundNumber: number;
  /** Card count per player at the end of this round. */
  cardCounts: Record<PlayerId, number>;
  /** Players eliminated this round. */
  eliminatedPlayerIds: PlayerId[];
}

/** Aggregated in-game stats computed from accumulated round results. */
export interface InGameStats {
  playerStats: Record<PlayerId, InGamePlayerStats>;
  /** How many times each hand type was called across the whole game so far. */
  handTypeCalls: Record<number, number>;
  /** Round-by-round card count snapshots for timeline chart. */
  roundSnapshots: CardCountSnapshot[];
}

// ── Friends types ─────────────────────────────────────────────────────

/** Status of a friendship row in the database. */
export type FriendshipStatus = 'pending' | 'accepted' | 'blocked';

/** A friend entry returned to the client. */
export interface FriendEntry {
  /** The friend's user ID. */
  userId: string;
  username: string;
  displayName: string;
  avatar: AvatarId | null;
  photoUrl?: string | null;
  /** Relationship status from the current user's perspective. */
  status: FriendshipStatus;
  /** Whether this is an incoming request (true) or outgoing (false). Only meaningful when status='pending'. */
  isIncoming: boolean;
  /** Whether the friend is currently connected via WebSocket. */
  isOnline: boolean;
  /** Room code the friend is currently in, if any and if they are a friend (not pending). */
  currentRoomCode?: string | null;
  /** ISO timestamp of the friendship creation. */
  createdAt: string;
}

/** Response body for GET /api/friends. */
export interface FriendsListResponse {
  friends: FriendEntry[];
  incomingCount: number;
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
