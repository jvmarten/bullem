import type { Server, Socket } from 'socket.io';
import { GamePhase } from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents, HandCall } from '@bull-em/shared';
import { RoomManager } from '../rooms/RoomManager.js';
import type { TurnResult } from '../game/GameEngine.js';
import { broadcastGameState } from './broadcast.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export function registerGameHandlers(
  io: TypedServer,
  socket: TypedSocket,
  roomManager: RoomManager,
): void {
  socket.on('game:call', (data) => {
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    const result = ctx.game.handleCall(ctx.playerId, data.hand);
    handleResult(io, ctx.room, result, socket);
  });

  socket.on('game:bull', () => {
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    const result = ctx.game.handleBull(ctx.playerId);
    handleResult(io, ctx.room, result, socket);
  });

  socket.on('game:true', () => {
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    const result = ctx.game.handleTrue(ctx.playerId);
    handleResult(io, ctx.room, result, socket);
  });

  socket.on('game:lastChanceRaise', (data) => {
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    const result = ctx.game.handleLastChanceRaise(ctx.playerId, data.hand);
    handleResult(io, ctx.room, result, socket);
  });

  socket.on('game:lastChancePass', () => {
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    const result = ctx.game.handleLastChancePass(ctx.playerId);
    handleResult(io, ctx.room, result, socket);
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

function handleResult(
  io: TypedServer,
  room: ReturnType<RoomManager['getRoom']> & {},
  result: TurnResult,
  socket: TypedSocket,
): void {
  switch (result.type) {
    case 'error':
      socket.emit('room:error', result.message);
      break;

    case 'continue':
    case 'last_chance':
      broadcastGameState(io, room);
      break;

    case 'resolve':
      io.to(room.roomCode).emit('game:roundResult', result.result);
      // Start next round after a delay
      setTimeout(() => {
        room.game!.startRound();
        broadcastGameState(io, room);
      }, 5000);
      break;

    case 'game_over':
      room.gamePhase = GamePhase.FINISHED;
      io.to(room.roomCode).emit('game:over', result.winnerId);
      break;
  }
}
