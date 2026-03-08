import type { Server, Socket } from 'socket.io';
import { MIN_PLAYERS, MAX_PLAYERS, MAX_CARDS, MIN_MAX_CARDS, ONLINE_TURN_TIMER_OPTIONS, MAX_PLAYERS_OPTIONS, LAST_CHANCE_MODES, GamePhase, PLAYER_NAME_MAX_LENGTH, PLAYER_NAME_PATTERN, ROOM_CODE_LENGTH, BotPlayer, BotSpeed, RANKED_SETTINGS, RANKED_BEST_OF, BEST_OF_OPTIONS, AVATAR_OPTIONS } from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents, GameSettings, LastChanceMode, BestOf, BotLevelCategory, PlayerId, SeriesState, AvatarId } from '@bull-em/shared';
import { RoomManager } from '../rooms/RoomManager.js';
import { BotManager } from '../game/BotManager.js';
import { randomUUID } from 'crypto';
import { broadcastGameState, broadcastRoomState, broadcastPlayerNames } from './broadcast.js';
import { beginRoundResultPhase, checkRoundContinueComplete, recordRoundStart, handleSetOver } from './roundTransition.js';
import { getCorrelatedLogger } from '../logger.js';
import { roomsCreatedTotal, playersJoinedTotal } from '../metrics.js';
import { track } from '../analytics/track.js';

/** Validate and sanitize a player name. Returns the cleaned name or null if invalid. */
function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > PLAYER_NAME_MAX_LENGTH) return null;
  if (!PLAYER_NAME_PATTERN.test(trimmed)) return null;
  return trimmed;
}

const ROOM_CODE_PATTERN = /^[A-Z]{4}$/;

/** Validate an avatar ID. Returns the validated ID or undefined if invalid/absent. */
function sanitizeAvatar(raw: unknown): AvatarId | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== 'string') return undefined;
  if (!(AVATAR_OPTIONS as readonly string[]).includes(raw)) return undefined;
  return raw as AvatarId;
}

/** Validate a room code. Returns the uppercased code or null if invalid. */
function sanitizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  if (upper.length !== ROOM_CODE_LENGTH) return null;
  if (!ROOM_CODE_PATTERN.test(upper)) return null;
  return upper;
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
    const log = getCorrelatedLogger();
    const name = sanitizeName(data.playerName);
    if (!name) return callback({ error: 'Invalid name (1-20 chars, letters/numbers/spaces)' });

    // Prevent creating a room when already in one
    const existingRoom = roomManager.getRoomForSocket(socket.id);
    if (existingRoom) return callback({ error: 'Already in a room — leave or close it first' });

    const room = roomManager.createRoom();
    const playerId = randomUUID();
    const avatar = sanitizeAvatar(data.avatar);
    const { player, reconnectToken } = room.addPlayer(socket.id, playerId, name, {
      userId: socket.data.userId,
      avatar,
    });
    // Track authenticated user ID for game history persistence
    if (socket.data.userId) room.setPlayerUserId(playerId, socket.data.userId);
    if (socket.data.role === 'admin') player.isAdmin = true;
    roomManager.assignSocketToRoom(socket.id, room.roomCode);
    roomManager.assignPlayerToRoom(playerId, room.roomCode);
    socket.join(room.roomCode);
    roomsCreatedTotal.inc();
    log.info({ roomCode: room.roomCode, playerName: name }, 'Room created');
    broadcastRoomState(io, room);
    broadcastPlayerNames(io, roomManager);
    roomManager.persistRoom(room);
    callback({ roomCode: room.roomCode, reconnectToken });
  });

  socket.on('room:join', (data, callback) => {
    const log = getCorrelatedLogger();
    const name = sanitizeName(data.playerName);
    if (!name) return callback({ error: 'Invalid name (1-20 chars, letters/numbers/spaces)' });

    const roomCode = sanitizeRoomCode(data.roomCode);
    if (!roomCode) return callback({ error: 'Invalid room code' });

    const room = roomManager.getRoom(roomCode);
    if (!room) return callback({ error: 'Room not found' });

    // Check for session transfer — authenticated user already connected in
    // this room from a different socket (different device/tab, same userId).
    // This must run before the reconnect check: the player is still connected,
    // so handleReconnect (which requires isConnected === false) would reject.
    if (socket.data.userId) {
      const transfer = room.handleSessionTransfer(socket.id, socket.data.userId);
      if (transfer) {
        // Notify the old socket before booting it from the room
        const oldSocket = io.sockets.sockets.get(transfer.oldSocketId);
        if (oldSocket) {
          oldSocket.emit('session:transferred');
          oldSocket.leave(room.roomCode);
        }
        roomManager.removeSocketMapping(transfer.oldSocketId);
        roomManager.assignSocketToRoom(socket.id, room.roomCode);
        socket.join(room.roomCode);
        log.info({ roomCode, playerId: transfer.playerId, oldSocketId: transfer.oldSocketId }, 'Session transferred to new socket');
        broadcastRoomState(io, room);
        if (room.game) broadcastGameState(io, room);
        broadcastPlayerNames(io, roomManager);
        roomManager.persistRoom(room);
        return callback({ playerId: transfer.playerId, reconnectToken: transfer.reconnectToken });
      }
    }

    // Check for reconnection — requires the secret reconnect token
    if (data.playerId) {
      const newToken = room.handleReconnect(socket.id, data.playerId, data.reconnectToken);
      if (newToken) {
        roomManager.assignSocketToRoom(socket.id, room.roomCode);
        socket.join(room.roomCode);
        log.info({ roomCode, playerId: data.playerId }, 'Player reconnected');
        broadcastRoomState(io, room);
        if (room.game) broadcastGameState(io, room);
        io.to(room.roomCode).emit('player:reconnected', data.playerId);
        broadcastPlayerNames(io, roomManager);
        roomManager.persistRoom(room);
        // Return the rotated reconnect token so the client stores it for future reconnects
        return callback({ playerId: data.playerId, reconnectToken: newToken });
      }
    }

    const effectiveMax = roomManager.effectiveMaxPlayers(room);
    if (room.playerCount >= effectiveMax) return callback({ error: 'Room is full' });
    if (room.gamePhase !== GamePhase.LOBBY) return callback({ error: 'Game already in progress' });

    // Prevent duplicate names within the same room — confusing for all players.
    // Exclude disconnected players: they will be removed when their disconnect
    // timer fires. This prevents a false "name already taken" error when a
    // player leaves and tries to rejoin before the old entry is cleaned up.
    const nameLower = name.toLowerCase();
    const nameExists = [...room.players.values()].some(
      p => p.name.toLowerCase() === nameLower && p.isConnected,
    );
    if (nameExists) return callback({ error: 'Name already taken in this room' });

    const playerId = randomUUID();
    const avatar = sanitizeAvatar(data.avatar);
    const { player, reconnectToken } = room.addPlayer(socket.id, playerId, name, {
      userId: socket.data.userId,
      avatar,
    });
    // Track authenticated user ID for game history persistence
    if (socket.data.userId) room.setPlayerUserId(playerId, socket.data.userId);
    if (socket.data.role === 'admin') player.isAdmin = true;
    roomManager.assignSocketToRoom(socket.id, room.roomCode);
    roomManager.assignPlayerToRoom(playerId, room.roomCode);
    socket.join(room.roomCode);
    playersJoinedTotal.inc();
    log.info({ roomCode, playerName: name }, 'Player joined room');
    broadcastRoomState(io, room);
    broadcastPlayerNames(io, roomManager);
    roomManager.persistRoom(room);
    callback({ playerId, reconnectToken });
  });

  socket.on('room:leave', () => {
    const log = getCorrelatedLogger();
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) return;

    // If this socket is a spectator, clean up and exit early
    if (room.spectatorSockets.has(socket.id)) {
      room.spectatorSockets.delete(socket.id);
      room.spectatorNames.delete(socket.id);
      roomManager.removeSocketMapping(socket.id);
      socket.leave(room.roomCode);
      // Notify players that spectator count changed
      broadcastRoomState(io, room);
      return;
    }

    const playerId = room.getPlayerId(socket.id);
    log.info({ roomCode: room.roomCode }, 'Player left room');
    botManager.clearTurnTimer(room.roomCode);

    // If a game is in progress, eliminate the player in the engine first.
    // Use detachPlayer (not removePlayer) to keep the player in the room's
    // player Map so their stats and userId are available for game persistence
    // and rating updates when the game ends. Without this, a player who
    // leaves mid-game would have no game_players entry, and in ranked games
    // could exploit this to avoid rating loss.
    if (playerId && room.game && room.gamePhase === GamePhase.PLAYING) {
      room.recordEliminations([playerId]);
      const result = room.game.eliminatePlayer(playerId);

      room.detachPlayer(socket.id);
      roomManager.removeSocketMapping(socket.id);
      roomManager.removePlayerMapping(playerId);
      socket.leave(room.roomCode);

      switch (result.type) {
        case 'game_over':
          room.cancelRoundContinueWindow();
          handleSetOver(io, room, roomManager, botManager, result.winnerId);
          break;
        case 'resolve':
          beginRoundResultPhase(io, room, botManager, result.result, roomManager);
          break;
        case 'last_chance':
        case 'continue':
          botManager.scheduleBotTurn(room, io);
          broadcastGameState(io, room);
          break;
      }
    } else if (playerId && room.game && room.gamePhase === GamePhase.ROUND_RESULT) {
      // Leaving during round result — eliminate in engine, check for game over
      room.recordEliminations([playerId]);
      const result = room.game.eliminatePlayer(playerId);
      room.detachPlayer(socket.id);
      roomManager.removeSocketMapping(socket.id);
      roomManager.removePlayerMapping(playerId);
      socket.leave(room.roomCode);

      if (result.type === 'game_over') {
        room.cancelRoundContinueWindow();
        handleSetOver(io, room, roomManager, botManager, result.winnerId);
      } else {
        // The leaving player may have been the last one who hadn't pressed Continue.
        // Re-check so the remaining players aren't stuck waiting.
        checkRoundContinueComplete(io, room, botManager, roomManager);
        broadcastGameState(io, room);
      }
    } else {
      room.removePlayer(socket.id);
      roomManager.removeSocketMapping(socket.id);
      if (playerId) roomManager.removePlayerMapping(playerId);
      socket.leave(room.roomCode);
    }

    // Clean up empty rooms
    if (room.isEmpty) {
      roomManager.deleteRoom(room.roomCode);
    } else {
      broadcastRoomState(io, room);
      roomManager.persistRoom(room);
    }
    broadcastPlayerNames(io, roomManager);
  });

  socket.on('room:delete', () => {
    const log = getCorrelatedLogger();
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) return;
    const playerId = room.getPlayerId(socket.id);
    if (playerId !== room.hostId) {
      socket.emit('room:error', 'Only the host can close the room');
      return;
    }
    log.info({ roomCode: room.roomCode }, 'Room deleted by host');
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
    const roomCode = sanitizeRoomCode(data.roomCode);
    if (!roomCode) return callback({ error: 'Invalid room code' });

    const room = roomManager.getRoom(roomCode);
    if (!room) return callback({ error: 'Room not found' });
    if (!room.settings.allowSpectators) return callback({ error: 'Spectating not allowed' });
    if (room.gamePhase !== GamePhase.PLAYING && room.gamePhase !== GamePhase.ROUND_RESULT && room.gamePhase !== GamePhase.GAME_OVER) {
      return callback({ error: 'No game in progress' });
    }

    room.spectatorSockets.add(socket.id);
    // Store spectator display name for chat (from auth or fallback)
    if (socket.data.username) {
      room.spectatorNames.set(socket.id, socket.data.username);
    }
    roomManager.assignSocketToRoom(socket.id, room.roomCode);
    socket.join(room.roomCode);

    // Send initial spectator state
    const state = room.getSpectatorGameState();
    if (state) socket.emit('game:state', state);

    // Send accumulated game stats so spectator stats show data from the start
    if (room.game) socket.emit('game:spectatorStats', room.game.getGameStats());

    // Notify players that spectator count changed
    broadcastRoomState(io, room);

    callback({ ok: true });
  });

  socket.on('room:watchRandom', (callback) => {
    const roomCode = roomManager.getRandomLiveGame();
    if (!roomCode) return callback({ error: 'No live games available' });

    const room = roomManager.getRoom(roomCode);
    if (!room) return callback({ error: 'No live games available' });

    room.spectatorSockets.add(socket.id);
    // Store spectator display name for chat (from auth or fallback)
    if (socket.data.username) {
      room.spectatorNames.set(socket.id, socket.data.username);
    }
    roomManager.assignSocketToRoom(socket.id, room.roomCode);
    socket.join(room.roomCode);

    // Send initial spectator state
    const state = room.getSpectatorGameState();
    if (state) socket.emit('game:state', state);

    // Send accumulated game stats so spectator stats show data from the start
    if (room.game) socket.emit('game:spectatorStats', room.game.getGameStats());

    // Notify players that spectator count changed
    broadcastRoomState(io, room);

    callback({ roomCode: room.roomCode });
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

    // Reject if data.settings is not a plain object (prevents prototype pollution)
    if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) {
      socket.emit('room:error', 'Invalid settings payload');
      return;
    }

    // Validate required fields
    const { maxCards, turnTimer } = data.settings;
    if (typeof maxCards !== 'number' || maxCards < MIN_MAX_CARDS || maxCards > MAX_CARDS || !Number.isInteger(maxCards)) {
      socket.emit('room:error', 'Invalid max cards setting');
      return;
    }
    if (typeof turnTimer !== 'number' || !(ONLINE_TURN_TIMER_OPTIONS as readonly number[]).includes(turnTimer)) {
      socket.emit('room:error', 'Invalid turn timer setting');
      return;
    }

    // Validate maxPlayers against the allowlist of supported values
    const maxPlayers = data.settings.maxPlayers;
    if (maxPlayers !== undefined) {
      if (typeof maxPlayers !== 'number' || !(MAX_PLAYERS_OPTIONS as readonly number[]).includes(maxPlayers)) {
        socket.emit('room:error', 'Invalid max players setting');
        return;
      }
    }

    // Validate botSpeed against enum values
    const botSpeed = data.settings.botSpeed;
    if (botSpeed !== undefined && !Object.values(BotSpeed).includes(botSpeed as BotSpeed)) {
      socket.emit('room:error', 'Invalid bot speed setting');
      return;
    }

    // Validate lastChanceMode against the shared constant
    const lastChanceMode = data.settings.lastChanceMode;
    if (lastChanceMode !== undefined && !(LAST_CHANCE_MODES as readonly string[]).includes(lastChanceMode)) {
      socket.emit('room:error', 'Invalid last chance mode setting');
      return;
    }

    // Validate bestOf against allowed values (only relevant for 1v1)
    const bestOf = data.settings.bestOf;
    if (bestOf !== undefined && !(BEST_OF_OPTIONS as readonly number[]).includes(bestOf)) {
      socket.emit('room:error', 'Invalid best-of setting');
      return;
    }

    // Validate botLevelCategory against the known literal values
    const VALID_BOT_LEVEL_CATEGORIES = ['easy', 'normal', 'hard', 'mixed'] as const;
    const botLevelCategory = data.settings.botLevelCategory;
    if (botLevelCategory !== undefined && !VALID_BOT_LEVEL_CATEGORIES.includes(botLevelCategory)) {
      socket.emit('room:error', 'Invalid bot level category');
      return;
    }

    // Build a validated settings object — only pick known fields to prevent
    // unexpected properties from leaking into game state.
    const ranked = data.settings.ranked === true;
    const validated: GameSettings = ranked
      ? {
          // Ranked games enforce locked settings — player choices are ignored
          maxCards: RANKED_SETTINGS.maxCards,
          turnTimer: RANKED_SETTINGS.turnTimer,
          maxPlayers: RANKED_SETTINGS.maxPlayers,
          lastChanceMode: RANKED_SETTINGS.lastChanceMode,
          allowSpectators: data.settings.allowSpectators === true,
          spectatorsCanSeeCards: data.settings.spectatorsCanSeeCards === true,
          botSpeed: botSpeed as BotSpeed | undefined,
          botLevelCategory: botLevelCategory as BotLevelCategory | undefined,
          ranked: true,
          // bestOf is set server-side for ranked (Bo3 for 1v1)
          // rankedMode is set server-side at game start based on actual player count
        }
      : {
          maxCards,
          turnTimer,
          maxPlayers,
          allowSpectators: data.settings.allowSpectators === true,
          spectatorsCanSeeCards: data.settings.spectatorsCanSeeCards === true,
          botSpeed: botSpeed as BotSpeed | undefined,
          botLevelCategory: botLevelCategory as BotLevelCategory | undefined,
          lastChanceMode: (lastChanceMode as LastChanceMode | undefined) ?? 'classic',
          bestOf: bestOf as BestOf | undefined,
        };

    room.updateSettings(validated);
    broadcastRoomState(io, room);
    roomManager.persistRoom(room);
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

    // Validate and sanitize bot name if provided — use the cleaned value,
    // not the raw input, to prevent bypassing the name pattern check.
    let sanitizedBotName: string | undefined;
    if (data.botName !== undefined) {
      const botNameClean = sanitizeName(data.botName);
      if (!botNameClean) return callback({ error: 'Invalid bot name' });
      sanitizedBotName = botNameClean;
    }

    try {
      const botId = botManager.addBot(room, sanitizedBotName);
      roomManager.assignPlayerToRoom(botId, room.roomCode);
      broadcastRoomState(io, room);
      roomManager.persistRoom(room);
      callback({ botId });
    } catch (e) {
      callback({ error: e instanceof Error ? e.message : 'Failed to add bot' });
    }
  });

  socket.on('room:kickPlayer', (data, callback) => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) return callback({ error: 'No room found' });

    const hostPlayerId = room.getPlayerId(socket.id);
    if (hostPlayerId !== room.hostId) {
      return callback({ error: 'Only the host can kick players' });
    }

    if (room.gamePhase !== GamePhase.LOBBY) {
      return callback({ error: 'Can only kick players in the lobby' });
    }

    if (typeof data.playerId !== 'string' || !data.playerId) {
      return callback({ error: 'Invalid player ID' });
    }

    if (data.playerId === hostPlayerId) {
      return callback({ error: 'Cannot kick yourself' });
    }

    const targetPlayer = room.players.get(data.playerId);
    if (!targetPlayer) {
      return callback({ error: 'Player not found' });
    }

    // Bots should be removed via room:removeBot
    if (targetPlayer.isBot) {
      return callback({ error: 'Use remove bot to remove bots' });
    }

    const targetSocketId = room.getSocketId(data.playerId);
    if (targetSocketId) {
      // Notify the kicked player before removing them
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('room:kicked');
        targetSocket.leave(room.roomCode);
      }
      room.removePlayer(targetSocketId);
      roomManager.removeSocketMapping(targetSocketId);
    }
    roomManager.removePlayerMapping(data.playerId);

    broadcastRoomState(io, room);
    broadcastPlayerNames(io, roomManager);
    roomManager.persistRoom(room);
    callback({ ok: true });
  });

  socket.on('room:removeBot', (data) => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) return;

    const playerId = room.getPlayerId(socket.id);
    if (playerId !== room.hostId) {
      socket.emit('room:error', 'Only the host can remove bots');
      return;
    }

    if (typeof data.botId !== 'string' || !data.botId) {
      socket.emit('room:error', 'Invalid bot ID');
      return;
    }

    botManager.removeBot(room, data.botId);
    roomManager.removePlayerMapping(data.botId);
    broadcastRoomState(io, room);
    roomManager.persistRoom(room);
  });

  socket.on('game:start', () => {
    const log = getCorrelatedLogger();
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
    // Set rankedMode based on actual player count before starting
    if (room.settings.ranked) {
      const humanCount = [...room.players.values()].filter(p => !p.isBot).length;
      // Only allow ranked if all human players are authenticated
      const allAuthenticated = [...room.players.values()]
        .filter(p => !p.isBot)
        .every(p => room.playerUserIds.has(p.id));
      if (!allAuthenticated) {
        socket.emit('room:error', 'All players must be logged in for ranked games');
        return;
      }
      room.settings.rankedMode = humanCount === 2 ? 'heads_up' : 'multiplayer';
      // Ranked 1v1 is always Bo3
      if (room.settings.rankedMode === 'heads_up') {
        room.settings.bestOf = RANKED_BEST_OF;
      }
    }

    // Initialize series state for 1v1 best-of matches
    const bestOf = room.settings.bestOf ?? 1;
    if (bestOf > 1 && room.playerCount === 2) {
      const playerIds = [...room.players.keys()] as [PlayerId, PlayerId];
      room.seriesState = {
        bestOf: bestOf as BestOf,
        currentSet: 1,
        wins: { [playerIds[0]]: 0, [playerIds[1]]: 0 },
        winsNeeded: Math.ceil(bestOf / 2),
        seriesWinnerId: null,
        playerIds,
      };
    } else {
      room.seriesState = null;
    }

    room.startGame();
    recordRoundStart(room.roomCode);
    log.info({ roomCode: room.roomCode, playerCount: room.playerCount, ranked: room.settings.ranked ?? false, bestOf }, 'Game started');
    track('game:started', {
      roomCode: room.roomCode,
      playerCount: room.playerCount,
      settings: { ...room.settings },
      ranked: room.settings.ranked ?? false,
    });

    // Capture initial turn order so we can track starting position vs win rate
    // at game completion (when we know who won). Store on the room for later use.
    if (room.game) {
      room.initialTurnOrder = room.game.getActivePlayers().map(p => p.id);
    }

    // Clear cross-round bot memory for this room's scope
    BotPlayer.resetMemory(room.roomCode);
    // Schedule turn first (sets deadline for human), then broadcast with correct deadline
    botManager.scheduleBotTurn(room, io);
    broadcastRoomState(io, room);
    broadcastGameState(io, room);
    roomManager.persistRoom(room);
  });

  socket.on('game:rematch', () => {
    const log = getCorrelatedLogger();
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) return;
    const playerId = room.getPlayerId(socket.id);
    if (playerId !== room.hostId) {
      socket.emit('room:error', 'Only the host can start a rematch');
      return;
    }
    if (room.gamePhase !== GamePhase.GAME_OVER) {
      socket.emit('room:error', 'Game is not over');
      return;
    }
    if (room.playerCount < MIN_PLAYERS) {
      socket.emit('room:error', `Need at least ${MIN_PLAYERS} players for a rematch`);
      return;
    }

    botManager.clearTurnTimer(room.roomCode);
    // Notify clients the rematch is starting (so they can clear results state)
    io.to(room.roomCode).emit('game:rematchStarting');

    // Reset series state for a fresh best-of match (fixes stale set counts after BO3)
    const bestOf = room.settings.bestOf ?? 1;
    if (bestOf > 1 && room.playerCount === 2) {
      const playerIds = [...room.players.keys()] as [PlayerId, PlayerId];
      room.seriesState = {
        bestOf: bestOf as BestOf,
        currentSet: 1,
        wins: { [playerIds[0]]: 0, [playerIds[1]]: 0 },
        winsNeeded: Math.ceil(bestOf / 2),
        seriesWinnerId: null,
        playerIds,
      };
    } else {
      room.seriesState = null;
    }

    room.resetForRematch();
    recordRoundStart(room.roomCode);
    log.info({ roomCode: room.roomCode }, 'Rematch started');
    BotPlayer.resetMemory(room.roomCode);
    botManager.scheduleBotTurn(room, io);
    broadcastRoomState(io, room);
    broadcastGameState(io, room);
    roomManager.persistRoom(room);
  });
}
