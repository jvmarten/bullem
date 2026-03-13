import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Room } from './Room.js';
import { GamePhase } from '@bull-em/shared';

/**
 * Tests for Room session transfer, stale socket reconnect, detachPlayer,
 * serialize/restore, rematch, and elimination tracking.
 * These cover critical gaps in the existing Room test suites.
 */

// ── Session Transfer ────────────────────────────────────────────────────────

describe('Room: session transfer (multi-device)', () => {
  let room: Room;

  beforeEach(() => {
    room = new Room('XFER');
    room.addPlayer('s1', 'p1', 'Alice');
    room.setPlayerUserId('p1', 'user-alice');
    room.addPlayer('s2', 'p2', 'Bob');
  });

  it('transfers session to new socket for same userId', () => {
    room.gamePhase = GamePhase.PLAYING;
    const result = room.handleSessionTransfer('s3', 'user-alice');

    expect(result).not.toBeNull();
    expect(result!.oldSocketId).toBe('s1');
    expect(result!.playerId).toBe('p1');
    expect(typeof result!.reconnectToken).toBe('string');
  });

  it('updates socket mappings after transfer', () => {
    room.gamePhase = GamePhase.PLAYING;
    room.handleSessionTransfer('s3', 'user-alice');

    expect(room.getSocketId('p1')).toBe('s3');
    expect(room.getPlayerId('s3')).toBe('p1');
    expect(room.getPlayerId('s1')).toBeUndefined();
  });

  it('returns null for unknown userId', () => {
    const result = room.handleSessionTransfer('s3', 'user-unknown');
    expect(result).toBeNull();
  });

  it('returns null for disconnected player (use reconnect instead)', () => {
    room.gamePhase = GamePhase.PLAYING;
    room.handleDisconnect('s1');

    const result = room.handleSessionTransfer('s3', 'user-alice');
    expect(result).toBeNull();
  });
});

// ── Stale Socket Reconnect ──────────────────────────────────────────────────

describe('Room: stale socket reconnect', () => {
  let room: Room;
  let reconnectToken: string;

  beforeEach(() => {
    room = new Room('STALE');
    const { reconnectToken: token } = room.addPlayer('s1', 'p1', 'Alice');
    reconnectToken = token;
    room.addPlayer('s2', 'p2', 'Bob');
  });

  it('swaps stale socket for new one with valid token', () => {
    room.gamePhase = GamePhase.PLAYING;
    const result = room.handleStaleSocketReconnect('s3', 'p1', reconnectToken);

    expect(result).not.toBeNull();
    expect(result!.oldSocketId).toBe('s1');
    expect(typeof result!.reconnectToken).toBe('string');
    expect(result!.reconnectToken).not.toBe(reconnectToken);
  });

  it('updates socket mappings', () => {
    room.gamePhase = GamePhase.PLAYING;
    room.handleStaleSocketReconnect('s3', 'p1', reconnectToken);

    expect(room.getSocketId('p1')).toBe('s3');
    expect(room.getPlayerId('s3')).toBe('p1');
    expect(room.getPlayerId('s1')).toBeUndefined();
  });

  it('rejects stale reconnect with wrong token', () => {
    const result = room.handleStaleSocketReconnect('s3', 'p1', 'bad-token');
    expect(result).toBeNull();
  });

  it('rejects stale reconnect for disconnected player', () => {
    room.gamePhase = GamePhase.PLAYING;
    room.handleDisconnect('s1');
    const result = room.handleStaleSocketReconnect('s3', 'p1', reconnectToken);
    expect(result).toBeNull();
  });

  it('rejects stale reconnect for non-existent player', () => {
    const result = room.handleStaleSocketReconnect('s3', 'ghost', reconnectToken);
    expect(result).toBeNull();
  });

  it('rejects stale reconnect when new socket equals old socket', () => {
    const result = room.handleStaleSocketReconnect('s1', 'p1', reconnectToken);
    expect(result).toBeNull();
  });
});

// ── detachPlayer ────────────────────────────────────────────────────────────

describe('Room: detachPlayer (intentional leave during game)', () => {
  it('marks player disconnected but keeps in players map', () => {
    const room = new Room('DETACH');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
    room.gamePhase = GamePhase.PLAYING;

    room.detachPlayer('s1');

    expect(room.players.has('p1')).toBe(true);
    expect(room.players.get('p1')!.isConnected).toBe(false);
  });

  it('clears socket mappings', () => {
    const room = new Room('DETACH');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');

    room.detachPlayer('s1');

    expect(room.getPlayerId('s1')).toBeUndefined();
    expect(room.getSocketId('p1')).toBeUndefined();
  });

  it('reassigns host to non-bot, non-eliminated, connected player', () => {
    const room = new Room('DETACH');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addBot('bot1', 'Bot');
    room.addPlayer('s2', 'p2', 'Bob');
    room.gamePhase = GamePhase.PLAYING;

    room.detachPlayer('s1');

    expect(room.hostId).toBe('p2');
    expect(room.players.get('p2')!.isHost).toBe(true);
  });

  it('returns null for unknown socket', () => {
    const room = new Room('DETACH');
    const result = room.detachPlayer('unknown');
    expect(result).toBeNull();
  });
});

// ── Serialize / Restore ─────────────────────────────────────────────────────

describe('Room: serialize/restore', () => {
  it('round-trips room state correctly', () => {
    const room = new Room('SNAP');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
    room.setPlayerUserId('p1', 'user-alice');
    room.settings = { maxCards: 3, turnTimer: 30, botLevelCategory: 'mixed' };
    room.gamePhase = GamePhase.PLAYING;
    room.startGame();

    const snapshot = room.serialize();
    const restored = Room.restore(snapshot);

    expect(restored.roomCode).toBe('SNAP');
    expect(restored.hostId).toBe(room.hostId);
    expect(restored.settings.maxCards).toBe(3);
    expect(restored.gamePhase).toBe(GamePhase.PLAYING);
    expect(restored.players.size).toBe(2);
  });

  it('marks all humans as disconnected on restore', () => {
    const room = new Room('SNAP');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addBot('bot1', 'Bot');
    room.gamePhase = GamePhase.PLAYING;
    room.startGame();

    const snapshot = room.serialize();
    const restored = Room.restore(snapshot);

    // Human should be disconnected
    expect(restored.players.get('p1')!.isConnected).toBe(false);
    // Bot should still be connected
    expect(restored.players.get('bot1')!.isConnected).toBe(true);
  });

  it('restores reconnect tokens so players can rejoin', () => {
    const room = new Room('SNAP');
    const { reconnectToken } = room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
    room.gamePhase = GamePhase.PLAYING;

    const snapshot = room.serialize();
    const restored = Room.restore(snapshot);

    // Player is disconnected on restore
    // Can reconnect with original token
    const newToken = restored.handleReconnect('s3', 'p1', reconnectToken);
    expect(newToken).not.toBeNull();
  });

  it('restores playerUserIds mapping', () => {
    const room = new Room('SNAP');
    room.addPlayer('s1', 'p1', 'Alice');
    room.setPlayerUserId('p1', 'user-alice');

    const snapshot = room.serialize();
    const restored = Room.restore(snapshot);

    expect(restored.playerUserIds.get('p1')).toBe('user-alice');
    expect(restored.players.get('p1')!.userId).toBe('user-alice');
  });

  it('falls back to LOBBY if game snapshot is corrupted', () => {
    const room = new Room('SNAP');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
    room.gamePhase = GamePhase.PLAYING;
    room.startGame();

    const snapshot = room.serialize();
    // Corrupt the game snapshot
    snapshot.gameSnapshot = { players: [], settings: {}, roundNumber: 1 } as never;

    const restored = Room.restore(snapshot);
    expect(restored.game).toBeNull();
    expect(restored.gamePhase).toBe(GamePhase.LOBBY);
  });

  it('restores elimination order and series state', () => {
    const room = new Room('SNAP');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
    room.eliminationOrder = ['p2'];
    room.seriesState = { bestOf: 3, currentSet: 2, wins: { p1: 1, p2: 0 } };

    const snapshot = room.serialize();
    const restored = Room.restore(snapshot);

    expect(restored.eliminationOrder).toEqual(['p2']);
    expect(restored.seriesState).toEqual({ bestOf: 3, currentSet: 2, wins: { p1: 1, p2: 0 } });
  });
});

// ── Rematch ─────────────────────────────────────────────────────────────────

describe('Room: resetForRematch', () => {
  it('resets all players to starting state', () => {
    const room = new Room('REMATCH');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
    room.startGame();

    // Simulate game state changes
    const p1 = room.players.get('p1')!;
    p1.cardCount = 4;
    p1.isEliminated = true;

    room.resetForRematch();

    // All players should be reset
    expect(p1.cardCount).toBe(1);
    expect(p1.isEliminated).toBe(false);
    expect(p1.cards.length).toBeGreaterThan(0); // New cards dealt
  });

  it('removes disconnected non-bot players', () => {
    const room = new Room('REMATCH');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
    room.addBot('bot1', 'Bot');
    room.gamePhase = GamePhase.PLAYING;

    // Disconnect p2 before rematch
    room.players.get('p2')!.isConnected = false;
    room.playerToSocket.delete('p2');

    room.resetForRematch();

    // p2 should be removed (disconnected human)
    expect(room.players.has('p2')).toBe(false);
    // p1 and bot should remain
    expect(room.players.has('p1')).toBe(true);
    expect(room.players.has('bot1')).toBe(true);
  });

  it('reassigns host if current host was disconnected', () => {
    const room = new Room('REMATCH');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
    room.gamePhase = GamePhase.PLAYING;

    // Disconnect the host
    room.players.get('p1')!.isConnected = false;
    room.playerToSocket.delete('p1');

    room.resetForRematch();

    expect(room.hostId).toBe('p2');
    expect(room.players.get('p2')!.isHost).toBe(true);
  });
});

// ── Elimination tracking ────────────────────────────────────────────────────

describe('Room: elimination tracking', () => {
  it('records eliminations in order', () => {
    const room = new Room('ELIM');
    room.recordEliminations(['p3']);
    room.recordEliminations(['p1']);

    expect(room.eliminationOrder).toEqual(['p3', 'p1']);
  });

  it('prevents duplicate elimination entries', () => {
    const room = new Room('ELIM');
    room.recordEliminations(['p3']);
    room.recordEliminations(['p3']); // duplicate

    expect(room.eliminationOrder).toEqual(['p3']);
  });

  it('records multiple simultaneous eliminations', () => {
    const room = new Room('ELIM');
    room.recordEliminations(['p2', 'p4']);

    expect(room.eliminationOrder).toEqual(['p2', 'p4']);
  });
});

// ── isEmpty edge cases ──────────────────────────────────────────────────────

describe('Room: isEmpty edge cases', () => {
  it('disconnected human with pending timer keeps room alive', () => {
    vi.useFakeTimers();
    const room = new Room('EMPTY');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addBot('bot1', 'Bot');
    room.gamePhase = GamePhase.PLAYING;

    room.handleDisconnect('s1', () => {});

    // Human disconnected but has pending timer — room should not be empty
    expect(room.isEmpty).toBe(false);

    vi.useRealTimers();
  });

  it('disconnected human without pending timer makes room empty', () => {
    const room = new Room('EMPTY');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addBot('bot1', 'Bot');

    // Detach (no disconnect timer) — room should be empty since only bot remains
    room.detachPlayer('s1');
    expect(room.isEmpty).toBe(true);
  });
});

// ── Disconnect timer leak prevention ────────────────────────────────────────

describe('Room: disconnect timer deduplication', () => {
  it('rapid reconnect-disconnect cycle does not leak timers', () => {
    vi.useFakeTimers();
    const room = new Room('LEAK');
    const { reconnectToken } = room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
    room.gamePhase = GamePhase.PLAYING;

    let timeoutCount = 0;
    const onTimeout = () => { timeoutCount++; };

    // First disconnect
    room.handleDisconnect('s1', onTimeout);

    // Quick reconnect
    const newToken = room.handleReconnect('s3', 'p1', reconnectToken);
    expect(newToken).not.toBeNull();

    // Second disconnect
    room.handleDisconnect('s3', onTimeout);

    // Advance past both timeouts
    vi.advanceTimersByTime(360_000);

    // Should only fire once (second timer), not twice
    expect(timeoutCount).toBe(1);

    vi.useRealTimers();
  });
});

// ── Cleanup ─────────────────────────────────────────────────────────────────

describe('Room: cleanup', () => {
  it('clears all disconnect timers', () => {
    vi.useFakeTimers();
    const room = new Room('CLEAN');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
    room.gamePhase = GamePhase.PLAYING;

    let timedOut = false;
    room.handleDisconnect('s1', () => { timedOut = true; });

    room.cleanup();

    vi.advanceTimersByTime(360_000);
    expect(timedOut).toBe(false);

    vi.useRealTimers();
  });

  it('clears round continue timer', () => {
    vi.useFakeTimers();
    const room = new Room('CLEAN');
    room.addPlayer('s1', 'p1', 'Alice');

    let timedOut = false;
    room.beginRoundContinueWindow(5000, () => { timedOut = true; });

    room.cleanup();

    vi.advanceTimersByTime(10_000);
    expect(timedOut).toBe(false);

    vi.useRealTimers();
  });
});
