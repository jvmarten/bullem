import type { Server, Socket } from 'socket.io';
import { GamePhase, validateHandCall } from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';
import { RoomManager } from '../rooms/RoomManager.js';
import { BotManager } from '../game/BotManager.js';
import type { TurnResult } from '../game/GameEngine.js';
import { broadcastGameState, broadcastGameReplay } from './broadcast.js';
import { beginRoundResultPhase, markContinueReady } from './roundTransition.js';

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
    const handError = validateHandCall(data.hand);
    if (handError) { socket.emit('room:error', handError); return; }
    botManager.clearTurnTimer(ctx.room.roomCode);
    const result = ctx.game.handleCall(ctx.playerId, data.hand);
    handleResult(io, ctx.room, result, socket, roomManager, botManager);
  });

  socket.on('game:bull', () => {
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    botManager.clearTurnTimer(ctx.room.roomCode);
    const result = ctx.game.handleBull(ctx.playerId);
    handleResult(io, ctx.room, result, socket, roomManager, botManager);
  });

  socket.on('game:true', () => {
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    botManager.clearTurnTimer(ctx.room.roomCode);
    const result = ctx.game.handleTrue(ctx.playerId);
    handleResult(io, ctx.room, result, socket, roomManager, botManager);
  });

  socket.on('game:lastChanceRaise', (data) => {
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    const handError = validateHandCall(data.hand);
    if (handError) { socket.emit('room:error', handError); return; }
    botManager.clearTurnTimer(ctx.room.roomCode);
    const result = ctx.game.handleLastChanceRaise(ctx.playerId, data.hand);
    handleResult(io, ctx.room, result, socket, roomManager, botManager);
  });

  socket.on('game:lastChancePass', () => {
    const ctx = getGameContext(socket, roomManager);
    if (!ctx) return;
    botManager.clearTurnTimer(ctx.room.roomCode);
    const result = ctx.game.handleLastChancePass(ctx.playerId);
    handleResult(io, ctx.room, result, socket, roomManager, botManager);
  });

  socket.on('game:continue', () => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) return;
    const playerId = room.getPlayerId(socket.id);
    if (!playerId) return;
    markContinueReady(io, room, botManager, playerId, roomManager);
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
  roomManager: RoomManager,
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
      beginRoundResultPhase(io, room, botManager, result.result, roomManager);
      break;

    case 'game_over':
      if (result.finalRoundResult) {
        // Show the final round result before ending the game
        if (room.game) room.game.setTurnDeadline(null);
        broadcastGameState(io, room);
        io.to(room.roomCode).emit('game:roundResult', result.finalRoundResult);
      }
      room.gamePhase = GamePhase.GAME_OVER;
      room.cancelRoundContinueWindow();
      broadcastGameReplay(io, room, result.winnerId);
      io.to(room.roomCode).emit('game:over', result.winnerId, room.game!.getGameStats());
      break;
  }
  room.touch();
  roomManager.persistRoom(room);
}
