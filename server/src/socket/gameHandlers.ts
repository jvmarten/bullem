import type { Server, Socket } from 'socket.io';
import { GamePhase } from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';
import { RoomManager } from '../rooms/RoomManager.js';
import { BotManager } from '../game/BotManager.js';
import type { TurnResult } from '../game/GameEngine.js';
import { broadcastGameState, broadcastNewRound } from './broadcast.js';

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
    handleResult(io, ctx.room, result, socket, botManager);
  });

  socket.on('game:bull', () => {
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    const result = ctx.game.handleBull(ctx.playerId);
    handleResult(io, ctx.room, result, socket, botManager);
  });

  socket.on('game:true', () => {
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    const result = ctx.game.handleTrue(ctx.playerId);
    handleResult(io, ctx.room, result, socket, botManager);
  });

  socket.on('game:lastChanceRaise', (data) => {
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    const result = ctx.game.handleLastChanceRaise(ctx.playerId, data.hand);
    handleResult(io, ctx.room, result, socket, botManager);
  });

  socket.on('game:lastChancePass', () => {
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    const result = ctx.game.handleLastChancePass(ctx.playerId);
    handleResult(io, ctx.room, result, socket, botManager);
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
  botManager: BotManager,
): void {
  switch (result.type) {
    case 'error':
      socket.emit('room:error', result.message);
      return;

    case 'continue':
    case 'last_chance':
      if (room.game) room.game.setTurnDeadline(null);
      // Schedule next turn first (sets deadline for human), then broadcast with correct deadline
      botManager.scheduleBotTurn(room, io);
      broadcastGameState(io, room);
      break;

    case 'resolve':
      if (room.game) room.game.setTurnDeadline(null);
      room.gamePhase = GamePhase.ROUND_RESULT;
      io.to(room.roomCode).emit('game:roundResult', result.result);
      // Start next round after a delay
      setTimeout(() => {
        const nextResult = room.game!.startNextRound();
        if (nextResult.type === 'game_over') {
          room.gamePhase = GamePhase.GAME_OVER;
          io.to(room.roomCode).emit('game:over', nextResult.winnerId, room.game!.getGameStats());
        } else {
          room.gamePhase = GamePhase.PLAYING;
          // Schedule before broadcast so deadline is included in state
          botManager.scheduleBotTurn(room, io);
          broadcastNewRound(io, room);
        }
      }, 3000);
      break;

    case 'game_over':
      room.gamePhase = GamePhase.GAME_OVER;
      io.to(room.roomCode).emit('game:over', result.winnerId, room.game!.getGameStats());
      break;
  }
  room.touch();
}
