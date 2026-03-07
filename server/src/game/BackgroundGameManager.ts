import type { Server } from 'socket.io';
import { GamePhase, BotPlayer, BotSpeed, BOT_PROFILES, RANKED_SETTINGS, RANKED_BEST_OF } from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents, RankedMode, PlayerId, BestOf } from '@bull-em/shared';
import type { RoomManager } from '../rooms/RoomManager.js';
import type { BotManager } from './BotManager.js';
import { broadcastGameState, broadcastRoomState } from '../socket/broadcast.js';
import { getRankedBotPool } from '../db/botPool.js';
import type { RankedBotEntry } from '../db/botPool.js';
import logger from '../logger.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

/** Min/max bot count for background games (inclusive). */
const MIN_BOTS = 2;
const MAX_BOTS = 9;

/** Delay before starting a new game after the previous one ends (ms). */
const RESTART_DELAY_MS = 8_000;

/**
 * Maintains an always-running bot-only game so there's always something to
 * spectate via "Watch random game." When the game finishes, it auto-restarts
 * after a brief delay with a randomized configuration (different bot count,
 * levels, and game mode). Every background match is ranked so bot ratings
 * feed into the leaderboard.
 */
export class BackgroundGameManager {
  private roomCode: string | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  /** Tracked so stop() can clean it up — prevents orphaned intervals. */
  private watchInterval: ReturnType<typeof setInterval> | null = null;
  /** Set to true on stop() to prevent createAndStartGame from running after shutdown. */
  private stopped = false;

  constructor(
    private readonly io: TypedServer,
    private readonly roomManager: RoomManager,
    private readonly botManager: BotManager,
  ) {}

  /** Create the background room and start the first game. */
  start(): void {
    this.stopped = false;
    void this.createAndStartGame();
  }

  /** Clean up all timers, intervals, and the background room on shutdown. */
  stop(): void {
    this.stopped = true;
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.roomCode) {
      this.botManager.clearTurnTimer(this.roomCode);
      this.roomManager.deleteRoom(this.roomCode);
      this.roomCode = null;
    }
  }

  /** Returns the background game room code, or undefined if not running. */
  getRoomCode(): string | undefined {
    return this.roomCode ?? undefined;
  }

  private async createAndStartGame(): Promise<void> {
    if (this.stopped) return;

    // Clean up previous watch interval
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }

    // Clean up previous room if it exists
    if (this.roomCode) {
      this.botManager.clearTurnTimer(this.roomCode);
      this.roomManager.deleteRoom(this.roomCode);
      this.roomCode = null;
    }

    // Randomize game configuration: 2 bots = 1v1 (bo3), 3-9 bots = multiplayer (bo1)
    const botCount = MIN_BOTS + Math.floor(Math.random() * (MAX_BOTS - MIN_BOTS + 1));
    const isHeadsUp = botCount === 2;
    const rankedMode: RankedMode = isHeadsUp ? 'heads_up' : 'multiplayer';
    const actualBotCount = botCount;

    const room = this.roomManager.createRoom();
    this.roomCode = room.roomCode;
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

    for (let i = 0; i < actualBotCount; i++) {
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
    if (rankedMode === 'heads_up' && actualBotCount === 2) {
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
      botCount: actualBotCount,
      rankedMode,
      bestOf: rankedMode === 'heads_up' ? RANKED_BEST_OF : 1,
      bots: [...room.players.values()].map(p => p.name),
    }, 'Background game started');

    // Watch for game over to auto-restart
    this.watchForGameOver();
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

  /** Poll the room's game phase to detect game over and trigger restart.
   *  Uses a lightweight interval instead of hooking into game events to
   *  keep the background game decoupled from core game flow. */
  private watchForGameOver(): void {
    // Clean up any previous interval before creating a new one
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
        this.scheduleRestart();
      }
    }, 2000);
    // Don't let this interval prevent process exit
    this.watchInterval.unref();
  }

  private scheduleRestart(): void {
    if (this.stopped) return;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.createAndStartGame();
    }, RESTART_DELAY_MS);
    this.restartTimer.unref();
  }
}
