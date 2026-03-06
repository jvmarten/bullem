import type { Server, Socket } from 'socket.io';
import { GamePhase, validateHandCall, ALLOWED_EMOJIS, CHAT_MESSAGE_MAX_LENGTH, CHAT_MESSAGE_PATTERN, CHAT_RATE_LIMIT_MS } from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents, GameEmoji } from '@bull-em/shared';
import { randomUUID } from 'crypto';
import { RoomManager } from '../rooms/RoomManager.js';
import { BotManager } from '../game/BotManager.js';
import type { TurnResult } from '../game/GameEngine.js';
import { broadcastGameState, broadcastGameReplay, sendTurnPushNotification } from './broadcast.js';
import { beginRoundResultPhase, markContinueReady } from './roundTransition.js';
import { persistCompletedGame } from './persistGame.js';
import { getCorrelatedLogger } from '../logger.js';
import { gameActionsTotal, gamesCompletedTotal } from '../metrics.js';
import type { RateLimiter } from '../rateLimit.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export function registerGameHandlers(
  io: TypedServer,
  socket: TypedSocket,
  roomManager: RoomManager,
  botManager: BotManager,
  rateLimiter?: RateLimiter,
): void {
  socket.on('game:call', (data) => {
    const log = getCorrelatedLogger();
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    const handError = validateHandCall(data.hand);
    if (handError) { socket.emit('room:error', handError); return; }
    gameActionsTotal.inc('call');
    log.info({ handType: data.hand.type }, 'Player called hand');
    botManager.clearTurnTimer(ctx.room.roomCode);
    const result = ctx.game.handleCall(ctx.playerId, data.hand);
    handleResult(io, ctx.room, result, socket, roomManager, botManager);
  });

  socket.on('game:bull', () => {
    const log = getCorrelatedLogger();
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    gameActionsTotal.inc('bull');
    log.info('Player called bull');
    botManager.clearTurnTimer(ctx.room.roomCode);
    const result = ctx.game.handleBull(ctx.playerId);
    handleResult(io, ctx.room, result, socket, roomManager, botManager);
  });

  socket.on('game:true', () => {
    const log = getCorrelatedLogger();
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    gameActionsTotal.inc('true');
    log.info('Player called true');
    botManager.clearTurnTimer(ctx.room.roomCode);
    const result = ctx.game.handleTrue(ctx.playerId);
    handleResult(io, ctx.room, result, socket, roomManager, botManager);
  });

  socket.on('game:lastChanceRaise', (data) => {
    const log = getCorrelatedLogger();
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    const handError = validateHandCall(data.hand);
    if (handError) { socket.emit('room:error', handError); return; }
    gameActionsTotal.inc('lastChanceRaise');
    log.info({ handType: data.hand.type }, 'Player raised on last chance');
    botManager.clearTurnTimer(ctx.room.roomCode);
    const result = ctx.game.handleLastChanceRaise(ctx.playerId, data.hand);
    handleResult(io, ctx.room, result, socket, roomManager, botManager);
  });

  socket.on('game:lastChancePass', () => {
    const log = getCorrelatedLogger();
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    gameActionsTotal.inc('lastChancePass');
    log.info('Player passed on last chance');
    botManager.clearTurnTimer(ctx.room.roomCode);
    const result = ctx.game.handleLastChancePass(ctx.playerId);
    handleResult(io, ctx.room, result, socket, roomManager, botManager);
  });

  socket.on('game:continue', () => {
    const log = getCorrelatedLogger();
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) return;
    const playerId = room.getPlayerId(socket.id);
    if (!playerId) return;
    gameActionsTotal.inc('continue');
    log.info('Player continued');
    markContinueReady(io, room, botManager, playerId, roomManager);
  });

  socket.on('game:reaction', (data) => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room || !room.game) return;
    const playerId = room.getPlayerId(socket.id);
    if (!playerId) return;
    // Validate emoji is in the allowed set
    if (!ALLOWED_EMOJIS.includes(data.emoji as GameEmoji)) return;
    // Relay to all clients in the room
    io.to(room.roomCode).emit('game:reaction', {
      playerId,
      emoji: data.emoji,
      timestamp: Date.now(),
    });
  });

  socket.on('chat:send', (data) => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) return;

    // Resolve sender identity — works for players, eliminated players, and spectators
    const playerId = room.getPlayerId(socket.id);
    const isSpectator = room.spectatorSockets.has(socket.id);
    let senderName: string | undefined;

    if (playerId) {
      const player = room.players.get(playerId);
      senderName = player?.name;
    } else if (isSpectator) {
      senderName = room.spectatorNames.get(socket.id) ?? 'Spectator';
    }

    if (!senderName) return;

    // Validate message content
    if (typeof data.message !== 'string') return;
    const trimmed = data.message.trim();
    if (trimmed.length === 0 || trimmed.length > CHAT_MESSAGE_MAX_LENGTH) return;
    if (!CHAT_MESSAGE_PATTERN.test(trimmed)) return;

    // Per-sender chat rate limit (separate from game action cooldown).
    // Uses Redis-backed cooldown when available for multi-instance consistency.
    const chatCooldownKey = `chat:${playerId ?? socket.id}`;
    if (rateLimiter) {
      void rateLimiter.checkCooldown(chatCooldownKey, CHAT_RATE_LIMIT_MS).then((allowed) => {
        if (!allowed) return;
        emitChat(io, room, playerId, isSpectator, senderName, trimmed);
      }).catch(() => {
        // On error, allow the message (fail-open)
        emitChat(io, room, playerId, isSpectator, senderName, trimmed);
      });
    } else {
      // Fallback: in-memory chat rate limiting (single-instance only)
      const lastChatTime = chatTimestamps.get(chatCooldownKey) ?? 0;
      if (Date.now() - lastChatTime < CHAT_RATE_LIMIT_MS) return;
      chatTimestamps.set(chatCooldownKey, Date.now());
      emitChat(io, room, playerId, isSpectator, senderName, trimmed);
    }
  });
}

/** Emit a validated chat message to the room. */
function emitChat(
  io: TypedServer,
  room: ReturnType<RoomManager['getRoom']> & {},
  playerId: string | undefined,
  isSpectator: boolean,
  senderName: string,
  message: string,
): void {
  const senderIsSpectator = isSpectator || (playerId != null && (room.players.get(playerId)?.isEliminated ?? false));
  io.to(room.roomCode).emit('chat:message', {
    id: randomUUID(),
    senderName,
    message,
    timestamp: Date.now(),
    isSpectator: senderIsSpectator,
  });
}

/** Per-sender chat rate limit timestamps (fallback when no RateLimiter). Cleaned up periodically. */
const chatTimestamps = new Map<string, number>();

// Clean up stale chat timestamps every 60s
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [key, ts] of chatTimestamps) {
    if (ts < cutoff) chatTimestamps.delete(key);
  }
}, 60_000).unref();

/** Extract room + game + playerId from a socket, or emit an error and return null. */
function getGameContext(socket: TypedSocket, roomManager: RoomManager) {
  const room = roomManager.getRoomForSocket(socket.id);
  if (!room || !room.game) {
    socket.emit('room:error', 'No active game');
    return null;
  }
  const playerId = room.getPlayerId(socket.id);
  if (!playerId) {
    socket.emit('room:error', 'Player not found');
    return null;
  }
  return { room, game: room.game, playerId };
}

/** Dispatch a TurnResult from the game engine: broadcast state, schedule next turn, or end the game. */
function handleResult(
  io: TypedServer,
  room: ReturnType<RoomManager['getRoom']> & {},
  result: TurnResult,
  socket: TypedSocket,
  roomManager: RoomManager,
  botManager: BotManager,
): void {
  const log = getCorrelatedLogger();

  switch (result.type) {
    case 'error':
      log.warn({ message: result.message }, 'Game action error');
      socket.emit('room:error', result.message);
      return;

    case 'continue':
    case 'last_chance':
      log.debug({ resultType: result.type }, 'Turn result — game continues');
      if (room.game) room.game.setTurnDeadline(null);
      // Schedule next turn first (sets deadline for human), then broadcast with correct deadline
      botManager.scheduleBotTurn(room, io);
      broadcastGameState(io, room);
      sendTurnPushNotification(io, room);
      break;

    case 'resolve':
      log.info('Round resolved');
      beginRoundResultPhase(io, room, botManager, result.result, roomManager);
      break;

    case 'game_over':
      gamesCompletedTotal.inc();
      log.info({ winnerId: result.winnerId }, 'Game over');
      if (result.finalRoundResult) {
        // Show the final round result before ending the game
        if (room.game) room.game.setTurnDeadline(null);
        broadcastGameState(io, room);
        io.to(room.roomCode).emit('game:roundResult', result.finalRoundResult);
        room.recordEliminations(result.finalRoundResult.eliminatedPlayerIds);
      }
      room.gamePhase = GamePhase.GAME_OVER;
      room.cancelRoundContinueWindow();
      broadcastGameReplay(io, room, result.winnerId);
      io.to(room.roomCode).emit('game:over', result.winnerId, room.game!.getGameStats());
      persistCompletedGame(room, result.winnerId);
      break;
  }
  room.touch();
  roomManager.persistRoom(room);
}
