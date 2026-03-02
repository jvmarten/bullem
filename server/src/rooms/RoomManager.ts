import {
  ROOM_CODE_LENGTH, ROOM_CLEANUP_INTERVAL_MS, ROOM_MAX_INACTIVE_MS,
  GamePhase, MAX_PLAYERS, maxPlayersForMaxCards,
} from '@bull-em/shared';
import type { RoomListing } from '@bull-em/shared';
import { Room } from './Room.js';

export class RoomManager {
  private rooms = new Map<string, Room>();
  private socketToRoom = new Map<string, string>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

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
  }

  handleDisconnect(socketId: string): { room: Room; playerId: string } | null {
    const room = this.getRoomForSocket(socketId);
    if (!room) return null;

    const playerId = room.handleDisconnect(socketId);
    this.socketToRoom.delete(socketId);

    if (room.isEmpty) {
      this.rooms.delete(room.roomCode);
      return null;
    }

    return playerId ? { room, playerId } : null;
  }

  removeSocketMapping(socketId: string): void {
    this.socketToRoom.delete(socketId);
  }

  getAvailableRooms(): RoomListing[] {
    const listings: RoomListing[] = [];
    for (const room of this.rooms.values()) {
      if (room.gamePhase !== GamePhase.LOBBY) continue;
      const maxPlayers = Math.min(MAX_PLAYERS, maxPlayersForMaxCards(room.settings.maxCards));
      if (room.playerCount >= maxPlayers) continue;
      const host = [...room.players.values()].find(p => p.isHost);
      listings.push({
        roomCode: room.roomCode,
        playerCount: room.playerCount,
        maxPlayers,
        hostName: host?.name ?? '???',
        settings: { ...room.settings },
      });
    }
    return listings;
  }

  startCleanup(): void {
    if (this.cleanupTimer) return;
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
    for (const [code, room] of this.rooms) {
      if (room.isEmpty || now - room.lastActivity > ROOM_MAX_INACTIVE_MS) {
        this.rooms.delete(code);
      }
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
