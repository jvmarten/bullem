import type { Server } from 'socket.io';
import { GamePhase } from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';
import { RoomManager } from '../rooms/RoomManager.js';
import { BotManager } from '../game/BotManager.js';
import { registerLobbyHandlers } from './lobbyHandlers.js';
import { registerGameHandlers } from './gameHandlers.js';
import { broadcastRoomState, broadcastGameState, broadcastPlayerNames } from './broadcast.js';
import { markContinueReady, beginRoundResultPhase } from './roundTransition.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

export function registerHandlers(io: TypedServer, roomManager: RoomManager, botManager: BotManager): void {
  io.on('connection', (socket) => {
    console.log(`Connected: ${socket.id}`);

    registerLobbyHandlers(io, socket, roomManager, botManager);
    registerGameHandlers(io, socket, roomManager, botManager);

    socket.on('disconnect', () => {
      console.log(`Disconnected: ${socket.id}`);

      // Callback fired when the 30s disconnect timer expires and the player
      // hasn't reconnected. Properly eliminates the player through the game
      // engine so turn order, game-over checks, and round resolution all work.
      const onDisconnectTimeout = (playerId: string): void => {
        const room = roomManager.getRoomForPlayer(playerId);
        if (!room || !room.game) return;

        botManager.clearTurnTimer(room.roomCode);
        const elimResult = room.game.eliminatePlayer(playerId);

        switch (elimResult.type) {
          case 'game_over':
            room.gamePhase = GamePhase.GAME_OVER;
            room.cancelRoundContinueWindow();
            io.to(room.roomCode).emit('game:over', elimResult.winnerId, room.game.getGameStats());
            break;
          case 'resolve':
            beginRoundResultPhase(io, room, botManager, elimResult.result);
            break;
          case 'last_chance':
          case 'continue':
            botManager.scheduleBotTurn(room, io);
            broadcastGameState(io, room);
            break;
        }
        broadcastRoomState(io, room);
      };

      const result = roomManager.handleDisconnect(socket.id, onDisconnectTimeout);
      if (result) {
        // Do NOT clear the turn timer here. If a turn timer is running for the
        // current player, it should keep ticking — the auto-action will fire
        // when it expires regardless of connection status. Clearing it on any
        // disconnect (including non-current players) was an exploit: close the
        // browser, reconnect, and the timer is gone → unlimited turn time.
        io.to(result.room.roomCode).emit('player:disconnected', result.playerId);
        broadcastRoomState(io, result.room);
        if (result.room.game) {
          if (result.room.gamePhase === GamePhase.ROUND_RESULT) {
            markContinueReady(io, result.room, botManager, result.playerId);
          }
          broadcastGameState(io, result.room);
          // If the disconnected player is the current player and no turn timer
          // is configured, schedule a disconnect auto-action so the game
          // doesn't stall. When a turn timer IS configured, it keeps running
          // independently and will fire the auto-action when it expires.
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
