import type { Server } from 'socket.io';
import { GamePhase, BotPlayer, BotSpeed, BOT_PROFILE_KEYS, RANKED_SETTINGS, RANKED_BEST_OF } from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents, RankedMode, PlayerId, BestOf } from '@bull-em/shared';
import type { RoomManager } from '../rooms/RoomManager.js';
import type { BotManager } from './BotManager.js';
import { getRankedBotPool } from '../db/botPool.js';
import type { RankedBotEntry } from '../db/botPool.js';
import { getRating } from '../db/ratings.js';
import { broadcastGameState, broadcastRoomState } from '../socket/broadcast.js';
import logger from '../logger.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

// ── Configuration ──────────────────────────────────────────────────────

/** Minimum games per heads-up pairing before moving on. */
const HEADS_UP_GAMES_PER_PAIRING = 10;

/** Min player count for multiplayer calibration games. */
const MULTIPLAYER_MIN_PLAYERS = 3;
/** Max player count for multiplayer calibration games. */
const MULTIPLAYER_MAX_PLAYERS = 9;

/** Delay between calibration games (ms) — continuous mode. */
const GAME_DELAY_CONTINUOUS_MS = 2_000;
/** Delay between calibration games (ms) — converged/slow mode. */
const GAME_DELAY_SLOW_MS = 3 * 60 * 1_000; // 3 minutes

/** Interval between poll checks for game completion (ms). */
const WATCH_INTERVAL_MS = 2_000;

/** Number of recent games to check for Elo convergence. */
const ELO_CONVERGENCE_WINDOW = 20;
/** Max Elo change (absolute) over the convergence window for "converged". */
const ELO_CONVERGENCE_THRESHOLD = 30;

/** Sigma threshold below which an OpenSkill bot is considered converged. */
const OPENSKILL_CONVERGENCE_SIGMA = 2.0;

/** How often to log calibration progress (every N games). */
const LOG_INTERVAL_GAMES = 10;

// ── Types ──────────────────────────────────────────────────────────────

/** Per-bot calibration tracking data (in-memory, not persisted). */
interface BotCalibrationState {
  profileKey: string;
  userId: string;
  displayName: string;
  /** Recent Elo rating history (last N values) for convergence detection. */
  recentEloRatings: number[];
  /** Current Elo rating (cached from DB). */
  currentElo: number;
  /** Current OpenSkill mu (cached from DB). */
  currentMu: number;
  /** Current OpenSkill sigma (cached from DB). */
  currentSigma: number;
  /** Total heads-up calibration games played. */
  headsUpGamesPlayed: number;
  /** Total multiplayer calibration games played. */
  multiplayerGamesPlayed: number;
  /** Whether heads-up rating has converged. */
  headsUpConverged: boolean;
  /** Whether multiplayer rating has converged. */
  multiplayerConverged: boolean;
}

/** Heads-up pairing for round-robin scheduling. */
interface HeadsUpPairing {
  profileA: string;
  profileB: string;
  gamesPlayed: number;
}

export interface CalibrationStatus {
  enabled: boolean;
  running: boolean;
  totalGamesPlayed: number;
  headsUpConverged: boolean;
  multiplayerConverged: boolean;
  bots: Array<{
    name: string;
    profileKey: string;
    headsUpElo: number;
    headsUpGamesPlayed: number;
    headsUpConverged: boolean;
    multiplayerMu: number;
    multiplierSigma: number;
    multiplayerGamesPlayed: number;
    multiplayerConverged: boolean;
    lastEloChange: number;
  }>;
}

// ── CalibrationManager ─────────────────────────────────────────────────

/**
 * Runs a continuous cycle of bot-vs-bot ranked games to calibrate bot ratings
 * before humans enter the ranked pool. Creates rooms, fills them with bots
 * from the profile pool, runs the games, and lets the existing persistGame
 * flow update their ratings via updateRatingsAfterGame.
 *
 * Separate from BackgroundGameManager — these rooms are not visible to
 * spectators and run silently in the background.
 */
export class CalibrationManager {
  private stopped = true;
  private roomCode: string | null = null;
  private watchInterval: ReturnType<typeof setInterval> | null = null;
  private nextGameTimer: ReturnType<typeof setTimeout> | null = null;

  /** Per-bot calibration state, keyed by profile key. */
  private botStates = new Map<string, BotCalibrationState>();
  /** Bot pool fetched from DB at startup. */
  private botPool: RankedBotEntry[] = [];

  /** Heads-up round-robin pairings with game counts. */
  private headsUpPairings: HeadsUpPairing[] = [];
  /** Index into headsUpPairings for the next game. */
  private headsUpPairingIndex = 0;

  /** Current calibration mode — alternates between heads_up and multiplayer. */
  private currentMode: RankedMode = 'heads_up';

  /** Total calibration games completed across both modes. */
  private totalGamesPlayed = 0;

  constructor(
    private readonly io: TypedServer,
    private readonly roomManager: RoomManager,
    private readonly botManager: BotManager,
  ) {}

  /** Start the calibration loop. Fetches bot pool, initializes state, begins games. */
  async start(): Promise<void> {
    this.stopped = false;

    // Fetch bot pool from database
    this.botPool = await getRankedBotPool('heads_up');
    if (this.botPool.length < 2) {
      logger.warn('CalibrationManager: Not enough bots in pool (need >= 2), skipping calibration');
      this.stopped = true;
      return;
    }

    // Initialize per-bot state
    await this.initializeBotStates();

    // Build heads-up round-robin pairings
    this.buildHeadsUpPairings();

    logger.info(
      { botCount: this.botPool.length, pairingCount: this.headsUpPairings.length },
      'CalibrationManager started — beginning bot calibration',
    );

    // Start with heads-up calibration
    this.currentMode = 'heads_up';
    this.scheduleNextGame(GAME_DELAY_CONTINUOUS_MS);
  }

  /** Stop all calibration activity and clean up resources. */
  stop(): void {
    this.stopped = true;

    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
    if (this.nextGameTimer) {
      clearTimeout(this.nextGameTimer);
      this.nextGameTimer = null;
    }
    if (this.roomCode) {
      this.botManager.clearTurnTimer(this.roomCode);
      this.roomManager.deleteRoom(this.roomCode);
      this.roomCode = null;
    }

    logger.info({ totalGamesPlayed: this.totalGamesPlayed }, 'CalibrationManager stopped');
  }

  /** Get current calibration status for the admin endpoint. */
  getStatus(): CalibrationStatus {
    const bots: CalibrationStatus['bots'] = [];

    for (const state of this.botStates.values()) {
      const recentElo = state.recentEloRatings;
      const lastEloChange = recentElo.length >= 2
        ? recentElo[recentElo.length - 1]! - recentElo[recentElo.length - 2]!
        : 0;

      bots.push({
        name: state.displayName,
        profileKey: state.profileKey,
        headsUpElo: state.currentElo,
        headsUpGamesPlayed: state.headsUpGamesPlayed,
        headsUpConverged: state.headsUpConverged,
        multiplayerMu: state.currentMu,
        multiplierSigma: state.currentSigma,
        multiplayerGamesPlayed: state.multiplayerGamesPlayed,
        multiplayerConverged: state.multiplayerConverged,
        lastEloChange,
      });
    }

    return {
      enabled: !this.stopped,
      running: this.roomCode !== null,
      totalGamesPlayed: this.totalGamesPlayed,
      headsUpConverged: this.isModeConverged('heads_up'),
      multiplayerConverged: this.isModeConverged('multiplayer'),
      bots,
    };
  }

  // ── Initialization ───────────────────────────────────────────────────

  private async initializeBotStates(): Promise<void> {
    for (const bot of this.botPool) {
      const headsUpRating = await getRating(bot.userId, 'heads_up');
      const multiplayerRating = await getRating(bot.userId, 'multiplayer');

      this.botStates.set(bot.botProfile, {
        profileKey: bot.botProfile,
        userId: bot.userId,
        displayName: bot.displayName,
        recentEloRatings: [],
        currentElo: headsUpRating?.mode === 'heads_up' ? headsUpRating.elo : 1200,
        currentMu: multiplayerRating?.mode === 'multiplayer' ? multiplayerRating.mu : 25,
        currentSigma: multiplayerRating?.mode === 'multiplayer' ? multiplayerRating.sigma : 25 / 3,
        headsUpGamesPlayed: headsUpRating?.gamesPlayed ?? 0,
        multiplayerGamesPlayed: multiplayerRating?.gamesPlayed ?? 0,
        headsUpConverged: false,
        multiplayerConverged: false,
      });
    }
  }

  /** Build all unique pairs of bot profiles for round-robin heads-up play. */
  private buildHeadsUpPairings(): void {
    const keys = this.botPool.map(b => b.botProfile);
    this.headsUpPairings = [];

    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        this.headsUpPairings.push({
          profileA: keys[i]!,
          profileB: keys[j]!,
          gamesPlayed: 0,
        });
      }
    }
    this.headsUpPairingIndex = 0;
  }

  // ── Game scheduling ──────────────────────────────────────────────────

  private scheduleNextGame(delayMs: number): void {
    if (this.stopped) return;

    if (this.nextGameTimer) clearTimeout(this.nextGameTimer);
    this.nextGameTimer = setTimeout(() => {
      this.nextGameTimer = null;
      void this.runNextGame();
    }, delayMs);
    this.nextGameTimer.unref();
  }

  private async runNextGame(): Promise<void> {
    if (this.stopped) return;

    // Decide which mode to run based on convergence state
    const headsUpDone = this.isModeConverged('heads_up');
    const multiplayerDone = this.isModeConverged('multiplayer');

    if (headsUpDone && multiplayerDone) {
      // Both converged — run a maintenance game in alternating modes
      this.currentMode = this.currentMode === 'heads_up' ? 'multiplayer' : 'heads_up';
      this.createCalibrationGame();
      return;
    }

    // Alternate between non-converged modes, favoring the one with fewer games
    if (!headsUpDone && !multiplayerDone) {
      // Pick the mode where bots have played fewer total games
      const headsUpTotal = this.getTotalGamesForMode('heads_up');
      const multiplayerTotal = this.getTotalGamesForMode('multiplayer');
      this.currentMode = headsUpTotal <= multiplayerTotal ? 'heads_up' : 'multiplayer';
    } else if (!headsUpDone) {
      this.currentMode = 'heads_up';
    } else {
      this.currentMode = 'multiplayer';
    }

    this.createCalibrationGame();
  }

  // ── Game creation ────────────────────────────────────────────────────

  private createCalibrationGame(): void {
    if (this.stopped) return;

    // Clean up previous room
    if (this.roomCode) {
      this.botManager.clearTurnTimer(this.roomCode);
      this.roomManager.deleteRoom(this.roomCode);
      this.roomCode = null;
    }
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }

    if (this.currentMode === 'heads_up') {
      this.createHeadsUpGame();
    } else {
      this.createMultiplayerGame();
    }
  }

  private createHeadsUpGame(): void {
    // Find next pairing that needs more games
    const pairing = this.getNextHeadsUpPairing();
    if (!pairing) {
      // All pairings have enough games — switch to multiplayer
      this.currentMode = 'multiplayer';
      this.createMultiplayerGame();
      return;
    }

    const botA = this.botPool.find(b => b.botProfile === pairing.profileA);
    const botB = this.botPool.find(b => b.botProfile === pairing.profileB);
    if (!botA || !botB) return;

    const room = this.roomManager.createRoom();
    this.roomCode = room.roomCode;
    room.isBackgroundGame = true; // Exempt from stale-room cleanup

    room.updateSettings({
      maxCards: RANKED_SETTINGS.maxCards,
      turnTimer: 0, // No turn timer for bot games
      allowSpectators: false,
      spectatorsCanSeeCards: false,
      botSpeed: BotSpeed.FAST,
      lastChanceMode: RANKED_SETTINGS.lastChanceMode,
      ranked: true,
      rankedMode: 'heads_up',
      bestOf: RANKED_BEST_OF as BestOf,
    });

    const botAId = this.botManager.addRankedBot(room, botA.userId, botA.displayName, botA.profileConfig);
    const botBId = this.botManager.addRankedBot(room, botB.userId, botB.displayName, botB.profileConfig);

    // Initialize series state for Bo3
    const playerIds = [botAId, botBId] as [PlayerId, PlayerId];
    room.seriesState = {
      bestOf: RANKED_BEST_OF as BestOf,
      currentSet: 1,
      wins: { [botAId]: 0, [botBId]: 0 },
      winsNeeded: Math.ceil(RANKED_BEST_OF / 2),
      seriesWinnerId: null,
      playerIds,
    };

    room.startGame();
    BotPlayer.resetMemory(room.roomCode);
    this.botManager.scheduleBotTurn(room, this.io);

    pairing.gamesPlayed++;

    this.watchForGameOver();
  }

  private createMultiplayerGame(): void {
    // Randomize player count between 3 and min(9, botPool.length)
    const maxPlayers = Math.min(MULTIPLAYER_MAX_PLAYERS, this.botPool.length);
    if (maxPlayers < MULTIPLAYER_MIN_PLAYERS) {
      // Not enough bots for multiplayer — skip
      this.currentMode = 'heads_up';
      this.scheduleNextGame(GAME_DELAY_CONTINUOUS_MS);
      return;
    }

    const playerCount = MULTIPLAYER_MIN_PLAYERS +
      Math.floor(Math.random() * (maxPlayers - MULTIPLAYER_MIN_PLAYERS + 1));

    // Randomly select bot profiles, ensuring roughly equal play
    const selectedBots = this.selectBotsForMultiplayer(playerCount);

    const room = this.roomManager.createRoom();
    this.roomCode = room.roomCode;
    room.isBackgroundGame = true;

    room.updateSettings({
      maxCards: RANKED_SETTINGS.maxCards,
      turnTimer: 0,
      allowSpectators: false,
      spectatorsCanSeeCards: false,
      botSpeed: BotSpeed.FAST,
      lastChanceMode: RANKED_SETTINGS.lastChanceMode,
      ranked: true,
      rankedMode: 'multiplayer',
    });

    for (const bot of selectedBots) {
      this.botManager.addRankedBot(room, bot.userId, bot.displayName, bot.profileConfig);
    }

    room.startGame();
    BotPlayer.resetMemory(room.roomCode);
    this.botManager.scheduleBotTurn(room, this.io);

    this.watchForGameOver();
  }

  /**
   * Select bots for a multiplayer game, preferring bots with fewer games
   * to ensure roughly equal calibration across all profiles.
   */
  private selectBotsForMultiplayer(count: number): RankedBotEntry[] {
    // Sort by multiplayer games played (ascending) to prioritize under-played bots
    const sorted = [...this.botPool].sort((a, b) => {
      const stateA = this.botStates.get(a.botProfile);
      const stateB = this.botStates.get(b.botProfile);
      return (stateA?.multiplayerGamesPlayed ?? 0) - (stateB?.multiplayerGamesPlayed ?? 0);
    });

    // Take the bots with fewest games, then shuffle to avoid deterministic seating
    const selected = sorted.slice(0, count);
    for (let i = selected.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [selected[i], selected[j]] = [selected[j]!, selected[i]!];
    }
    return selected;
  }

  // ── Game completion ──────────────────────────────────────────────────

  /**
   * Poll the room's game phase to detect game over.
   * The existing persistCompletedGame flow handles rating updates automatically
   * because the room is configured with ranked=true and rankedMode set.
   */
  private watchForGameOver(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
    }

    this.watchInterval = setInterval(() => {
      if (this.stopped || !this.roomCode) {
        if (this.watchInterval) {
          clearInterval(this.watchInterval);
          this.watchInterval = null;
        }
        return;
      }

      const room = this.roomManager.getRoom(this.roomCode);
      if (!room || room.gamePhase === GamePhase.GAME_OVER || room.gamePhase === GamePhase.FINISHED) {
        if (this.watchInterval) {
          clearInterval(this.watchInterval);
          this.watchInterval = null;
        }
        void this.onGameCompleted();
      }
    }, WATCH_INTERVAL_MS);
    this.watchInterval.unref();
  }

  /** Called when a calibration game finishes. Updates tracking, checks convergence, schedules next. */
  private async onGameCompleted(): Promise<void> {
    this.totalGamesPlayed++;

    // Clean up current room
    if (this.roomCode) {
      this.botManager.clearTurnTimer(this.roomCode);
      this.roomManager.deleteRoom(this.roomCode);
      this.roomCode = null;
    }

    // Refresh ratings from DB and update convergence state
    await this.refreshBotRatings();

    // Log progress periodically
    if (this.totalGamesPlayed % LOG_INTERVAL_GAMES === 0) {
      this.logCalibrationProgress();
    }

    // Determine delay for next game based on convergence
    const headsUpDone = this.isModeConverged('heads_up');
    const multiplayerDone = this.isModeConverged('multiplayer');
    const delay = (headsUpDone && multiplayerDone)
      ? GAME_DELAY_SLOW_MS
      : GAME_DELAY_CONTINUOUS_MS;

    this.scheduleNextGame(delay);
  }

  // ── Convergence detection ────────────────────────────────────────────

  /** Refresh cached ratings from the database and update convergence flags. */
  private async refreshBotRatings(): Promise<void> {
    for (const state of this.botStates.values()) {
      const headsUpRating = await getRating(state.userId, 'heads_up');
      const multiplayerRating = await getRating(state.userId, 'multiplayer');

      if (headsUpRating?.mode === 'heads_up') {
        state.currentElo = headsUpRating.elo;
        state.headsUpGamesPlayed = headsUpRating.gamesPlayed;

        // Track recent Elo values for convergence detection
        state.recentEloRatings.push(headsUpRating.elo);
        if (state.recentEloRatings.length > ELO_CONVERGENCE_WINDOW) {
          state.recentEloRatings.shift();
        }

        // Elo converged: rating hasn't changed by more than ±threshold over window
        if (state.recentEloRatings.length >= ELO_CONVERGENCE_WINDOW) {
          const min = Math.min(...state.recentEloRatings);
          const max = Math.max(...state.recentEloRatings);
          state.headsUpConverged = (max - min) <= ELO_CONVERGENCE_THRESHOLD;
        }
      }

      if (multiplayerRating?.mode === 'multiplayer') {
        state.currentMu = multiplayerRating.mu;
        state.currentSigma = multiplayerRating.sigma;
        state.multiplayerGamesPlayed = multiplayerRating.gamesPlayed;

        // OpenSkill converged: sigma below threshold
        state.multiplayerConverged = multiplayerRating.sigma < OPENSKILL_CONVERGENCE_SIGMA;
      }
    }
  }

  /** Check if all bots have converged for a given mode. */
  isModeConverged(mode: RankedMode): boolean {
    if (this.botStates.size === 0) return false;

    for (const state of this.botStates.values()) {
      if (mode === 'heads_up' && !state.headsUpConverged) return false;
      if (mode === 'multiplayer' && !state.multiplayerConverged) return false;
    }
    return true;
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /** Get the next heads-up pairing that still needs more games. */
  private getNextHeadsUpPairing(): HeadsUpPairing | null {
    if (this.headsUpPairings.length === 0) return null;

    // Scan from current index, wrapping around
    const start = this.headsUpPairingIndex;
    for (let i = 0; i < this.headsUpPairings.length; i++) {
      const idx = (start + i) % this.headsUpPairings.length;
      const pairing = this.headsUpPairings[idx]!;
      if (pairing.gamesPlayed < HEADS_UP_GAMES_PER_PAIRING) {
        this.headsUpPairingIndex = (idx + 1) % this.headsUpPairings.length;
        return pairing;
      }
    }

    // All pairings have enough games — reset for another cycle
    for (const p of this.headsUpPairings) {
      p.gamesPlayed = 0;
    }
    this.headsUpPairingIndex = 0;
    return this.headsUpPairings[0] ?? null;
  }

  /** Get total calibration games played across all bots for a mode. */
  private getTotalGamesForMode(mode: RankedMode): number {
    let total = 0;
    for (const state of this.botStates.values()) {
      total += mode === 'heads_up' ? state.headsUpGamesPlayed : state.multiplayerGamesPlayed;
    }
    return total;
  }

  /** Log current calibration progress to the server logs. */
  private logCalibrationProgress(): void {
    const botRatings: Record<string, { elo: number; mu: number; sigma: number; huGames: number; mpGames: number; huConv: boolean; mpConv: boolean }> = {};

    for (const state of this.botStates.values()) {
      botRatings[state.profileKey] = {
        elo: Math.round(state.currentElo),
        mu: Math.round(state.currentMu * 100) / 100,
        sigma: Math.round(state.currentSigma * 100) / 100,
        huGames: state.headsUpGamesPlayed,
        mpGames: state.multiplayerGamesPlayed,
        huConv: state.headsUpConverged,
        mpConv: state.multiplayerConverged,
      };
    }

    logger.info(
      {
        totalGames: this.totalGamesPlayed,
        headsUpConverged: this.isModeConverged('heads_up'),
        multiplayerConverged: this.isModeConverged('multiplayer'),
        botRatings,
      },
      'Calibration progress',
    );
  }
}
