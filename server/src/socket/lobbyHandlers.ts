import type { Server, Socket } from 'socket.io';
import { MIN_PLAYERS, MAX_PLAYERS, MAX_CARDS, MIN_MAX_CARDS, ONLINE_TURN_TIMER_OPTIONS, MAX_PLAYERS_OPTIONS, GamePhase, PLAYER_NAME_MAX_LENGTH, PLAYER_NAME_PATTERN, BotPlayer } from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents, GameSettings } from '@bull-em/shared';
import { RoomManager } from '../rooms/RoomManager.js';
import { BotManager } from '../game/BotManager.js';
import { randomUUID } from 'crypto';
import { broadcastGameState, broadcastRoomState, broadcastPlayerNames } from './broadcast.js';
import { beginRoundResultPhase, checkRoundContinueComplete } from './roundTransition.js';

/** Validate and sanitize a player name. Returns the cleaned name or null if invalid. */
function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > PLAYER_NAME_MAX_LENGTH) return null;
  if (!PLAYER_NAME_PATTERN.test(trimmed)) return null;
  return trimmed;
}

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export function registerLobbyHandlers(
  io: TypedServer,
  socket: TypedSocket,
  roomManager: RoomManager,
  botManager: BotManager,
): void {
  socket.on('room:create', (data, callback) => {
    const name = sanitizeName(data.playerName);
    if (!name) return callback({ error: 'Invalid name (1-20 chars, letters/numbers/spaces)' });

    const room = roomManager.createRoom();
    const playerId = randomUUID();
    room.addPlayer(socket.id, playerId, name);
    roomManager.assignSocketToRoom(socket.id, room.roomCode);
    socket.join(room.roomCode);
    broadcastRoomState(io, room);
    broadcastPlayerNames(io, roomManager);
    callback({ roomCode: room.roomCode });
  });

  socket.on('room:join', (data, callback) => {
    const name = sanitizeName(data.playerName);
    if (!name) return callback({ error: 'Invalid name (1-20 chars, letters/numbers/spaces)' });

    const room = roomManager.getRoom(data.roomCode);
    if (!room) return callback({ error: 'Room not found' });

    // Check for reconnection
    if (data.playerId && room.handleReconnect(socket.id, data.playerId)) {
      roomManager.assignSocketToRoom(socket.id, room.roomCode);
      socket.join(room.roomCode);
      broadcastRoomState(io, room);
      if (room.game) broadcastGameState(io, room);
      io.to(room.roomCode).emit('player:reconnected', data.playerId);
      broadcastPlayerNames(io, roomManager);
      return callback({ playerId: data.playerId });
    }

    const effectiveMax = roomManager.effectiveMaxPlayers(room);
    if (room.playerCount >= effectiveMax) return callback({ error: 'Room is full' });
    if (room.gamePhase !== GamePhase.LOBBY) return callback({ error: 'Game already in progress' });

    const playerId = randomUUID();
    room.addPlayer(socket.id, playerId, name);
    roomManager.assignSocketToRoom(socket.id, room.roomCode);
    socket.join(room.roomCode);
    broadcastRoomState(io, room);
    broadcastPlayerNames(io, roomManager);
    callback({ playerId });
  });

  socket.on('room:leave', () => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) return;

    const playerId = room.getPlayerId(socket.id);
    botManager.clearTurnTimer(room.roomCode);

    // If a game is in progress, eliminate the player in the engine first
    if (playerId && room.game && room.gamePhase === GamePhase.PLAYING) {
      const result = room.game.eliminatePlayer(playerId);

      // Remove from room after engine elimination (engine keeps its own player list)
      room.removePlayer(socket.id);
      roomManager.removeSocketMapping(socket.id);
      socket.leave(room.roomCode);

      switch (result.type) {
        case 'game_over':
          room.gamePhase = GamePhase.GAME_OVER;
          room.cancelRoundContinueWindow();
          io.to(room.roomCode).emit('game:over', result.winnerId, room.game.getGameStats());
          break;
        case 'resolve':
          beginRoundResultPhase(io, room, botManager, result.result);
          break;
        case 'last_chance':
        case 'continue':
          botManager.scheduleBotTurn(room, io);
          broadcastGameState(io, room);
          break;
      }
    } else if (playerId && room.game && room.gamePhase === GamePhase.ROUND_RESULT) {
      // Leaving during round result — eliminate in engine, check for game over
      const result = room.game.eliminatePlayer(playerId);
      room.removePlayer(socket.id);
      roomManager.removeSocketMapping(socket.id);
      socket.leave(room.roomCode);

      if (result.type === 'game_over') {
        room.gamePhase = GamePhase.GAME_OVER;
        room.cancelRoundContinueWindow();
        io.to(room.roomCode).emit('game:over', result.winnerId, room.game.getGameStats());
      } else {
        // The leaving player may have been the last one who hadn't pressed Continue.
        // Re-check so the remaining players aren't stuck waiting.
        checkRoundContinueComplete(io, room, botManager);
        broadcastGameState(io, room);
      }
    } else {
      room.removePlayer(socket.id);
      roomManager.removeSocketMapping(socket.id);
      socket.leave(room.roomCode);
    }

    // Clean up empty rooms
    if (room.isEmpty) {
      roomManager.deleteRoom(room.roomCode);
    }

    broadcastRoomState(io, room);
    broadcastPlayerNames(io, roomManager);
  });

  socket.on('room:delete', () => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) return;
    const playerId = room.getPlayerId(socket.id);
    if (playerId !== room.hostId) {
      socket.emit('room:error', 'Only the host can close the room');
      return;
    }
    botManager.clearTurnTimer(room.roomCode);
    // Notify all clients in the room
    io.to(room.roomCode).emit('room:deleted');
    // Remove all socket mappings for this room
    roomManager.deleteRoom(room.roomCode);
    broadcastPlayerNames(io, roomManager);
  });

  socket.on('room:list', (callback) => {
    callback({ rooms: roomManager.getAvailableRooms() });
  });

  socket.on('room:listLive', (callback) => {
    callback({ games: roomManager.getLiveGames() });
  });

  socket.on('room:spectate', (data, callback) => {
    const room = roomManager.getRoom(data.roomCode);
    if (!room) return callback({ error: 'Room not found' });
    if (!room.settings.allowSpectators) return callback({ error: 'Spectating not allowed' });
    if (room.gamePhase !== GamePhase.PLAYING && room.gamePhase !== GamePhase.ROUND_RESULT && room.gamePhase !== GamePhase.GAME_OVER) {
      return callback({ error: 'No game in progress' });
    }

    room.spectatorSockets.add(socket.id);
    roomManager.assignSocketToRoom(socket.id, room.roomCode);
    socket.join(room.roomCode);

    // Send initial spectator state
    const state = room.getSpectatorGameState();
    if (state) socket.emit('game:state', state);

    callback({ ok: true });
  });

  socket.on('room:updateSettings', (data) => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) return;
    const playerId = room.getPlayerId(socket.id);
    if (playerId !== room.hostId) {
      socket.emit('room:error', 'Only the host can change settings');
      return;
    }
    // Lock settings once other human players have joined
    if (room.hasOtherHumanPlayers) {
      socket.emit('room:error', 'Settings are locked after other players join');
      return;
    }
    // Validate settings
    const { maxCards, turnTimer } = data.settings;
    if (typeof maxCards !== 'number' || maxCards < MIN_MAX_CARDS || maxCards > MAX_CARDS || !Number.isInteger(maxCards)) {
      socket.emit('room:error', 'Invalid max cards setting');
      return;
    }
    if (typeof turnTimer !== 'number' || !([0, ...ONLINE_TURN_TIMER_OPTIONS] as number[]).includes(turnTimer)) {
      socket.emit('room:error', 'Invalid turn timer setting');
      return;
    }
    const maxPlayers = data.settings.maxPlayers;
    if (maxPlayers !== undefined) {
      if (typeof maxPlayers !== 'number' || maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS || !Number.isInteger(maxPlayers)) {
        socket.emit('room:error', 'Invalid max players setting');
        return;
      }
    }

    // Sanitize boolean settings — coerce to boolean or strip non-boolean values
    const validated: GameSettings = {
      maxCards,
      turnTimer,
      maxPlayers,
      allowSpectators: data.settings.allowSpectators === true,
      spectatorsCanSeeCards: data.settings.spectatorsCanSeeCards === true,
    };

    room.updateSettings(validated);
    broadcastRoomState(io, room);
  });

  socket.on('room:addBot', (data, callback) => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) return callback({ error: 'No room found' });

    const playerId = room.getPlayerId(socket.id);
    if (playerId !== room.hostId) {
      return callback({ error: 'Only the host can add bots' });
    }

    const effectiveMax = roomManager.effectiveMaxPlayers(room);
    if (room.playerCount >= effectiveMax) {
      return callback({ error: 'Room is full' });
    }

    // Validate bot name if provided
    if (data.botName !== undefined) {
      const botNameClean = sanitizeName(data.botName);
      if (!botNameClean) return callback({ error: 'Invalid bot name' });
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
    // Clear cross-round bot memory at the start of each new game
    BotPlayer.resetMemory();
    // Schedule turn first (sets deadline for human), then broadcast with correct deadline
    botManager.scheduleBotTurn(room, io);
    broadcastRoomState(io, room);
    broadcastGameState(io, room);
  });
}
