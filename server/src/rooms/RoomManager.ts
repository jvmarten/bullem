import { ROOM_CODE_LENGTH, ROOM_CLEANUP_INTERVAL_MS, ROOM_MAX_INACTIVE_MS } from '@bull-em/shared';
import { Room } from './Room.js';

export class RoomManager {
  private rooms = new Map<string, Room>();
  private socketToRoom = new Map<string, string>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  startCleanup(): void {
    this.cleanupInterval = setInterval(() => this.cleanupStaleRooms(), ROOM_CLEANUP_INTERVAL_MS);
  }

  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private cleanupStaleRooms(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const hasConnectedHumans = [...room.players.values()].some(p => !p.isBot && p.isConnected);
      if (!hasConnectedHumans && now - room.lastActivity > ROOM_MAX_INACTIVE_MS) {
        room.clearTurnTimer();
        this.rooms.delete(code);
      }
    }
  }

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
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
