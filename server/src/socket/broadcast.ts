import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';
import type { Room } from '../rooms/Room.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

export function broadcastRoomState(io: TypedServer, room: Room): void {
  io.to(room.roomCode).emit('room:state', room.getRoomState());
}

export function broadcastGameState(io: TypedServer, room: Room): void {
  for (const [playerId] of room.players) {
    const socketId = room.getSocketId(playerId);
    if (!socketId) continue;
    const state = room.getClientGameState(playerId);
    if (state) {
      io.to(socketId).emit('game:state', state);
    }
  }
}
