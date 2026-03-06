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
import { persistCompletedGame } from './persistGame.js';
import { createChildLogger } from '../logger.js';
import { runWithCorrelation, generateCorrelationId } from '../correlationContext.js';
import { socketEventsTotal, socketErrorsTotal, rateLimitRejectsTotal } from '../metrics.js';
import type { RateLimiter } from '../rateLimit.js';

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
  'game:reaction', 'chat:send',
]);

function attachRateLimiter(
  socket: { use: (fn: (events: unknown[], next: (err?: Error) => void) => void) => void },
  getPlayerId: () => string | undefined,
  rateLimiter: RateLimiter,
): void {
  const socketId = (socket as unknown as { id: string }).id;

  socket.use((event, next) => {
    // Connection-level sliding window rate limit
    const windowKey = `socket:${socketId}`;
    void rateLimiter.checkWindow(windowKey, RATE_LIMIT_MAX_EVENTS, RATE_LIMIT_WINDOW_MS).then((allowed) => {
      if (!allowed) {
        rateLimitRejectsTotal.inc();
        next(new Error('Rate limit exceeded'));
        return;
      }

      // Per-event cooldown for game actions — keyed by player ID so it
      // survives reconnects across instances. Falls back to socket ID
      // if no player ID is assigned yet.
      const eventName = event[0];
      if (typeof eventName === 'string' && GAME_ACTION_EVENTS.has(eventName)) {
        const playerId = getPlayerId();
        const key = `action:${playerId ?? `socket:${socketId}`}`;
        void rateLimiter.checkCooldown(key, GAME_ACTION_COOLDOWN_MS).then((actionAllowed) => {
          if (!actionAllowed) {
            rateLimitRejectsTotal.inc();
            next(new Error('Too fast — please wait'));
            return;
          }
          next();
        }).catch(() => next()); // On error, allow the action (fail-open)
        return;
      }

      next();
    }).catch(() => next()); // On error, allow the event (fail-open)
  });
}

/**
 * Attach correlation context middleware. Wraps each incoming socket event
 * in an AsyncLocalStorage context so that any code downstream (handlers,
 * engine calls, broadcasts, logging) can access the correlation ID without
 * needing it threaded through function parameters.
 */
function attachCorrelationMiddleware(
  socket: { id: string; use: (fn: (events: unknown[], next: (err?: Error) => void) => void) => void },
  roomManager: RoomManager,
): void {
  socket.use((event, next) => {
    const eventName = typeof event[0] === 'string' ? event[0] : 'unknown';

    // Track every socket event for metrics
    socketEventsTotal.inc(eventName);

    // Resolve room/player context for correlation
    const room = roomManager.getRoomForSocket(socket.id);
    const playerId = room?.getPlayerId(socket.id);

    runWithCorrelation(
      {
        correlationId: generateCorrelationId(),
        event: eventName,
        roomCode: room?.roomCode,
        playerId,
        socketId: socket.id,
      },
      () => next(),
    );
  });
}

export function registerHandlers(io: TypedServer, roomManager: RoomManager, botManager: BotManager, rateLimiter: RateLimiter): void {
  io.on('connection', (socket) => {
    const socketLog = createChildLogger({ playerId: socket.id });
    socketLog.info('Socket connected');
    // Attach correlation context first so downstream middleware/handlers
    // can access it via AsyncLocalStorage.
    attachCorrelationMiddleware(socket, roomManager);

    // Pass a getter so the rate limiter can resolve the player ID after
    // the socket has joined a room (not available at connection time).
    attachRateLimiter(socket, () => {
      const room = roomManager.getRoomForSocket(socket.id);
      return room?.getPlayerId(socket.id);
    }, rateLimiter);

    registerLobbyHandlers(io, socket, roomManager, botManager);
    registerGameHandlers(io, socket, roomManager, botManager, rateLimiter);

    socket.on('error', (err) => {
      socketErrorsTotal.inc();
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
              persistCompletedGame(room, elimResult.winnerId);
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
