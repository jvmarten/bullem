import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, PlayerId } from '@bull-em/shared';
import type { GameReplay } from '@bull-em/shared';
import type { Room } from '../rooms/Room.js';
import type { RoomManager } from '../rooms/RoomManager.js';
import type { PushManager } from '../push/PushManager.js';

/** Module-level push manager reference, set once at startup via {@link setPushManager}. */
let pushManagerRef: PushManager | null = null;

/** Configure the push manager for turn notifications. Called once from index.ts at startup. */
export function setPushManager(pm: PushManager): void {
  pushManagerRef = pm;
}

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

export function broadcastRoomState(io: TypedServer, room: Room): void {
  io.to(room.roomCode).emit('room:state', room.getRoomState());
}

export function broadcastGameState(io: TypedServer, room: Room): void {
  const seriesInfo = room.seriesState ? {
    bestOf: room.seriesState.bestOf,
    currentSet: room.seriesState.currentSet,
    wins: { ...room.seriesState.wins },
    winsNeeded: room.seriesState.winsNeeded,
    seriesWinnerId: room.seriesState.seriesWinnerId,
  } : null;

  for (const [playerId] of room.players) {
    const socketId = room.getSocketId(playerId);
    if (!socketId) continue;
    const state = room.getClientGameState(playerId);
    if (state) {
      state.seriesInfo = seriesInfo;
      io.to(socketId).emit('game:state', state);
    }
  }
  // Send spectator views
  if (room.spectatorSockets.size > 0) {
    const spectatorState = room.getSpectatorGameState();
    if (spectatorState) {
      spectatorState.seriesInfo = seriesInfo;
      for (const sid of room.spectatorSockets) {
        io.to(sid).emit('game:state', spectatorState);
      }
    }
  }
}

export function broadcastNewRound(io: TypedServer, room: Room): void {
  const seriesInfo = room.seriesState ? {
    bestOf: room.seriesState.bestOf,
    currentSet: room.seriesState.currentSet,
    wins: { ...room.seriesState.wins },
    winsNeeded: room.seriesState.winsNeeded,
    seriesWinnerId: room.seriesState.seriesWinnerId,
  } : null;

  for (const [playerId] of room.players) {
    const socketId = room.getSocketId(playerId);
    if (!socketId) continue;
    const state = room.getClientGameState(playerId);
    if (state) {
      state.seriesInfo = seriesInfo;
      io.to(socketId).emit('game:newRound', state);
    }
  }
  // Send spectator views
  if (room.spectatorSockets.size > 0) {
    const spectatorState = room.getSpectatorGameState();
    if (spectatorState) {
      spectatorState.seriesInfo = seriesInfo;
      for (const sid of room.spectatorSockets) {
        io.to(sid).emit('game:newRound', spectatorState);
      }
    }
  }
}

export function broadcastPlayerNames(io: TypedServer, roomManager: RoomManager): void {
  io.emit('server:playerNames', roomManager.getOnlinePlayerNames());
}

/** Build a GameReplay from the engine's recorded round snapshots and emit it to all clients in the room. */
export function broadcastGameReplay(io: TypedServer, room: Room, winnerId: PlayerId): void {
  if (!room.game) return;
  const snapshots = room.game.getRoundSnapshots();
  if (snapshots.length === 0) return;

  const replay: GameReplay = {
    id: `${room.roomCode}-${Date.now()}`,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name })),
    settings: { ...room.settings },
    rounds: snapshots,
    winnerId,
    completedAt: new Date().toISOString(),
  };
  io.to(room.roomCode).emit('game:replay', replay);
}

/**
 * Send a push notification to the current player if they are not actively
 * connected. Bots never receive push notifications.
 */
export function sendTurnPushNotification(io: TypedServer, room: Room): void {
  if (!pushManagerRef || !room.game) return;
  const currentPlayerId = room.game.currentPlayerId;
  const player = room.players.get(currentPlayerId);
  if (!player || player.isBot) return;

  // Only send if the player's socket is not connected
  const socketId = room.getSocketId(currentPlayerId);
  if (socketId) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket?.connected) return;
  }

  // Fire-and-forget — push errors are logged inside PushManager
  void pushManagerRef.notifyTurn(currentPlayerId, room.roomCode);
}
