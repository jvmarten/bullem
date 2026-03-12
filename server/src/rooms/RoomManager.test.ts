import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from './RoomManager.js';
import { GamePhase } from '@bull-em/shared';

describe('RoomManager', () => {
  let manager: RoomManager;

  beforeEach(() => {
    manager = new RoomManager();
  });

  afterEach(() => {
    manager.stopCleanup();
  });

  describe('createRoom', () => {
    it('creates a room with a unique code', () => {
      const room = manager.createRoom();
      expect(room.roomCode).toBeTruthy();
      expect(room.roomCode.length).toBe(4);
      expect(manager.roomCount).toBe(1);
    });

    it('creates multiple rooms with different codes', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const room = manager.createRoom();
        codes.add(room.roomCode);
      }
      expect(codes.size).toBe(10);
      expect(manager.roomCount).toBe(10);
    });
  });

  describe('getRoom', () => {
    it('finds room by code', () => {
      const room = manager.createRoom();
      expect(manager.getRoom(room.roomCode)).toBe(room);
    });

    it('finds room case-insensitively', () => {
      const room = manager.createRoom();
      expect(manager.getRoom(room.roomCode.toLowerCase())).toBe(room);
    });

    it('returns undefined for nonexistent code', () => {
      expect(manager.getRoom('ZZZZ')).toBeUndefined();
    });
  });

  describe('socket-to-room mapping', () => {
    it('assigns and retrieves socket-to-room mapping', () => {
      const room = manager.createRoom();
      manager.assignSocketToRoom('socket1', room.roomCode);
      expect(manager.getRoomForSocket('socket1')).toBe(room);
    });

    it('returns undefined for unknown socket', () => {
      expect(manager.getRoomForSocket('unknown')).toBeUndefined();
    });

    it('removes socket mapping', () => {
      const room = manager.createRoom();
      manager.assignSocketToRoom('socket1', room.roomCode);
      manager.removeSocketMapping('socket1');
      expect(manager.getRoomForSocket('socket1')).toBeUndefined();
    });
  });

  describe('player-to-room mapping', () => {
    it('assigns and retrieves player-to-room mapping', () => {
      const room = manager.createRoom();
      manager.assignPlayerToRoom('player1', room.roomCode);
      expect(manager.getRoomForPlayer('player1')).toBe(room);
    });

    it('returns undefined for unknown player', () => {
      expect(manager.getRoomForPlayer('unknown')).toBeUndefined();
    });

    it('removes player mapping', () => {
      const room = manager.createRoom();
      manager.assignPlayerToRoom('player1', room.roomCode);
      manager.removePlayerMapping('player1');
      expect(manager.getRoomForPlayer('player1')).toBeUndefined();
    });
  });

  describe('deleteRoom', () => {
    it('removes room and all mappings', () => {
      const room = manager.createRoom();
      room.addPlayer('socket1', 'player1', 'Alice');
      manager.assignSocketToRoom('socket1', room.roomCode);
      manager.assignPlayerToRoom('player1', room.roomCode);

      manager.deleteRoom(room.roomCode);

      expect(manager.getRoom(room.roomCode)).toBeUndefined();
      expect(manager.getRoomForSocket('socket1')).toBeUndefined();
      expect(manager.getRoomForPlayer('player1')).toBeUndefined();
      expect(manager.roomCount).toBe(0);
    });

    it('handles deleting nonexistent room gracefully', () => {
      expect(() => manager.deleteRoom('ZZZZ')).not.toThrow();
    });
  });

  describe('handleDisconnect', () => {
    it('removes player from room in lobby phase', () => {
      const room = manager.createRoom();
      room.addPlayer('socket1', 'player1', 'Alice');
      room.addPlayer('socket2', 'player2', 'Bob');
      manager.assignSocketToRoom('socket1', room.roomCode);
      manager.assignPlayerToRoom('player1', room.roomCode);

      const result = manager.handleDisconnect('socket1');
      expect(result).not.toBeNull();
      expect(result!.playerId).toBe('player1');
    });

    it('deletes empty room after last player disconnects', () => {
      const room = manager.createRoom();
      room.addPlayer('socket1', 'player1', 'Alice');
      manager.assignSocketToRoom('socket1', room.roomCode);
      manager.assignPlayerToRoom('player1', room.roomCode);

      const result = manager.handleDisconnect('socket1');
      // Room is empty → should be deleted, returns null
      expect(result).toBeNull();
      expect(manager.getRoom(room.roomCode)).toBeUndefined();
      expect(manager.roomCount).toBe(0);
    });

    it('returns null for unknown socket', () => {
      expect(manager.handleDisconnect('unknown')).toBeNull();
    });

    it('cleans up socket mapping after disconnect', () => {
      const room = manager.createRoom();
      room.addPlayer('socket1', 'player1', 'Alice');
      room.addPlayer('socket2', 'player2', 'Bob');
      manager.assignSocketToRoom('socket1', room.roomCode);

      manager.handleDisconnect('socket1');
      expect(manager.getRoomForSocket('socket1')).toBeUndefined();
    });
  });

  describe('getAvailableRooms', () => {
    it('returns empty array when no rooms', () => {
      expect(manager.getAvailableRooms()).toEqual([]);
    });

    it('lists rooms in lobby phase with available spots', () => {
      const room = manager.createRoom();
      room.addPlayer('socket1', 'player1', 'Alice');
      room.updateSettings({ ...room.settings, isPublic: true });

      const listings = manager.getAvailableRooms();
      expect(listings).toHaveLength(1);
      expect(listings[0].roomCode).toBe(room.roomCode);
      expect(listings[0].playerCount).toBe(1);
      expect(listings[0].hostName).toBe('Alice');
    });

    it('excludes rooms that are in PLAYING phase', () => {
      const room = manager.createRoom();
      room.addPlayer('socket1', 'player1', 'Alice');
      room.addPlayer('socket2', 'player2', 'Bob');
      room.startGame();

      const listings = manager.getAvailableRooms();
      expect(listings).toHaveLength(0);
    });
  });

  describe('effectiveMaxPlayers', () => {
    it('respects card-based limit', () => {
      const room = manager.createRoom();
      // maxCards=5 → floor(52/5) = 10 players max
      room.updateSettings({ maxCards: 5, turnTimer: 30 });
      expect(manager.effectiveMaxPlayers(room)).toBe(10);
    });

    it('respects user-set maxPlayers cap', () => {
      const room = manager.createRoom();
      room.updateSettings({ maxCards: 1, turnTimer: 30, maxPlayers: 4 });
      // maxCards=1 → 52 players possible, but user cap is 4
      expect(manager.effectiveMaxPlayers(room)).toBe(4);
    });

    it('never exceeds absolute MAX_PLAYERS (12)', () => {
      const room = manager.createRoom();
      room.updateSettings({ maxCards: 1, turnTimer: 30, maxPlayers: 50 });
      expect(manager.effectiveMaxPlayers(room)).toBeLessThanOrEqual(12);
    });
  });

  describe('getOnlinePlayerNames', () => {
    it('returns player names across rooms', () => {
      const room1 = manager.createRoom();
      room1.addPlayer('socket1', 'player1', 'Alice');

      const room2 = manager.createRoom();
      room2.addPlayer('socket2', 'player2', 'Bob');

      const names = manager.getOnlinePlayerNames();
      expect(names).toContain('Alice');
      expect(names).toContain('Bob');
    });

    it('excludes bot names', () => {
      const room = manager.createRoom();
      room.addPlayer('socket1', 'player1', 'Alice');
      room.addBot('bot1', 'Bot Brady');

      const names = manager.getOnlinePlayerNames();
      expect(names).toContain('Alice');
      expect(names).not.toContain('Bot Brady');
    });

    it('caches results', () => {
      const room = manager.createRoom();
      room.addPlayer('socket1', 'player1', 'Alice');

      const first = manager.getOnlinePlayerNames();
      const second = manager.getOnlinePlayerNames();
      // Should return same array reference (cached)
      expect(first).toBe(second);
    });

    it('invalidates cache on player change', () => {
      const room = manager.createRoom();
      room.addPlayer('socket1', 'player1', 'Alice');

      const first = manager.getOnlinePlayerNames();

      // Adding a player invalidates cache
      manager.assignPlayerToRoom('player2', room.roomCode);
      room.addPlayer('socket2', 'player2', 'Bob');

      const second = manager.getOnlinePlayerNames();
      expect(second).not.toBe(first);
      expect(second).toContain('Bob');
    });
  });

  describe('getLiveGames', () => {
    it('returns empty when no games are playing', () => {
      expect(manager.getLiveGames()).toEqual([]);
    });

    it('lists games in PLAYING phase with spectators allowed', () => {
      const room = manager.createRoom();
      room.addPlayer('socket1', 'player1', 'Alice');
      room.addPlayer('socket2', 'player2', 'Bob');
      room.updateSettings({ maxCards: 5, turnTimer: 30, allowSpectators: true, spectatorsCanSeeCards: true });
      room.startGame();

      const listings = manager.getLiveGames();
      expect(listings).toHaveLength(1);
      expect(listings[0].roomCode).toBe(room.roomCode);
      expect(listings[0].spectatorsCanSeeCards).toBe(true);
    });

    it('excludes games without spectators allowed', () => {
      const room = manager.createRoom();
      room.addPlayer('socket1', 'player1', 'Alice');
      room.addPlayer('socket2', 'player2', 'Bob');
      room.updateSettings({ maxCards: 5, turnTimer: 30, allowSpectators: false });
      room.startGame();

      expect(manager.getLiveGames()).toHaveLength(0);
    });
  });
});
