import type { Server } from 'socket.io';
import * as Sentry from '@sentry/node';
import { GamePhase, DISCONNECT_TIMEOUT_MS } from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';
import { RoomManager } from '../rooms/RoomManager.js';
import { BotManager } from '../game/BotManager.js';
import { registerLobbyHandlers } from './lobbyHandlers.js';
import { registerGameHandlers } from './gameHandlers.js';
import { broadcastRoomState, broadcastGameState, broadcastPlayerNames, broadcastGameReplay } from './broadcast.js';
import { beginRoundResultPhase, checkRoundContinueComplete } from './roundTransition.js';
import { createChildLogger } from '../logger.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

/** Per-socket rate limiter: max events per window. */
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_EVENTS = 15;

/** Minimum interval between game action events (ms) to prevent rapid-fire spam. */
const GAME_ACTION_COOLDOWN_MS = 200;

/** Socket event names that are game actions subject to per-event throttling. */
const GAME_ACTION_EVENTS = new Set([
  'game:call', 'game:bull', 'game:true',
  'game:lastChanceRaise', 'game:lastChancePass', 'game:continue',
]);

/** Per-player-ID game action cooldown. Survives socket reconnects so a
 *  malicious client can't bypass the cooldown by rapidly reconnecting.
 *  Entries are cleaned up when rooms are deleted (stale entries expire
 *  naturally since they only store a timestamp). */
const playerActionTimestamps = new Map<string, number>();

/** Clean up stale player action timestamps older than 60s. Called periodically
 *  to prevent the map from growing if players disconnect without cleanup. */
function pruneStaleTimestamps(): void {
  const cutoff = Date.now() - 60_000;
  for (const [id, ts] of playerActionTimestamps) {
    if (ts < cutoff) playerActionTimestamps.delete(id);
  }
}
// Prune every 60s
setInterval(pruneStaleTimestamps, 60_000).unref();

function attachRateLimiter(
  socket: { use: (fn: (events: unknown[], next: (err?: Error) => void) => void) => void },
  getPlayerId: () => string | undefined,
): void {
  let eventCount = 0;
  let windowStart = Date.now();

  socket.use((event, next) => {
    const now = Date.now();

    // Connection-level rate limit
    if (now - windowStart > RATE_LIMIT_WINDOW_MS) {
      eventCount = 0;
      windowStart = now;
    }
    eventCount++;
    if (eventCount > RATE_LIMIT_MAX_EVENTS) {
      next(new Error('Rate limit exceeded'));
      return;
    }

    // Per-event cooldown for game actions — keyed by player ID so it
    // survives reconnects. Falls back to per-socket if no player ID yet.
    const eventName = event[0];
    if (typeof eventName === 'string' && GAME_ACTION_EVENTS.has(eventName)) {
      const playerId = getPlayerId();
      const key = playerId ?? `socket:${(socket as unknown as { id: string }).id}`;
      const lastTime = playerActionTimestamps.get(key) ?? 0;
      if (now - lastTime < GAME_ACTION_COOLDOWN_MS) {
        next(new Error('Too fast — please wait'));
        return;
      }
      playerActionTimestamps.set(key, now);
    }

    next();
  });
}

export function registerHandlers(io: TypedServer, roomManager: RoomManager, botManager: BotManager): void {
  io.on('connection', (socket) => {
    const socketLog = createChildLogger({ playerId: socket.id });
    socketLog.info('Socket connected');
    // Pass a getter so the rate limiter can resolve the player ID after
    // the socket has joined a room (not available at connection time).
    attachRateLimiter(socket, () => {
      const room = roomManager.getRoomForSocket(socket.id);
      return room?.getPlayerId(socket.id);
    });

    registerLobbyHandlers(io, socket, roomManager, botManager);
    registerGameHandlers(io, socket, roomManager, botManager);

    socket.on('error', (err) => {
      const room = roomManager.getRoomForSocket(socket.id);
      const playerId = room?.getPlayerId(socket.id);
      const childLog = createChildLogger({ roomCode: room?.roomCode, playerId });
      childLog.error({ err }, 'Socket error');
      Sentry.captureException(err, {
        extra: { roomCode: room?.roomCode, playerId, socketId: socket.id },
      });
    });

    socket.on('disconnect', () => {
      socketLog.info('Socket disconnected');

      // Callback fired when the 30s disconnect timer expires and the player
      // hasn't reconnected. Properly eliminates the player through the game
      // engine so turn order, game-over checks, and round resolution all work.
      const onDisconnectTimeout = (playerId: string): void => {
        const room = roomManager.getRoomForPlayer(playerId);
        if (!room || !room.game) return;

        botManager.clearTurnTimer(room.roomCode);
        const elimResult = room.game.eliminatePlayer(playerId);

        switch (elimResult.type) {
          case 'game_over':
            if (room.gamePhase !== GamePhase.GAME_OVER) {
              room.gamePhase = GamePhase.GAME_OVER;
              room.cancelRoundContinueWindow();
              broadcastGameReplay(io, room, elimResult.winnerId);
              io.to(room.roomCode).emit('game:over', elimResult.winnerId, room.game.getGameStats());
            }
            break;
          case 'resolve':
            beginRoundResultPhase(io, room, botManager, elimResult.result, roomManager);
            break;
          case 'last_chance':
          case 'continue':
            if (room.gamePhase === GamePhase.ROUND_RESULT) {
              // Player eliminated during round result — check if remaining
              // active players have all continued; start next round if so.
              checkRoundContinueComplete(io, room, botManager, roomManager);
              if (room.gamePhase === GamePhase.ROUND_RESULT) {
                broadcastGameState(io, room);
              }
            } else {
              botManager.scheduleBotTurn(room, io);
              broadcastGameState(io, room);
            }
            break;
        }
        broadcastRoomState(io, room);
        roomManager.persistRoom(room);
      };

      // Clean up spectator if applicable
      const spectatorRoom = roomManager.getRoomForSocket(socket.id);
      if (spectatorRoom && spectatorRoom.spectatorSockets.has(socket.id)) {
        spectatorRoom.spectatorSockets.delete(socket.id);
        roomManager.removeSocketMapping(socket.id);
        // Notify players that spectator count changed
        broadcastRoomState(io, spectatorRoom);
        // Don't continue with the normal disconnect logic for spectators
        broadcastPlayerNames(io, roomManager);
        return;
      }

      const result = roomManager.handleDisconnect(socket.id, onDisconnectTimeout);
      if (result) {
        // Do NOT clear the turn timer here. If a turn timer is running for the
        // current player, it should keep ticking — the auto-action will fire
        // when it expires regardless of connection status. Clearing it on any
        // disconnect (including non-current players) was an exploit: close the
        // browser, reconnect, and the timer is gone → unlimited turn time.
        const disconnectDeadline = Date.now() + DISCONNECT_TIMEOUT_MS;
        io.to(result.room.roomCode).emit('player:disconnected', result.playerId, disconnectDeadline);
        broadcastRoomState(io, result.room);
        if (result.room.game) {
          // Do NOT call markContinueReady here. A disconnect (app switch, page
          // refresh, brief network drop) is NOT the same as pressing "Continue."
          // Treating it as such can trigger startNextRound while the player is
          // mid-reconnect, causing them to miss the new round and get stuck on
          // a stale overlay. The 30s round-continue timeout handles the case
          // where they never come back.
          broadcastGameState(io, result.room);
          // If the disconnected player is the current player and no turn timer
          // is configured, schedule a disconnect auto-action so the game
          // doesn't stall. When a turn timer IS configured, it keeps running
          // independently and will fire the auto-action when it expires.
          if (result.room.gamePhase === GamePhase.PLAYING
            && result.room.game.currentPlayerId === result.playerId
            && !result.room.settings.turnTimer) {
            botManager.scheduleDisconnectAutoAction(result.room, io, result.playerId);
          }
        }
      }
      broadcastPlayerNames(io, roomManager);
    });
  });
}
