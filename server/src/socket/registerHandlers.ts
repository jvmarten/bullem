import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';
import { RoomManager } from '../rooms/RoomManager.js';
import { registerLobbyHandlers } from './lobbyHandlers.js';
import { registerGameHandlers } from './gameHandlers.js';
import { broadcastRoomState, broadcastGameState } from './broadcast.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

export function registerHandlers(io: TypedServer, roomManager: RoomManager): void {
  io.on('connection', (socket) => {
    console.log(`Connected: ${socket.id}`);

    registerLobbyHandlers(io, socket, roomManager);
    registerGameHandlers(io, socket, roomManager);

    socket.on('disconnect', () => {
      console.log(`Disconnected: ${socket.id}`);
      const result = roomManager.handleDisconnect(socket.id);
      if (result) {
        io.to(result.room.roomCode).emit('player:disconnected', result.playerId);
        broadcastRoomState(io, result.room);
        if (result.room.game) broadcastGameState(io, result.room);
      }
    });
  });
}
