import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Room } from './Room.js';
import { GamePhase } from '@bull-em/shared';

describe('Room', () => {
  let room: Room;

  beforeEach(() => {
    room = new Room('ABCD');
  });

  describe('addPlayer', () => {
    it('adds a player and assigns first as host', () => {
      const { player } = room.addPlayer('socket1', 'player1', 'Alice');
      expect(player.isHost).toBe(true);
      expect(room.hostId).toBe('player1');
      expect(room.playerCount).toBe(1);
    });

    it('returns a reconnect token', () => {
      const { reconnectToken } = room.addPlayer('socket1', 'player1', 'Alice');
      expect(typeof reconnectToken).toBe('string');
      expect(reconnectToken.length).toBeGreaterThan(0);
    });

    it('second player is not host', () => {
      room.addPlayer('socket1', 'player1', 'Alice');
      const { player: p2 } = room.addPlayer('socket2', 'player2', 'Bob');
      expect(p2.isHost).toBe(false);
      expect(room.hostId).toBe('player1');
    });

    it('maps socket to player bidirectionally', () => {
      room.addPlayer('socket1', 'player1', 'Alice');
      expect(room.getPlayerId('socket1')).toBe('player1');
      expect(room.getSocketId('player1')).toBe('socket1');
    });
  });

  describe('removePlayer', () => {
    it('removes player and cleans up mappings', () => {
      room.addPlayer('socket1', 'player1', 'Alice');
      room.addPlayer('socket2', 'player2', 'Bob');
      const removed = room.removePlayer('socket1');
      expect(removed).toBe('player1');
      expect(room.playerCount).toBe(1);
      expect(room.getPlayerId('socket1')).toBeUndefined();
    });

    it('reassigns host when host leaves', () => {
      room.addPlayer('socket1', 'player1', 'Alice');
      room.addPlayer('socket2', 'player2', 'Bob');
      room.removePlayer('socket1');
      expect(room.hostId).toBe('player2');
      const players = [...room.players.values()];
      expect(players[0].isHost).toBe(true);
    });

    it('returns null for unknown socket', () => {
      expect(room.removePlayer('unknown')).toBeNull();
    });
  });

  describe('handleDisconnect', () => {
    it('removes player if in lobby', () => {
      room.addPlayer('socket1', 'player1', 'Alice');
      const result = room.handleDisconnect('socket1');
      expect(result).toBe('player1');
      expect(room.playerCount).toBe(0);
    });

    it('marks player as disconnected during game', () => {
      room.addPlayer('socket1', 'player1', 'Alice');
      room.addPlayer('socket2', 'player2', 'Bob');
      room.startGame();
      const result = room.handleDisconnect('socket1');
      expect(result).toBe('player1');
      const player = room.players.get('player1');
      expect(player?.isConnected).toBe(false);
      // Player still exists in room
      expect(room.playerCount).toBe(2);
    });
  });

  describe('handleReconnect', () => {
    it('reconnects a disconnected player with valid token and rotates token', () => {
      const { reconnectToken } = room.addPlayer('socket1', 'player1', 'Alice');
      room.addPlayer('socket2', 'player2', 'Bob');
      room.startGame();
      room.handleDisconnect('socket1');

      const newToken = room.handleReconnect('socket3', 'player1', reconnectToken);
      expect(newToken).toBeTruthy();
      expect(newToken).not.toBe(reconnectToken); // token was rotated
      const player = room.players.get('player1');
      expect(player?.isConnected).toBe(true);
      expect(room.getSocketId('player1')).toBe('socket3');
    });

    it('rejects reconnect with wrong token', () => {
      room.addPlayer('socket1', 'player1', 'Alice');
      room.addPlayer('socket2', 'player2', 'Bob');
      room.startGame();
      room.handleDisconnect('socket1');

      expect(room.handleReconnect('socket3', 'player1', 'wrong-token')).toBeNull();
    });

    it('rejects reconnect with no token', () => {
      room.addPlayer('socket1', 'player1', 'Alice');
      room.addPlayer('socket2', 'player2', 'Bob');
      room.startGame();
      room.handleDisconnect('socket1');

      expect(room.handleReconnect('socket3', 'player1')).toBeNull();
    });

    it('returns null for unknown player', () => {
      expect(room.handleReconnect('socket1', 'unknown')).toBeNull();
    });
  });

  describe('startGame', () => {
    it('creates game engine and changes phase', () => {
      room.addPlayer('socket1', 'player1', 'Alice');
      room.addPlayer('socket2', 'player2', 'Bob');
      const engine = room.startGame();
      expect(engine).toBeDefined();
      expect(room.gamePhase).toBe(GamePhase.PLAYING);
      expect(room.game).toBe(engine);
    });

    it('randomized seating can make non-host start first', () => {
      // Seating uses crypto.randomInt — run multiple games and verify
      // that the non-host player can end up as the starting player.
      // With 2 players and cryptographic randomness, this should happen
      // roughly 50% of the time. 20 attempts makes a false-negative
      // probability of (0.5)^20 ≈ 1 in a million.
      let nonHostStarted = false;
      for (let i = 0; i < 20; i++) {
        const testRoom = new Room(`RM${String(i).padStart(2, '0')}`);
        testRoom.addPlayer(`s1-${i}`, `p1-${i}`, 'Alice');
        testRoom.addPlayer(`s2-${i}`, `p2-${i}`, 'Bob');
        const engine = testRoom.startGame();
        if (engine.currentPlayerId === `p2-${i}`) {
          nonHostStarted = true;
          break;
        }
      }
      expect(nonHostStarted).toBe(true);
    });
  });

  describe('getRoomState', () => {
    it('returns public room state', () => {
      room.addPlayer('socket1', 'player1', 'Alice');
      const state = room.getRoomState();
      expect(state.roomCode).toBe('ABCD');
      expect(state.players).toHaveLength(1);
      expect(state.hostId).toBe('player1');
      expect(state.gamePhase).toBe(GamePhase.LOBBY);
    });
  });

  describe('getClientGameState', () => {
    it('returns null if no game', () => {
      room.addPlayer('socket1', 'player1', 'Alice');
      expect(room.getClientGameState('player1')).toBeNull();
    });

    it('returns game state during game', () => {
      room.addPlayer('socket1', 'player1', 'Alice');
      room.addPlayer('socket2', 'player2', 'Bob');
      room.startGame();
      const state = room.getClientGameState('player1');
      expect(state).not.toBeNull();
      expect(state!.myCards.length).toBeGreaterThan(0);
    });
  });

  describe('handleSessionTransfer', () => {
    it('transfers socket mappings to new socket for matching userId', () => {
      room.addPlayer('old-socket', 'player1', 'Alice', { userId: 'user-123' });
      room.setPlayerUserId('player1', 'user-123');

      const result = room.handleSessionTransfer('new-socket', 'user-123');
      expect(result).not.toBeNull();
      expect(result!.oldSocketId).toBe('old-socket');
      expect(result!.playerId).toBe('player1');
      expect(result!.reconnectToken).toBeTruthy();

      // New socket should be mapped
      expect(room.getPlayerId('new-socket')).toBe('player1');
      expect(room.getSocketId('player1')).toBe('new-socket');
      // Old socket should be unmapped
      expect(room.getPlayerId('old-socket')).toBeUndefined();
    });

    it('returns null for unknown userId', () => {
      room.addPlayer('socket1', 'player1', 'Alice', { userId: 'user-123' });
      room.setPlayerUserId('player1', 'user-123');

      const result = room.handleSessionTransfer('new-socket', 'unknown-user');
      expect(result).toBeNull();
    });

    it('returns null when player is disconnected (reconnect handles that case)', () => {
      room.addPlayer('socket1', 'player1', 'Alice', { userId: 'user-123' });
      room.setPlayerUserId('player1', 'user-123');
      // Simulate disconnect during game
      room.gamePhase = GamePhase.PLAYING;
      room.handleDisconnect('socket1');

      const result = room.handleSessionTransfer('new-socket', 'user-123');
      expect(result).toBeNull();
    });

    it('rotates the reconnect token', () => {
      const { reconnectToken: originalToken } = room.addPlayer('socket1', 'player1', 'Alice', { userId: 'user-123' });
      room.setPlayerUserId('player1', 'user-123');

      const result = room.handleSessionTransfer('new-socket', 'user-123');
      expect(result!.reconnectToken).not.toBe(originalToken);
    });
  });

  describe('isEmpty', () => {
    it('is empty when no players', () => {
      expect(room.isEmpty).toBe(true);
    });

    it('is not empty with players', () => {
      room.addPlayer('socket1', 'player1', 'Alice');
      expect(room.isEmpty).toBe(false);
    });
  });
});
