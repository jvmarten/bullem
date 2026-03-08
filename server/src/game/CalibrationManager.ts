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

/** Target number of concurrent heads-up games. */
const TARGET_HEADS_UP_GAMES = 9;
/** Target number of concurrent multiplayer games. */
const TARGET_MULTIPLAYER_GAMES = 9;

/** Min player count for multiplayer calibration games. */
const MULTIPLAYER_MIN_PLAYERS = 3;
/** Max player count for multiplayer calibration games. */
const MULTIPLAYER_MAX_PLAYERS = 9;

/** Delay before starting a replacement game (ms) — continuous mode. */
const GAME_DELAY_CONTINUOUS_MS = 2_000;
/** Delay before starting a replacement game (ms) — converged/slow mode. */
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

/** Random jitter range (Elo points) added to ratings when pairing heads-up games. */
const HEADS_UP_PAIRING_JITTER = 50;

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

/** Tracks an active calibration game room. */
interface ActiveGame {
  roomCode: string;
  mode: RankedMode;
  watchInterval: ReturnType<typeof setInterval>;
}

export interface CalibrationStatus {
  enabled: boolean;
  running: boolean;
  totalGamesPlayed: number;
  activeHeadsUpGames: number;
  activeMultiplayerGames: number;
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
 * Runs 18 concurrent bot-vs-bot ranked games (9 heads-up + 9 multiplayer)
 * to calibrate bot ratings before humans enter the ranked pool. When any
 * game finishes, a replacement is immediately started to maintain the
 * 9+9 split.
 *
 * Heads-up matchmaking pairs bots by closest Elo rating with small random
 * jitter. Multiplayer matchmaking groups bots by similar rating using
 * contiguous slices of rating-sorted pools.
 *
 * Bots can participate in multiple simultaneous games.
 */
export class CalibrationManager {
  private stopped = true;

  /** All currently active calibration games, keyed by room code. */
  private activeGames = new Map<string, ActiveGame>();

  /** Timers for scheduling replacement games after completion. */
  private replacementTimers = new Set<ReturnType<typeof setTimeout>>();

  /** Per-bot calibration state, keyed by profile key. */
  private botStates = new Map<string, BotCalibrationState>();
  /** Bot pool fetched from DB at startup. */
  private botPool: RankedBotEntry[] = [];

  /** Total calibration games completed across both modes. */
  private totalGamesPlayed = 0;

  constructor(
    private readonly io: TypedServer,
    private readonly roomManager: RoomManager,
    private readonly botManager: BotManager,
  ) {}

  /** Start the calibration loop. Fetches bot pool, initializes state, launches all games. */
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

    logger.info(
      { botCount: this.botPool.length },
      'CalibrationManager started — launching concurrent calibration games',
    );

    // Launch all initial games
    this.fillGameSlots();
  }

  /** Stop all calibration activity and clean up all active games. */
  stop(): void {
    this.stopped = true;

    // Clear all replacement timers
    for (const timer of this.replacementTimers) {
      clearTimeout(timer);
    }
    this.replacementTimers.clear();

    // Clean up all active games
    for (const game of this.activeGames.values()) {
      clearInterval(game.watchInterval);
      this.botManager.clearTurnTimer(game.roomCode);
      this.roomManager.deleteRoom(game.roomCode);
    }
    this.activeGames.clear();

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

    let activeHeadsUp = 0;
    let activeMultiplayer = 0;
    for (const game of this.activeGames.values()) {
      if (game.mode === 'heads_up') activeHeadsUp++;
      else activeMultiplayer++;
    }

    return {
      enabled: !this.stopped,
      running: this.activeGames.size > 0,
      totalGamesPlayed: this.totalGamesPlayed,
      activeHeadsUpGames: activeHeadsUp,
      activeMultiplayerGames: activeMultiplayer,
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

  // ── Slot management ─────────────────────────────────────────────────

  /** Count active games by mode. */
  private countActiveByMode(mode: RankedMode): number {
    let count = 0;
    for (const game of this.activeGames.values()) {
      if (game.mode === mode) count++;
    }
    return count;
  }

  /** Launch games to fill all empty slots up to 9 HU + 9 MP. */
  private fillGameSlots(): void {
    if (this.stopped) return;

    const headsUpNeeded = TARGET_HEADS_UP_GAMES - this.countActiveByMode('heads_up');
    const multiplayerNeeded = TARGET_MULTIPLAYER_GAMES - this.countActiveByMode('multiplayer');

    for (let i = 0; i < headsUpNeeded; i++) {
      this.launchGame('heads_up');
    }
    for (let i = 0; i < multiplayerNeeded; i++) {
      this.launchGame('multiplayer');
    }
  }

  /** Launch a single calibration game of the given mode. */
  private launchGame(mode: RankedMode): void {
    if (this.stopped) return;

    if (mode === 'heads_up') {
      this.createHeadsUpGame();
    } else {
      this.createMultiplayerGame();
    }
  }

  // ── Game creation ────────────────────────────────────────────────────

  private createHeadsUpGame(): void {
    if (this.stopped) return;
    if (this.botPool.length < 2) return;

    const [botA, botB] = this.selectHeadsUpPair();
    if (!botA || !botB) return;

    const room = this.roomManager.createRoom();
    room.isBackgroundGame = true;

    room.updateSettings({
      maxCards: RANKED_SETTINGS.maxCards,
      turnTimer: 0,
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

    this.registerActiveGame(room.roomCode, 'heads_up');
  }

  private createMultiplayerGame(): void {
    if (this.stopped) return;

    const maxPlayers = Math.min(MULTIPLAYER_MAX_PLAYERS, this.botPool.length);
    if (maxPlayers < MULTIPLAYER_MIN_PLAYERS) return;

    const playerCount = MULTIPLAYER_MIN_PLAYERS +
      Math.floor(Math.random() * (maxPlayers - MULTIPLAYER_MIN_PLAYERS + 1));

    const selectedBots = this.selectBotsForMultiplayer(playerCount);
    if (selectedBots.length < MULTIPLAYER_MIN_PLAYERS) return;

    const room = this.roomManager.createRoom();
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

    this.registerActiveGame(room.roomCode, 'multiplayer');
  }

  // ── Matchmaking ─────────────────────────────────────────────────────

  /**
   * Select a heads-up pair by closest Elo rating with random jitter.
   * Sorts bots by (currentElo + random jitter), then picks the two closest.
   */
  private selectHeadsUpPair(): [RankedBotEntry, RankedBotEntry] | [undefined, undefined] {
    if (this.botPool.length < 2) return [undefined, undefined];

    // Build array of bots with jittered ratings
    const jittered = this.botPool.map(bot => {
      const state = this.botStates.get(bot.botProfile);
      const baseElo = state?.currentElo ?? 1200;
      const jitter = (Math.random() - 0.5) * 2 * HEADS_UP_PAIRING_JITTER;
      return { bot, jitteredElo: baseElo + jitter };
    });

    // Sort by jittered Elo
    jittered.sort((a, b) => a.jitteredElo - b.jitteredElo);

    // Find the pair with smallest gap between adjacent entries
    let bestGap = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < jittered.length - 1; i++) {
      const gap = Math.abs(jittered[i + 1]!.jitteredElo - jittered[i]!.jitteredElo);
      if (gap < bestGap) {
        bestGap = gap;
        bestIdx = i;
      }
    }

    return [jittered[bestIdx]!.bot, jittered[bestIdx + 1]!.bot];
  }

  /**
   * Select bots for a multiplayer game by grouping bots with similar ratings.
   * Sorts bots by current OpenSkill mu (with small jitter), then takes a
   * contiguous slice of the requested size.
   */
  private selectBotsForMultiplayer(count: number): RankedBotEntry[] {
    if (this.botPool.length < count) {
      count = this.botPool.length;
    }

    // Sort by mu with small jitter to vary groupings
    const jittered = this.botPool.map(bot => {
      const state = this.botStates.get(bot.botProfile);
      const baseMu = state?.currentMu ?? 25;
      const jitter = (Math.random() - 0.5) * 4; // ±2 mu jitter
      return { bot, jitteredMu: baseMu + jitter };
    });
    jittered.sort((a, b) => a.jitteredMu - b.jitteredMu);

    // Pick a random starting index for the contiguous slice
    const maxStart = jittered.length - count;
    const startIdx = Math.floor(Math.random() * (maxStart + 1));

    const selected = jittered.slice(startIdx, startIdx + count).map(j => j.bot);

    // Shuffle seating order
    for (let i = selected.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [selected[i], selected[j]] = [selected[j]!, selected[i]!];
    }
    return selected;
  }

  // ── Active game tracking & completion ───────────────────────────────

  /** Register a new active game and start watching it for completion. */
  private registerActiveGame(roomCode: string, mode: RankedMode): void {
    const watchInterval = setInterval(() => {
      if (this.stopped) {
        clearInterval(watchInterval);
        return;
      }

      const room = this.roomManager.getRoom(roomCode);
      if (!room || room.gamePhase === GamePhase.GAME_OVER || room.gamePhase === GamePhase.FINISHED) {
        clearInterval(watchInterval);
        this.activeGames.delete(roomCode);
        void this.onGameCompleted(roomCode, mode);
      }
    }, WATCH_INTERVAL_MS);
    watchInterval.unref();

    this.activeGames.set(roomCode, { roomCode, mode, watchInterval });
  }

  /** Called when a calibration game finishes. Cleans up, refreshes ratings, starts replacement. */
  private async onGameCompleted(roomCode: string, mode: RankedMode): Promise<void> {
    this.totalGamesPlayed++;

    // Clean up the finished room
    this.botManager.clearTurnTimer(roomCode);
    this.roomManager.deleteRoom(roomCode);

    // Refresh ratings from DB and update convergence state
    await this.refreshBotRatings();

    // Log progress periodically
    if (this.totalGamesPlayed % LOG_INTERVAL_GAMES === 0) {
      this.logCalibrationProgress();
    }

    if (this.stopped) return;

    // Schedule a replacement game to maintain the 9+9 split
    const headsUpDone = this.isModeConverged('heads_up');
    const multiplayerDone = this.isModeConverged('multiplayer');
    const delay = (headsUpDone && multiplayerDone)
      ? GAME_DELAY_SLOW_MS
      : GAME_DELAY_CONTINUOUS_MS;

    const timer = setTimeout(() => {
      this.replacementTimers.delete(timer);
      if (!this.stopped) {
        this.launchGame(mode);
      }
    }, delay);
    timer.unref();
    this.replacementTimers.add(timer);
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
        activeHeadsUp: this.countActiveByMode('heads_up'),
        activeMultiplayer: this.countActiveByMode('multiplayer'),
        headsUpConverged: this.isModeConverged('heads_up'),
        multiplayerConverged: this.isModeConverged('multiplayer'),
        botRatings,
      },
      'Calibration progress',
    );
  }
}
