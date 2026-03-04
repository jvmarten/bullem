import type { Server } from 'socket.io';
import {
  ROOM_CODE_LENGTH, ROOM_CLEANUP_INTERVAL_MS, ROOM_MAX_INACTIVE_MS,
  GamePhase, MAX_PLAYERS, maxPlayersForMaxCards,
} from '@bull-em/shared';
import type { RoomListing, LiveGameListing, ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';
import { Room } from './Room.js';

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

  createRoom(): Room {
    let code: string;
    do {
      code = generateRoomCode();
    } while (this.rooms.has(code));

    const room = new Room(code);
    this.rooms.set(code, room);
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
      // Clean up player → room mappings before destroying the room
      for (const playerId of room.players.keys()) {
        this.playerToRoom.delete(playerId);
      }
      room.cleanup();
    }
    this.rooms.delete(roomCode);
    this.cachedPlayerNames = null;
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
      });
    }
    return listings;
  }

  effectiveMaxPlayers(room: Room): number {
    const cardBased = maxPlayersForMaxCards(room.settings.maxCards);
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
        if (!player.isBot) names.push(player.name);
      }
    }
    this.cachedPlayerNames = names;
    return names;
  }

  private io: TypedServer | null = null;

  startCleanup(io?: TypedServer): void {
    if (this.cleanupTimer) return;
    if (io) this.io = io;
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
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
