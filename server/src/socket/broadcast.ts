import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';
import type { Room } from '../rooms/Room.js';
import type { RoomManager } from '../rooms/RoomManager.js';

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
  // Send spectator views
  if (room.spectatorSockets.size > 0) {
    const spectatorState = room.getSpectatorGameState();
    if (spectatorState) {
      for (const sid of room.spectatorSockets) {
        io.to(sid).emit('game:state', spectatorState);
      }
    }
  }
}

export function broadcastNewRound(io: TypedServer, room: Room): void {
  for (const [playerId] of room.players) {
    const socketId = room.getSocketId(playerId);
    if (!socketId) continue;
    const state = room.getClientGameState(playerId);
    if (state) {
      io.to(socketId).emit('game:newRound', state);
    }
  }
  // Send spectator views
  if (room.spectatorSockets.size > 0) {
    const spectatorState = room.getSpectatorGameState();
    if (spectatorState) {
      for (const sid of room.spectatorSockets) {
        io.to(sid).emit('game:newRound', spectatorState);
      }
    }
  }
}

export function broadcastPlayerNames(io: TypedServer, roomManager: RoomManager): void {
  io.emit('server:playerNames', roomManager.getOnlinePlayerNames());
}
