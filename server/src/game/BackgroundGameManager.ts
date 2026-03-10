import type { Server } from 'socket.io';
import { GamePhase, BotPlayer, BotSpeed, BOT_PROFILES, CFR_BOTS, RANKED_SETTINGS, RANKED_BEST_OF } from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents, RankedMode, PlayerId, BestOf } from '@bull-em/shared';
import type { RoomManager } from '../rooms/RoomManager.js';
import type { BotManager } from './BotManager.js';
import { broadcastGameState, broadcastRoomState } from '../socket/broadcast.js';
import { getRankedBotPool } from '../db/botPool.js';
import type { RankedBotEntry } from '../db/botPool.js';
import logger from '../logger.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

/** Number of concurrent 1v1 (heads-up) background games. */
const HEADS_UP_SLOTS = 9;
/** Number of concurrent multiplayer background games. */
const MULTIPLAYER_SLOTS = 9;

/** Min/max bot count for multiplayer background games (inclusive). */
const MIN_MULTI_BOTS = 3;
const MAX_MULTI_BOTS = 9;

/** Delay before starting a new game after the previous one ends (ms). */
const RESTART_DELAY_MS = 8_000;

/** Stagger game creation to avoid a thundering herd on startup (ms per slot). */
const STAGGER_DELAY_MS = 500;

/**
 * Number of heads-up / multiplayer slots that MUST include at least one
 * CFR bot. Ensures CFR bots are always visible in the lobby and
 * accumulate rated games for the leaderboard.
 */
const CFR_GUARANTEED_HEADS_UP = 3;
const CFR_GUARANTEED_MULTIPLAYER = 3;

/** Tracks the state of a single background game slot. */
interface GameSlot {
  roomCode: string | null;
  watchInterval: ReturnType<typeof setInterval> | null;
  restartTimer: ReturnType<typeof setTimeout> | null;
  mode: RankedMode;
  /** When true, at least one bot in this slot must be a CFR bot. */
  requireCFR: boolean;
}

/**
 * Maintains 18 always-running bot-only games (9 heads-up, 9 multiplayer) so
 * there's always a variety of matches to spectate in the lobby. When a game
 * finishes, its slot auto-restarts after a brief delay. Every background match
 * is ranked so bot ratings feed into the leaderboard.
 */
export class BackgroundGameManager {
  private readonly slots: GameSlot[] = [];
  /** Set to true on stop() to prevent createAndStartGame from running after shutdown. */
  private stopped = false;

  constructor(
    private readonly io: TypedServer,
    private readonly roomManager: RoomManager,
    private readonly botManager: BotManager,
  ) {}

  /** Create all background game slots and stagger their startup. */
  start(): void {
    this.stopped = false;

    // Initialize heads-up slots (first N are CFR-guaranteed)
    for (let i = 0; i < HEADS_UP_SLOTS; i++) {
      const slot: GameSlot = {
        roomCode: null, watchInterval: null, restartTimer: null,
        mode: 'heads_up', requireCFR: i < CFR_GUARANTEED_HEADS_UP,
      };
      this.slots.push(slot);
      const delay = i * STAGGER_DELAY_MS;
      const timer = setTimeout(() => {
        if (!this.stopped) void this.createAndStartGame(slot);
      }, delay);
      timer.unref();
    }

    // Initialize multiplayer slots (first N are CFR-guaranteed, staggered after heads-up)
    for (let i = 0; i < MULTIPLAYER_SLOTS; i++) {
      const slot: GameSlot = {
        roomCode: null, watchInterval: null, restartTimer: null,
        mode: 'multiplayer', requireCFR: i < CFR_GUARANTEED_MULTIPLAYER,
      };
      this.slots.push(slot);
      const delay = (HEADS_UP_SLOTS + i) * STAGGER_DELAY_MS;
      const timer = setTimeout(() => {
        if (!this.stopped) void this.createAndStartGame(slot);
      }, delay);
      timer.unref();
    }
  }

  /** Clean up all timers, intervals, and background rooms on shutdown. */
  stop(): void {
    this.stopped = true;
    for (const slot of this.slots) {
      if (slot.watchInterval) {
        clearInterval(slot.watchInterval);
        slot.watchInterval = null;
      }
      if (slot.restartTimer) {
        clearTimeout(slot.restartTimer);
        slot.restartTimer = null;
      }
      if (slot.roomCode) {
        this.botManager.clearTurnTimer(slot.roomCode);
        this.roomManager.deleteRoom(slot.roomCode);
        slot.roomCode = null;
      }
    }
    this.slots.length = 0;
  }

  /** Returns all active background game room codes. */
  getRoomCodes(): string[] {
    return this.slots
      .map(s => s.roomCode)
      .filter((code): code is string => code !== null);
  }

  private async createAndStartGame(slot: GameSlot): Promise<void> {
    if (this.stopped) return;

    // Clean up previous watch interval for this slot
    if (slot.watchInterval) {
      clearInterval(slot.watchInterval);
      slot.watchInterval = null;
    }

    // Clean up previous room if it exists
    if (slot.roomCode) {
      this.botManager.clearTurnTimer(slot.roomCode);
      this.roomManager.deleteRoom(slot.roomCode);
      slot.roomCode = null;
    }

    const rankedMode = slot.mode;
    const botCount = rankedMode === 'heads_up'
      ? 2
      : MIN_MULTI_BOTS + Math.floor(Math.random() * (MAX_MULTI_BOTS - MIN_MULTI_BOTS + 1));

    const room = this.roomManager.createRoom();
    slot.roomCode = room.roomCode;
    room.isBackgroundGame = true;

    // Configure for spectating + ranked play
    room.updateSettings({
      maxCards: RANKED_SETTINGS.maxCards,
      turnTimer: 0, // No timer for bots — they play at botSpeed pace
      allowSpectators: true,
      spectatorsCanSeeCards: true,
      botSpeed: BotSpeed.SLOW,
      lastChanceMode: RANKED_SETTINGS.lastChanceMode,
      ranked: true,
      rankedMode,
    });

    // Try to add ranked bots from the database for leaderboard tracking
    // (oracle_lvl10 is already excluded from the pool by getRankedBotPool)
    const botPool = await this.fetchBotPool(rankedMode);
    const usedBotUserIds = new Set<string>();
    const usedNames = new Set<string>();

    // If this slot requires a CFR bot, add one first
    if (slot.requireCFR) {
      const added = this.addCFRBot(room, botPool, usedBotUserIds, usedNames);
      if (!added) {
        logger.warn({ roomCode: room.roomCode, rankedMode }, 'Failed to add CFR bot to guaranteed slot — no CFR bots available');
      }
    }

    // Fill remaining slots with random bots from the pool
    const currentCount = room.playerCount;
    for (let i = currentCount; i < botCount; i++) {
      if (botPool.length > 0) {
        // Pick a random bot from the pool for variety (not closest-rated)
        const available = botPool.filter(b => !usedBotUserIds.has(b.userId));
        if (available.length > 0) {
          const bot = available[Math.floor(Math.random() * available.length)]!;
          this.botManager.addRankedBot(room, bot.userId, bot.displayName, bot.profileConfig);
          usedBotUserIds.add(bot.userId);
          continue;
        }
      }

      // Fallback: pick a random bot profile from the shared matrix (anonymous, not rated)
      const profile = BOT_PROFILES[Math.floor(Math.random() * BOT_PROFILES.length)]!;
      this.botManager.addBot(room, profile.name);
    }

    // For 1v1 (heads-up), set up Bo3 series state to match ranked rules
    if (rankedMode === 'heads_up' && botCount === 2) {
      const bestOf = RANKED_BEST_OF as BestOf;
      const playerIds = [...room.players.keys()] as [PlayerId, PlayerId];
      room.settings.bestOf = bestOf;
      room.seriesState = {
        bestOf,
        currentSet: 1,
        wins: { [playerIds[0]]: 0, [playerIds[1]]: 0 },
        winsNeeded: Math.ceil(bestOf / 2),
        seriesWinnerId: null,
        playerIds,
      };
    }

    // Start the game
    room.startGame();
    BotPlayer.resetMemory(room.roomCode);

    // Schedule the first bot turn
    this.botManager.scheduleBotTurn(room, this.io);
    broadcastRoomState(this.io, room);
    broadcastGameState(this.io, room);

    logger.info({
      roomCode: room.roomCode,
      botCount,
      rankedMode,
      bestOf: rankedMode === 'heads_up' ? RANKED_BEST_OF : 1,
      bots: [...room.players.values()].map(p => p.name),
    }, 'Background game started');

    // Watch for game over to auto-restart this slot
    this.watchForGameOver(slot);
  }

  /**
   * Add a CFR bot to the room. Tries the ranked pool first (for leaderboard
   * tracking), falls back to code-level CFR_BOTS definitions if the pool
   * doesn't contain any CFR bots (e.g. migration not applied).
   */
  private addCFRBot(
    room: ReturnType<RoomManager['createRoom']>,
    botPool: RankedBotEntry[],
    usedBotUserIds: Set<string>,
    usedNames: Set<string>,
  ): boolean {
    // Try ranked CFR bots from the pool first (tracked on leaderboard)
    const cfrPool = botPool.filter(
      b => b.botProfile.startsWith('cfr_') && !usedBotUserIds.has(b.userId),
    );
    if (cfrPool.length > 0) {
      const bot = cfrPool[Math.floor(Math.random() * cfrPool.length)]!;
      this.botManager.addRankedBot(room, bot.userId, bot.displayName, bot.profileConfig);
      usedBotUserIds.add(bot.userId);
      usedNames.add(bot.displayName);
      return true;
    }

    // Fallback: add a CFR bot from code definitions (anonymous, not rated,
    // but at least visible in-game and using CFR strategy)
    const available = CFR_BOTS.filter(b => !usedNames.has(b.name));
    if (available.length > 0) {
      const profile = available[Math.floor(Math.random() * available.length)]!;
      this.botManager.addBot(room, profile.name);
      usedNames.add(profile.name);
      return true;
    }

    return false;
  }

  /** Fetch ranked bot pool, gracefully falling back to empty on DB errors. */
  private async fetchBotPool(mode: RankedMode): Promise<RankedBotEntry[]> {
    try {
      return await getRankedBotPool(mode);
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch ranked bot pool for background game — using anonymous bots');
      return [];
    }
  }

  /** Poll the slot's room game phase to detect game over and trigger restart.
   *  Uses a lightweight interval instead of hooking into game events to
   *  keep the background game decoupled from core game flow. */
  private watchForGameOver(slot: GameSlot): void {
    // Clean up any previous interval before creating a new one
    if (slot.watchInterval) {
      clearInterval(slot.watchInterval);
    }

    slot.watchInterval = setInterval(() => {
      if (this.stopped || !slot.roomCode) {
        if (slot.watchInterval) {
          clearInterval(slot.watchInterval);
          slot.watchInterval = null;
        }
        return;
      }

      const room = this.roomManager.getRoom(slot.roomCode);
      if (!room || room.gamePhase === GamePhase.GAME_OVER || room.gamePhase === GamePhase.FINISHED) {
        if (slot.watchInterval) {
          clearInterval(slot.watchInterval);
          slot.watchInterval = null;
        }
        this.scheduleRestart(slot);
      }
    }, 2000);
    // Don't let this interval prevent process exit
    slot.watchInterval.unref();
  }

  private scheduleRestart(slot: GameSlot): void {
    if (this.stopped) return;
    if (slot.restartTimer) clearTimeout(slot.restartTimer);
    slot.restartTimer = setTimeout(() => {
      slot.restartTimer = null;
      void this.createAndStartGame(slot);
    }, RESTART_DELAY_MS);
    slot.restartTimer.unref();
  }
}
