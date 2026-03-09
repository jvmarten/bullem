import type { BotDifficulty, GameSettings, PlayerId } from '@bull-em/shared';
import type { BotProfileConfig } from '@bull-em/shared';

/** Configuration for a single bot player in a simulation. */
export interface BotConfig {
  /** Unique identifier for this bot slot (auto-generated if omitted). */
  id?: string;
  /** Display name for this bot. */
  name?: string;
  /** AI difficulty level. Defaults to HARD. */
  difficulty?: BotDifficulty;
  /** Fine-grained personality tuning (only used with HARD difficulty). */
  profileConfig?: BotProfileConfig;
}

/** A pluggable strategy that decides a bot's action given the current game state.
 *  Returning undefined falls back to the built-in heuristic bot. */
export type BotStrategy = (context: BotStrategyContext) => BotStrategyAction | undefined;

/** Context passed to a pluggable bot strategy. */
export interface BotStrategyContext {
  /** The game state as this bot sees it (only its own cards). */
  state: import('@bull-em/shared').ClientGameState;
  /** This bot's ID. */
  botId: string;
  /** This bot's actual cards. */
  botCards: import('@bull-em/shared').Card[];
  /** Total cards across all active players. */
  totalCards: number;
  /** Number of active (non-eliminated) players in the game. */
  activePlayers: number;
}

/** Action returned by a pluggable strategy. Mirrors BotAction from shared. */
export type BotStrategyAction =
  | { action: 'call'; hand: import('@bull-em/shared').HandCall }
  | { action: 'bull' }
  | { action: 'true' }
  | { action: 'lastChanceRaise'; hand: import('@bull-em/shared').HandCall }
  | { action: 'lastChancePass' };

/** Result of a single simulated game. */
export interface GameResult {
  /** ID of the winning player. */
  winnerId: PlayerId;
  /** Total number of rounds played. */
  rounds: number;
  /** Number of turns (individual actions) across all rounds. */
  turns: number;
  /** Ordered list of player IDs by elimination (first eliminated = index 0). */
  eliminationOrder: PlayerId[];
}

/** Aggregated statistics from a batch of simulated games. */
export interface BatchStats {
  totalGames: number;
  /** Win count per player ID. */
  wins: Record<PlayerId, number>;
  /** Win rate (0–1) per player ID. */
  winRates: Record<PlayerId, number>;
  /** Average number of rounds per game. */
  avgRounds: number;
  /** Average number of turns (actions) per game. */
  avgTurns: number;
  /** Wall-clock duration of the batch in milliseconds. */
  durationMs: number;
  /** Throughput: games completed per second. */
  gamesPerSecond: number;
}

/** Top-level simulation configuration. */
export interface SimulationConfig {
  /** Number of games to simulate. */
  games: number;
  /** Number of bot players per game. */
  players: number;
  /** Maximum cards before elimination (1–5). */
  maxCards: number;
  /** Bot difficulty for all bots (unless per-bot configs override). */
  difficulty: BotDifficulty;
  /** Per-bot configurations (overrides `players` count if provided). */
  botConfigs?: BotConfig[];
  /** Pluggable strategy — if provided, used for ALL bots.
   *  Return undefined to fall back to the built-in heuristic. */
  strategy?: BotStrategy;
  /** Game settings overrides. */
  gameSettings?: Partial<GameSettings>;
  /** How often to log progress (number of games between updates). 0 = no progress. */
  progressInterval: number;
}
