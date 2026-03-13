import crypto from 'node:crypto';
import type { Server } from 'socket.io';
import {
  ROOM_CODE_LENGTH, ROOM_CLEANUP_INTERVAL_MS, ROOM_MAX_INACTIVE_MS,
  GamePhase, MAX_PLAYERS, maxPlayersForMaxCards,
} from '@bull-em/shared';
import type { RoomListing, LiveGameListing, ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';
import { Room } from './Room.js';
import type { RedisStore } from './RedisStore.js';
import { cleanupRoundStartTime } from '../socket/roundTransition.js';
import logger from '../logger.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

export class RoomManager {
  private rooms = new Map<string, Room>();
  private socketToRoom = new Map<string, string>();
  /** Reverse index: roomCode → socketIds. Enables O(room_size) deleteRoom cleanup
   *  instead of scanning every socket across all rooms. */
  private roomToSockets = new Map<string, Set<string>>();
  /** O(1) index: playerId → roomCode. Maintained alongside Room.players. */
  private playerToRoom = new Map<string, string>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** Cached result of getOnlinePlayerNames. Invalidated when players change. */
  private cachedPlayerNames: string[] | null = null;

  /** Optional Redis persistence layer. When set, room state is persisted on
   *  every mutation and rooms are restored from Redis on startup. */
  private redisStore: RedisStore | null = null;

  /** Attach a Redis store for session persistence. Must be called before
   *  restoreFromRedis() and before any rooms are created. */
  setRedisStore(store: RedisStore): void {
    this.redisStore = store;
  }

  /** Persist a room's current state to Redis (fire-and-forget).
   *  Call after any mutation that changes room or game state. */
  persistRoom(room: Room): void {
    if (!this.redisStore) return;
    // Fire-and-forget: don't await — errors logged inside RedisStore
    void this.redisStore.persist(room);
  }

  /** Restore all rooms from Redis into memory. Called once at startup.
   *  Rebuilds the in-memory indices (playerToRoom, etc.) from restored rooms.
   *  Human players are marked disconnected — they must reconnect normally. */
  async restoreFromRedis(): Promise<number> {
    if (!this.redisStore) return 0;
    const rooms = await this.redisStore.restoreAll();
    for (const room of rooms) {
      this.rooms.set(room.roomCode, room);
      // Rebuild player → room index for all players (humans + bots)
      for (const playerId of room.players.keys()) {
        this.playerToRoom.set(playerId, room.roomCode);
      }
    }
    this.cachedPlayerNames = null;
    if (rooms.length > 0) {
      logger.info({ count: rooms.length }, 'Rooms restored into RoomManager from Redis');
    }
    return rooms.length;
  }

  createRoom(): Room {
    let code: string;
    do {
      code = generateRoomCode();
    } while (this.rooms.has(code));

    const room = new Room(code);
    this.rooms.set(code, room);
    this.persistRoom(room);
    return room;
  }

  getRoom(roomCode: string): Room | undefined {
    return this.rooms.get(roomCode.toUpperCase());
  }

  getRoomForSocket(socketId: string): Room | undefined {
    const code = this.socketToRoom.get(socketId);
    return code ? this.rooms.get(code) : undefined;
  }

  assignSocketToRoom(socketId: string, roomCode: string): void {
    this.socketToRoom.set(socketId, roomCode);
    let sockets = this.roomToSockets.get(roomCode);
    if (!sockets) {
      sockets = new Set();
      this.roomToSockets.set(roomCode, sockets);
    }
    sockets.add(socketId);
  }

  /** Register a player → room mapping for O(1) lookups. */
  assignPlayerToRoom(playerId: string, roomCode: string): void {
    this.playerToRoom.set(playerId, roomCode);
    this.cachedPlayerNames = null;
  }

  /** Remove a player → room mapping. */
  removePlayerMapping(playerId: string): void {
    this.playerToRoom.delete(playerId);
    this.cachedPlayerNames = null;
  }

  handleDisconnect(socketId: string, onTimeout?: (playerId: string) => void): { room: Room; playerId: string } | null {
    const room = this.getRoomForSocket(socketId);
    if (!room) return null;

    const playerId = room.handleDisconnect(socketId, onTimeout);
    this.socketToRoom.delete(socketId);
    this.roomToSockets.get(room.roomCode)?.delete(socketId);

    // If the player was fully removed (lobby phase), clean up the index
    if (playerId && !room.players.has(playerId)) {
      this.playerToRoom.delete(playerId);
      this.cachedPlayerNames = null;
    }

    if (room.isEmpty) {
      // deleteRoom will clean up remaining player mappings
      this.deleteRoom(room.roomCode);
      return null;
    }

    return playerId ? { room, playerId } : null;
  }

  removeSocketMapping(socketId: string): void {
    const roomCode = this.socketToRoom.get(socketId);
    this.socketToRoom.delete(socketId);
    if (roomCode) {
      this.roomToSockets.get(roomCode)?.delete(socketId);
    }
  }

  deleteRoom(roomCode: string): void {
    const room = this.rooms.get(roomCode);
    if (room) {
      // Clear bot timers and bot-specific data before destroying the room
      if (this.onRoomCleanup) this.onRoomCleanup(roomCode, room);
      // Clean up player → room mappings before destroying the room
      for (const playerId of room.players.keys()) {
        this.playerToRoom.delete(playerId);
      }
      room.cleanup();
    }
    // Clean up round-start metric tracking for this room. Without this,
    // rooms deleted mid-game (stale cleanup, host delete) leak an entry.
    cleanupRoundStartTime(roomCode);
    this.rooms.delete(roomCode);
    this.cachedPlayerNames = null;
    // Remove from Redis persistence
    if (this.redisStore) {
      void this.redisStore.remove(roomCode);
    }
    // Clean up socket mappings using the reverse index (O(room_size) instead
    // of O(total_sockets) — avoids scanning every socket across all rooms).
    const sockets = this.roomToSockets.get(roomCode);
    if (sockets) {
      for (const socketId of sockets) {
        this.socketToRoom.delete(socketId);
      }
      this.roomToSockets.delete(roomCode);
    }
  }

  getAvailableRooms(): RoomListing[] {
    const listings: RoomListing[] = [];
    for (const room of this.rooms.values()) {
      if (room.gamePhase !== GamePhase.LOBBY) continue;
      // Only show public rooms in the browse list
      if (!room.settings.isPublic) continue;
      const effectiveMax = this.effectiveMaxPlayers(room);
      if (room.playerCount >= effectiveMax) continue;
      // O(1) host name via Room.hostName getter instead of scanning player map
      listings.push({
        roomCode: room.roomCode,
        playerCount: room.playerCount,
        maxPlayers: effectiveMax,
        hostName: room.hostName,
        settings: { ...room.settings },
      });
    }
    return listings;
  }

  getLiveGames(): LiveGameListing[] {
    const listings: LiveGameListing[] = [];
    for (const room of this.rooms.values()) {
      if (room.gamePhase !== GamePhase.PLAYING && room.gamePhase !== GamePhase.ROUND_RESULT) continue;
      if (!room.settings.allowSpectators) continue;
      const state = room.getSpectatorGameState();
      // O(1) host name via Room.hostName getter instead of scanning player map
      listings.push({
        roomCode: room.roomCode,
        playerCount: room.playerCount,
        hostName: room.hostName,
        roundNumber: state?.roundNumber ?? 0,
        spectatorsCanSeeCards: room.settings.spectatorsCanSeeCards ?? false,
        spectatorCount: room.spectatorSockets.size,
      });
    }
    return listings;
  }

  /** Return the room code of a random spectatable live game, or undefined if none exist. */
  getRandomLiveGame(): string | undefined {
    const candidates: string[] = [];
    for (const room of this.rooms.values()) {
      if (room.gamePhase !== GamePhase.PLAYING && room.gamePhase !== GamePhase.ROUND_RESULT) continue;
      if (!room.settings.allowSpectators) continue;
      candidates.push(room.roomCode);
    }
    if (candidates.length === 0) return undefined;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  effectiveMaxPlayers(room: Room): number {
    const cardBased = maxPlayersForMaxCards(room.settings.maxCards, room.settings.jokerCount ?? 0);
    const userCap = room.settings.maxPlayers ?? MAX_PLAYERS;
    return Math.min(MAX_PLAYERS, cardBased, userCap);
  }

  getRoomForPlayer(playerId: string): Room | undefined {
    const code = this.playerToRoom.get(playerId);
    return code ? this.rooms.get(code) : undefined;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  /** Invalidate the cached player names list. Call whenever players are
   *  added, removed, or rooms are created/deleted. */
  invalidatePlayerNamesCache(): void {
    this.cachedPlayerNames = null;
  }

  getOnlinePlayerNames(): string[] {
    if (this.cachedPlayerNames) return this.cachedPlayerNames;
    const names: string[] = [];
    for (const room of this.rooms.values()) {
      for (const player of room.players.values()) {
        if (!player.isBot && player.isConnected) names.push(player.name);
      }
    }
    this.cachedPlayerNames = names;
    return names;
  }

  private io: TypedServer | null = null;
  /** Optional callback invoked when a room is about to be deleted. Used to
   *  clear bot turn timers and clean up bot-specific data (profile configs,
   *  user IDs) that are stored in BotManager outside the room itself. */
  private onRoomCleanup: ((roomCode: string, room: Room) => void) | null = null;

  startCleanup(io?: TypedServer, onRoomCleanup?: (roomCode: string, room: Room) => void): void {
    if (this.cleanupTimer) return;
    if (io) this.io = io;
    if (onRoomCleanup) this.onRoomCleanup = onRoomCleanup;
    this.cleanupTimer = setInterval(() => this.cleanupStaleRooms(), ROOM_CLEANUP_INTERVAL_MS);
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private cleanupStaleRooms(): void {
    const now = Date.now();
    // Collect codes first to avoid mutating the map during iteration
    const staleCodes: string[] = [];
    for (const [code, room] of this.rooms) {
      if (room.isBackgroundGame) continue;
      if (room.isEmpty || now - room.lastActivity > ROOM_MAX_INACTIVE_MS) {
        staleCodes.push(code);
      }
    }
    for (const code of staleCodes) {
      // Notify any remaining connected sockets (spectators, players) before
      // deleting the room — otherwise they'll be stuck waiting forever.
      if (this.io) {
        this.io.to(code).emit('room:deleted');
      }
      this.deleteRoom(code);
    }
  }
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(ROOM_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += chars[bytes[i]! % chars.length];
  }
  return code;
}
