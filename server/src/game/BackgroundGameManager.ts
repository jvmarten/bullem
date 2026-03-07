import type { Server } from 'socket.io';
import { GamePhase, BotPlayer, BotSpeed, BOT_PROFILES } from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';
import type { RoomManager } from '../rooms/RoomManager.js';
import type { BotManager } from './BotManager.js';
import { broadcastGameState, broadcastRoomState } from '../socket/broadcast.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

/** Number of bots in the background showcase game. */
const BACKGROUND_BOT_COUNT = 4;

/** Delay before starting a new game after the previous one ends (ms). */
const RESTART_DELAY_MS = 8_000;

/**
 * Maintains an always-running bot-only game so there's always something to
 * spectate via "Watch random game." When the game finishes, it auto-restarts
 * after a brief delay. The room has spectating enabled with cards visible so
 * spectators can see everything.
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
    this.createAndStartGame();
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

  private createAndStartGame(): void {
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

    const room = this.roomManager.createRoom();
    this.roomCode = room.roomCode;
    room.isBackgroundGame = true;

    // Configure for spectating
    room.updateSettings({
      maxCards: 5,
      turnTimer: 0,
      allowSpectators: true,
      spectatorsCanSeeCards: true,
      botSpeed: BotSpeed.SLOW,
      lastChanceMode: 'classic',
    });

    // Add bots
    for (let i = 0; i < BACKGROUND_BOT_COUNT; i++) {
      const name = BOT_PROFILES[i]?.name ?? `Bot ${i + 1}`;
      const botId = `bg-bot-${i}`;
      room.addBot(botId, name);
    }

    // Start the game
    room.startGame();
    BotPlayer.resetMemory(room.roomCode);

    // Schedule the first bot turn
    this.botManager.scheduleBotTurn(room, this.io);
    broadcastRoomState(this.io, room);
    broadcastGameState(this.io, room);

    // Watch for game over to auto-restart
    this.watchForGameOver();
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
      this.createAndStartGame();
    }, RESTART_DELAY_MS);
    this.restartTimer.unref();
  }
}
