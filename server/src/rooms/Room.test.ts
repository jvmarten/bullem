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
      const player = room.addPlayer('socket1', 'player1', 'Alice');
      expect(player.isHost).toBe(true);
      expect(room.hostId).toBe('player1');
      expect(room.playerCount).toBe(1);
    });

    it('second player is not host', () => {
      room.addPlayer('socket1', 'player1', 'Alice');
      const p2 = room.addPlayer('socket2', 'player2', 'Bob');
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
    it('reconnects a disconnected player', () => {
      room.addPlayer('socket1', 'player1', 'Alice');
      room.addPlayer('socket2', 'player2', 'Bob');
      room.startGame();
      room.handleDisconnect('socket1');

      const success = room.handleReconnect('socket3', 'player1');
      expect(success).toBe(true);
      const player = room.players.get('player1');
      expect(player?.isConnected).toBe(true);
      expect(room.getSocketId('player1')).toBe('socket3');
    });

    it('returns false for unknown player', () => {
      expect(room.handleReconnect('socket1', 'unknown')).toBe(false);
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
