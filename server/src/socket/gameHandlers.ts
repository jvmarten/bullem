import type { Server, Socket } from 'socket.io';
import { GamePhase, validateHandCall, sanitizeHandCall, ALLOWED_EMOJIS, CHAT_MESSAGE_MAX_LENGTH, CHAT_MESSAGE_PATTERN, CHAT_RATE_LIMIT_MS } from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents, GameEmoji, ChatChannel } from '@bull-em/shared';
import { randomUUID } from 'crypto';
import { RoomManager } from '../rooms/RoomManager.js';
import { BotManager } from '../game/BotManager.js';
import type { TurnResult } from '../game/GameEngine.js';
import { broadcastGameState, broadcastGameReplay, sendTurnPushNotification } from './broadcast.js';
import { beginRoundResultPhase, markContinueReady } from './roundTransition.js';
import { persistCompletedGame, computeRatingChanges } from './persistGame.js';
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
    const hand = sanitizeHandCall(data.hand as Record<string, unknown>);
    gameActionsTotal.inc('call');
    log.info({ handType: hand.type }, 'Player called hand');
    botManager.clearTurnTimer(ctx.room.roomCode);
    const result = ctx.game.handleCall(ctx.playerId, hand);
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
    const hand = sanitizeHandCall(data.hand as Record<string, unknown>);
    gameActionsTotal.inc('lastChanceRaise');
    log.info({ handType: hand.type }, 'Player raised on last chance');
    botManager.clearTurnTimer(ctx.room.roomCode);
    const result = ctx.game.handleLastChanceRaise(ctx.playerId, hand);
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
    // Validate emoji is in the allowed set
    if (!ALLOWED_EMOJIS.includes(data.emoji as GameEmoji)) return;
    gameActionsTotal.inc('reaction');

    const playerId = room.getPlayerId(socket.id);
    const isSpectator = room.spectatorSockets.has(socket.id);
    const isEliminated = playerId != null && (room.players.get(playerId)?.isEliminated ?? false);

    if (!playerId && !isSpectator) return;

    const reactionPayload = {
      playerId: playerId ?? socket.id,
      emoji: data.emoji,
      timestamp: Date.now(),
    };

    if (isSpectator || isEliminated) {
      // Route spectator/eliminated reactions only to other spectators and eliminated players
      for (const sid of room.spectatorSockets) {
        io.to(sid).emit('game:reaction', reactionPayload);
      }
      for (const [pid, player] of room.players) {
        if (player.isEliminated) {
          const sid = room.getSocketId(pid);
          if (sid) io.to(sid).emit('game:reaction', reactionPayload);
        }
      }
    } else {
      // Active player — broadcast to all clients in the room
      io.to(room.roomCode).emit('game:reaction', reactionPayload);
    }
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

    // Determine channel and enforce player chat restrictions.
    // Players (non-eliminated) can only chat between rounds and after the game — not during active play.
    // Spectators and eliminated players can always chat on the spectator channel.
    const senderIsSpectator = isSpectator || (playerId != null && (room.players.get(playerId)?.isEliminated ?? false));
    let channel: ChatChannel;

    if (senderIsSpectator) {
      channel = 'spectator';
    } else {
      // Active player — only allowed between rounds (ROUND_RESULT), in lobby, or after game
      if (room.gamePhase === GamePhase.PLAYING) {
        socket.emit('room:error', 'Chat is disabled during active rounds');
        return;
      }
      channel = 'player';
    }

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
        emitChat(io, room, senderIsSpectator, senderName, trimmed, channel);
      }).catch(() => {
        // On error, allow the message (fail-open)
        emitChat(io, room, senderIsSpectator, senderName, trimmed, channel);
      });
    } else {
      // Fallback: in-memory chat rate limiting (single-instance only)
      const lastChatTime = chatTimestamps.get(chatCooldownKey) ?? 0;
      if (Date.now() - lastChatTime < CHAT_RATE_LIMIT_MS) return;
      // Evict oldest entry if at capacity (Map iterates in insertion order)
      if (chatTimestamps.size >= MAX_CHAT_TIMESTAMP_ENTRIES) {
        const oldest = chatTimestamps.keys().next().value;
        if (oldest !== undefined) chatTimestamps.delete(oldest);
      }
      chatTimestamps.set(chatCooldownKey, Date.now());
      emitChat(io, room, senderIsSpectator, senderName, trimmed, channel);
    }
  });
}

/** Emit a validated chat message to the appropriate audience.
 *  Player messages go only to non-eliminated player sockets.
 *  Spectator messages go only to spectator + eliminated-player sockets. */
function emitChat(
  io: TypedServer,
  room: ReturnType<RoomManager['getRoom']> & {},
  isSpectator: boolean,
  senderName: string,
  message: string,
  channel: ChatChannel,
): void {
  const msg = {
    id: randomUUID(),
    senderName,
    message,
    timestamp: Date.now(),
    isSpectator,
    channel,
  };

  if (channel === 'spectator') {
    // Send to spectator sockets + eliminated player sockets
    for (const sid of room.spectatorSockets) {
      io.to(sid).emit('chat:message', msg);
    }
    for (const [pid, player] of room.players) {
      if (player.isEliminated) {
        const sid = room.getSocketId(pid);
        if (sid) io.to(sid).emit('chat:message', msg);
      }
    }
  } else {
    // Send to non-eliminated player sockets only
    for (const [pid, player] of room.players) {
      if (!player.isEliminated) {
        const sid = room.getSocketId(pid);
        if (sid) io.to(sid).emit('chat:message', msg);
      }
    }
  }
}

/** Per-sender chat rate limit timestamps (fallback when no RateLimiter). Cleaned up periodically.
 *  Capped at MAX_CHAT_TIMESTAMP_ENTRIES to prevent unbounded growth under load. */
const chatTimestamps = new Map<string, number>();
const MAX_CHAT_TIMESTAMP_ENTRIES = 10_000;

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
      const gameOverStats = room.game!.getGameStats();
      computeRatingChanges(room, result.winnerId).then(ratingChanges => {
        io.to(room.roomCode).emit('game:over', result.winnerId, gameOverStats, ratingChanges);
      }).catch(() => {
        io.to(room.roomCode).emit('game:over', result.winnerId, gameOverStats);
      });
      persistCompletedGame(room, result.winnerId);
      break;
  }
  room.touch();
  roomManager.persistRoom(room);
}
