import type { Server, Socket } from 'socket.io';
import { MIN_PLAYERS, MAX_PLAYERS } from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';
import { RoomManager } from '../rooms/RoomManager.js';
import { BotManager } from '../game/BotManager.js';
import { randomUUID } from 'crypto';
import { broadcastGameState, broadcastRoomState } from './broadcast.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export function registerLobbyHandlers(
  io: TypedServer,
  socket: TypedSocket,
  roomManager: RoomManager,
  botManager: BotManager,
): void {
  socket.on('room:create', (data, callback) => {
    const room = roomManager.createRoom();
    const playerId = randomUUID();
    room.addPlayer(socket.id, playerId, data.playerName);
    roomManager.assignSocketToRoom(socket.id, room.roomCode);
    socket.join(room.roomCode);
    broadcastRoomState(io, room);
    callback({ roomCode: room.roomCode });
  });

  socket.on('room:join', (data, callback) => {
    const room = roomManager.getRoom(data.roomCode);
    if (!room) return callback({ error: 'Room not found' });

    // Check for reconnection
    if (data.playerId && room.handleReconnect(socket.id, data.playerId)) {
      roomManager.assignSocketToRoom(socket.id, room.roomCode);
      socket.join(room.roomCode);
      broadcastRoomState(io, room);
      if (room.game) broadcastGameState(io, room);
      io.to(room.roomCode).emit('player:reconnected', data.playerId);
      return callback({ playerId: data.playerId });
    }

    if (room.playerCount >= MAX_PLAYERS) return callback({ error: 'Room is full' });
    if (room.gamePhase !== 'lobby') return callback({ error: 'Game already in progress' });

    const playerId = randomUUID();
    room.addPlayer(socket.id, playerId, data.playerName);
    roomManager.assignSocketToRoom(socket.id, room.roomCode);
    socket.join(room.roomCode);
    broadcastRoomState(io, room);
    callback({ playerId });
  });

  socket.on('room:leave', () => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) return;
    room.removePlayer(socket.id);
    roomManager.removeSocketMapping(socket.id);
    socket.leave(room.roomCode);
    broadcastRoomState(io, room);
  });

  socket.on('room:addBot', (data, callback) => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) return callback({ error: 'No room found' });

    const playerId = room.getPlayerId(socket.id);
    if (playerId !== room.hostId) {
      return callback({ error: 'Only the host can add bots' });
    }

    try {
      const botId = botManager.addBot(room, data.botName);
      broadcastRoomState(io, room);
      callback({ botId });
    } catch (e) {
      callback({ error: e instanceof Error ? e.message : 'Failed to add bot' });
    }
  });

  socket.on('room:removeBot', (data) => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) return;

    const playerId = room.getPlayerId(socket.id);
    if (playerId !== room.hostId) {
      socket.emit('room:error', 'Only the host can remove bots');
      return;
    }

    botManager.removeBot(room, data.botId);
    broadcastRoomState(io, room);
  });

  socket.on('game:start', () => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) return;
    const playerId = room.getPlayerId(socket.id);
    if (playerId !== room.hostId) {
      socket.emit('room:error', 'Only the host can start the game');
      return;
    }
    if (room.playerCount < MIN_PLAYERS) {
      socket.emit('room:error', `Need at least ${MIN_PLAYERS} players`);
      return;
    }
    room.startGame();
    // Schedule turn first (sets deadline for human), then broadcast with correct deadline
    botManager.scheduleBotTurn(room, io);
    broadcastGameState(io, room);
  });
}
