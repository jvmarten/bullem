import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';
import { RoomManager } from '../rooms/RoomManager.js';
import { BotManager } from '../game/BotManager.js';
import { handleTurnResult } from './turnTimer.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export function registerGameHandlers(
  io: TypedServer,
  socket: TypedSocket,
  roomManager: RoomManager,
  botManager: BotManager,
): void {
  socket.on('game:call', (data) => {
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    const result = ctx.game.handleCall(ctx.playerId, data.hand);
    handleTurnResult(io, ctx.room, result, botManager, (msg) => socket.emit('room:error', msg));
  });

  socket.on('game:bull', () => {
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    const result = ctx.game.handleBull(ctx.playerId);
    handleTurnResult(io, ctx.room, result, botManager, (msg) => socket.emit('room:error', msg));
  });

  socket.on('game:true', () => {
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    const result = ctx.game.handleTrue(ctx.playerId);
    handleTurnResult(io, ctx.room, result, botManager, (msg) => socket.emit('room:error', msg));
  });

  socket.on('game:lastChanceRaise', (data) => {
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    const result = ctx.game.handleLastChanceRaise(ctx.playerId, data.hand);
    handleTurnResult(io, ctx.room, result, botManager, (msg) => socket.emit('room:error', msg));
  });

  socket.on('game:lastChancePass', () => {
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    const result = ctx.game.handleLastChancePass(ctx.playerId);
    handleTurnResult(io, ctx.room, result, botManager, (msg) => socket.emit('room:error', msg));
  });
}

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
