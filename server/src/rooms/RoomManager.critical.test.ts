import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RoomManager } from './RoomManager.js';
import { GamePhase, MAX_PLAYERS, MAX_CARDS } from '@bull-em/shared';

describe('RoomManager critical operations', () => {
  let manager: RoomManager;

  beforeEach(() => {
    manager = new RoomManager();
  });

  afterEach(() => {
    manager.stopCleanup();
  });

  describe('room creation', () => {
    it('generates unique room codes', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const room = manager.createRoom();
        expect(codes.has(room.roomCode)).toBe(false);
        codes.add(room.roomCode);
      }
    });

    it('room codes are 4 uppercase letters', () => {
      for (let i = 0; i < 20; i++) {
        const room = manager.createRoom();
        expect(room.roomCode).toMatch(/^[A-Z]{4}$/);
      }
    });
  });

  describe('O(1) lookups', () => {
    it('getRoomForPlayer returns correct room after assignment', () => {
      const room = manager.createRoom();
      manager.assignPlayerToRoom('player1', room.roomCode);

      expect(manager.getRoomForPlayer('player1')).toBe(room);
    });

    it('getRoomForPlayer returns undefined for unknown player', () => {
      expect(manager.getRoomForPlayer('ghost')).toBeUndefined();
    });

    it('getRoomForSocket returns correct room after assignment', () => {
      const room = manager.createRoom();
      manager.assignSocketToRoom('socket1', room.roomCode);

      expect(manager.getRoomForSocket('socket1')).toBe(room);
    });

    it('getRoom is case-insensitive', () => {
      const room = manager.createRoom();
      const code = room.roomCode;

      expect(manager.getRoom(code.toLowerCase())).toBe(room);
      expect(manager.getRoom(code.toUpperCase())).toBe(room);
    });
  });

  describe('player mapping lifecycle', () => {
    it('removePlayerMapping clears the mapping', () => {
      const room = manager.createRoom();
      manager.assignPlayerToRoom('player1', room.roomCode);

      manager.removePlayerMapping('player1');

      expect(manager.getRoomForPlayer('player1')).toBeUndefined();
    });
  });

  describe('effectiveMaxPlayers', () => {
    it('limits by deck size when maxCards is high', () => {
      const room = manager.createRoom();
      room.settings.maxCards = MAX_CARDS; // 5 → 52/5 = 10 players
      room.settings.maxPlayers = MAX_PLAYERS; // 12

      const effective = manager.effectiveMaxPlayers(room);
      expect(effective).toBe(10); // deck-limited
    });

    it('limits by maxPlayers when deck allows more', () => {
      const room = manager.createRoom();
      room.settings.maxCards = 1; // 52/1 = 52 players (way more than cap)
      room.settings.maxPlayers = 4;

      const effective = manager.effectiveMaxPlayers(room);
      expect(effective).toBe(4);
    });

    it('caps at MAX_PLAYERS regardless', () => {
      const room = manager.createRoom();
      room.settings.maxCards = 1;
      room.settings.maxPlayers = 100;

      const effective = manager.effectiveMaxPlayers(room);
      expect(effective).toBe(MAX_PLAYERS);
    });
  });

  describe('getAvailableRooms', () => {
    it('only returns rooms in LOBBY phase', () => {
      const lobby = manager.createRoom();
      lobby.addPlayer('s1', 'p1', 'Alice');
      lobby.updateSettings({ ...lobby.settings, isPublic: true });

      const playing = manager.createRoom();
      playing.addPlayer('s2', 'p2', 'Bob');
      playing.updateSettings({ ...playing.settings, isPublic: true });
      playing.gamePhase = GamePhase.PLAYING;

      const rooms = manager.getAvailableRooms();
      expect(rooms).toHaveLength(1);
      expect(rooms[0].roomCode).toBe(lobby.roomCode);
    });

    it('excludes full rooms', () => {
      const room = manager.createRoom();
      room.addPlayer('s1', 'p1', 'Alice');
      room.settings.maxPlayers = 1;
      room.settings.maxCards = 1; // ensure maxPlayers is used

      const rooms = manager.getAvailableRooms();
      expect(rooms).toHaveLength(0);
    });
  });

  describe('getLiveGames', () => {
    it('only returns PLAYING or ROUND_RESULT rooms with spectators allowed', () => {
      const lobby = manager.createRoom();
      lobby.addPlayer('s1', 'p1', 'Alice');

      const playing = manager.createRoom();
      playing.addPlayer('s2', 'p2', 'Bob');
      playing.addPlayer('s3', 'p3', 'Charlie');
      playing.gamePhase = GamePhase.PLAYING;
      playing.settings.allowSpectators = true;
      playing.startGame();

      const noSpectators = manager.createRoom();
      noSpectators.addPlayer('s4', 'p4', 'Dave');
      noSpectators.addPlayer('s5', 'p5', 'Eve');
      noSpectators.gamePhase = GamePhase.PLAYING;
      noSpectators.settings.allowSpectators = false;

      const games = manager.getLiveGames();
      expect(games).toHaveLength(1);
      expect(games[0].roomCode).toBe(playing.roomCode);
    });
  });

  describe('room cleanup', () => {
    it('deleteRoom cleans up all mappings', () => {
      const room = manager.createRoom();
      room.addPlayer('s1', 'p1', 'Alice');
      manager.assignSocketToRoom('s1', room.roomCode);
      manager.assignPlayerToRoom('p1', room.roomCode);

      manager.deleteRoom(room.roomCode);

      expect(manager.getRoom(room.roomCode)).toBeUndefined();
      expect(manager.getRoomForSocket('s1')).toBeUndefined();
      expect(manager.getRoomForPlayer('p1')).toBeUndefined();
      expect(manager.roomCount).toBe(0);
    });

    it('handleDisconnect deletes room when last human leaves', () => {
      const room = manager.createRoom();
      room.addPlayer('s1', 'p1', 'Alice');
      manager.assignSocketToRoom('s1', room.roomCode);
      // Room only has one player in lobby

      manager.handleDisconnect('s1');

      expect(manager.roomCount).toBe(0);
    });
  });

  describe('player name caching', () => {
    it('returns online player names excluding bots', () => {
      const room = manager.createRoom();
      room.addPlayer('s1', 'p1', 'Alice');
      room.addBot('bot1', 'Bot Brady');
      manager.assignPlayerToRoom('p1', room.roomCode);

      const names = manager.getOnlinePlayerNames();
      expect(names).toContain('Alice');
      expect(names).not.toContain('Bot Brady');
    });

    it('invalidates cache on player addition', () => {
      const room = manager.createRoom();
      room.addPlayer('s1', 'p1', 'Alice');

      const names1 = manager.getOnlinePlayerNames();

      room.addPlayer('s2', 'p2', 'Bob');
      manager.assignPlayerToRoom('p2', room.roomCode);

      const names2 = manager.getOnlinePlayerNames();
      expect(names2).toContain('Bob');
    });
  });
});
