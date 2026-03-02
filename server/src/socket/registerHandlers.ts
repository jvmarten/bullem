import type { Server } from 'socket.io';
import { GamePhase } from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';
import { RoomManager } from '../rooms/RoomManager.js';
import { BotManager } from '../game/BotManager.js';
import { registerLobbyHandlers } from './lobbyHandlers.js';
import { registerGameHandlers } from './gameHandlers.js';
import { broadcastRoomState, broadcastGameState, broadcastPlayerNames } from './broadcast.js';
import { markContinueReady } from './roundTransition.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

export function registerHandlers(io: TypedServer, roomManager: RoomManager, botManager: BotManager): void {
  io.on('connection', (socket) => {
    console.log(`Connected: ${socket.id}`);

    registerLobbyHandlers(io, socket, roomManager, botManager);
    registerGameHandlers(io, socket, roomManager, botManager);

    socket.on('disconnect', () => {
      console.log(`Disconnected: ${socket.id}`);
      const result = roomManager.handleDisconnect(socket.id);
      if (result) {
        botManager.clearTurnTimer(result.room.roomCode);
        io.to(result.room.roomCode).emit('player:disconnected', result.playerId);
        broadcastRoomState(io, result.room);
        if (result.room.game) {
          if (result.room.gamePhase === GamePhase.ROUND_RESULT) {
            markContinueReady(io, result.room, botManager, result.playerId);
          }
          broadcastGameState(io, result.room);
          // If the disconnected player is the current player and no turn timer is set,
          // schedule an auto-action so the game doesn't get stuck
          if (result.room.gamePhase === GamePhase.PLAYING
            && result.room.game.currentPlayerId === result.playerId
            && !result.room.settings.turnTimer) {
            botManager.scheduleDisconnectAutoAction(result.room, io, result.playerId);
          }
        }
      }
      broadcastPlayerNames(io, roomManager);
    });
  });
}
