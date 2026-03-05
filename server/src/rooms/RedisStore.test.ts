import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Room } from './Room.js';
import { RedisStore, type RoomSnapshot } from './RedisStore.js';
import { GamePhase } from '@bull-em/shared';

// ── Mock Redis client ───────────────────────────────────────────────────
function createMockRedis() {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();

  const mockPipeline = {
    set: vi.fn((...args: unknown[]) => {
      const [key, value] = args as [string, string];
      store.set(key, value);
      return mockPipeline;
    }),
    del: vi.fn((...args: unknown[]) => {
      const [key] = args as [string];
      store.delete(key);
      return mockPipeline;
    }),
    sadd: vi.fn((...args: unknown[]) => {
      const [setKey, member] = args as [string, string];
      if (!sets.has(setKey)) sets.set(setKey, new Set());
      sets.get(setKey)!.add(member);
      return mockPipeline;
    }),
    srem: vi.fn((...args: unknown[]) => {
      const [setKey, member] = args as [string, string];
      sets.get(setKey)?.delete(member);
      return mockPipeline;
    }),
    exec: vi.fn(async () => []),
  };

  return {
    pipeline: vi.fn(() => mockPipeline),
    smembers: vi.fn(async (key: string) => [...(sets.get(key) ?? [])]),
    mget: vi.fn(async (...keys: string[]) => keys.map(k => store.get(k) ?? null)),
    del: vi.fn(async (key: string) => { store.delete(key); return 1; }),
    srem: vi.fn(async (setKey: string, member: string) => { sets.get(setKey)?.delete(member); return 1; }),
    _store: store,
    _sets: sets,
    _pipeline: mockPipeline,
  };
}

describe('RedisStore', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let redisStore: RedisStore;

  beforeEach(() => {
    mockRedis = createMockRedis();
    // Cast to Redis since we're mocking the subset of methods used
    redisStore = new RedisStore(mockRedis as never);
  });

  describe('persist', () => {
    it('serializes room and stores in Redis with TTL', async () => {
      const room = new Room('ABCD');
      room.addPlayer('socket1', 'player1', 'Alice');

      await redisStore.persist(room);

      expect(mockRedis.pipeline).toHaveBeenCalled();
      expect(mockRedis._pipeline.set).toHaveBeenCalledWith(
        'room:ABCD',
        expect.any(String),
        'EX',
        86400,
      );
      expect(mockRedis._pipeline.sadd).toHaveBeenCalledWith('room:index', 'ABCD');

      // Verify stored value is valid JSON with expected shape
      const stored = mockRedis._store.get('room:ABCD');
      expect(stored).toBeDefined();
      const snapshot: RoomSnapshot = JSON.parse(stored!);
      expect(snapshot.roomCode).toBe('ABCD');
      expect(snapshot.players).toHaveLength(1);
      expect(snapshot.players[0]!.name).toBe('Alice');
      expect(snapshot.hostId).toBe('player1');
      expect(snapshot.gamePhase).toBe(GamePhase.LOBBY);
    });

    it('includes reconnect tokens in snapshot', async () => {
      const room = new Room('ABCD');
      const { reconnectToken } = room.addPlayer('socket1', 'player1', 'Alice');

      await redisStore.persist(room);

      const stored = mockRedis._store.get('room:ABCD');
      const snapshot: RoomSnapshot = JSON.parse(stored!);
      expect(snapshot.reconnectTokens['player1']).toBe(reconnectToken);
    });

    it('includes game snapshot when game is in progress', async () => {
      const room = new Room('ABCD');
      room.addPlayer('socket1', 'player1', 'Alice');
      room.addPlayer('socket2', 'player2', 'Bob');
      room.startGame();

      await redisStore.persist(room);

      const stored = mockRedis._store.get('room:ABCD');
      const snapshot: RoomSnapshot = JSON.parse(stored!);
      expect(snapshot.gameSnapshot).not.toBeNull();
      expect(snapshot.gameSnapshot!.players).toHaveLength(2);
      expect(snapshot.gamePhase).toBe(GamePhase.PLAYING);
    });
  });

  describe('remove', () => {
    it('deletes room key and removes from index', async () => {
      const room = new Room('ABCD');
      room.addPlayer('socket1', 'player1', 'Alice');
      await redisStore.persist(room);

      await redisStore.remove('ABCD');

      expect(mockRedis._pipeline.del).toHaveBeenCalledWith('room:ABCD');
      expect(mockRedis._pipeline.srem).toHaveBeenCalledWith('room:index', 'ABCD');
    });
  });

  describe('restoreAll', () => {
    it('restores rooms from Redis', async () => {
      // Manually populate the mock store with a valid snapshot
      const room = new Room('WXYZ');
      room.addPlayer('socket1', 'player1', 'Alice');
      room.addPlayer('socket2', 'player2', 'Bob');

      const snapshot = room.serialize();
      mockRedis._store.set('room:WXYZ', JSON.stringify(snapshot));
      mockRedis._sets.set('room:index', new Set(['WXYZ']));

      const rooms = await redisStore.restoreAll();

      expect(rooms).toHaveLength(1);
      expect(rooms[0]!.roomCode).toBe('WXYZ');
      expect(rooms[0]!.playerCount).toBe(2);
      // Restored human players should be marked disconnected
      const alice = rooms[0]!.players.get('player1');
      expect(alice).toBeDefined();
      expect(alice!.isConnected).toBe(false);
    });

    it('restores rooms with active games', async () => {
      const room = new Room('GAME');
      room.addPlayer('socket1', 'player1', 'Alice');
      room.addPlayer('socket2', 'player2', 'Bob');
      room.startGame();

      const snapshot = room.serialize();
      mockRedis._store.set('room:GAME', JSON.stringify(snapshot));
      mockRedis._sets.set('room:index', new Set(['GAME']));

      const rooms = await redisStore.restoreAll();

      expect(rooms).toHaveLength(1);
      expect(rooms[0]!.gamePhase).toBe(GamePhase.PLAYING);
      expect(rooms[0]!.game).not.toBeNull();
    });

    it('skips expired/missing keys and cleans up index', async () => {
      mockRedis._sets.set('room:index', new Set(['GONE']));
      // No corresponding room:GONE key in store

      const rooms = await redisStore.restoreAll();

      expect(rooms).toHaveLength(0);
      expect(mockRedis.srem).toHaveBeenCalledWith('room:index', 'GONE');
    });

    it('skips corrupted snapshots and cleans up', async () => {
      mockRedis._store.set('room:BAD', 'not valid json{{{');
      mockRedis._sets.set('room:index', new Set(['BAD']));

      const rooms = await redisStore.restoreAll();

      expect(rooms).toHaveLength(0);
      expect(mockRedis.del).toHaveBeenCalledWith('room:BAD');
      expect(mockRedis.srem).toHaveBeenCalledWith('room:index', 'BAD');
    });

    it('returns empty array when no rooms persisted', async () => {
      const rooms = await redisStore.restoreAll();
      expect(rooms).toHaveLength(0);
    });
  });
});

describe('Room.serialize / Room.restore', () => {
  it('round-trips a lobby room', () => {
    const room = new Room('TEST');
    const { reconnectToken } = room.addPlayer('socket1', 'player1', 'Alice');
    room.addPlayer('socket2', 'player2', 'Bob');

    const snapshot = room.serialize();
    const restored = Room.restore(snapshot);

    expect(restored.roomCode).toBe('TEST');
    expect(restored.hostId).toBe('player1');
    expect(restored.gamePhase).toBe(GamePhase.LOBBY);
    expect(restored.playerCount).toBe(2);
    expect(restored.game).toBeNull();

    // Players should be disconnected after restore
    const alice = restored.players.get('player1');
    expect(alice!.isConnected).toBe(false);

    // Reconnect token should be preserved
    const newToken = restored.handleReconnect('newSocket', 'player1', reconnectToken);
    expect(newToken).not.toBeNull();
  });

  it('round-trips a room with an active game', () => {
    const room = new Room('GAME');
    room.addPlayer('socket1', 'player1', 'Alice');
    room.addPlayer('socket2', 'player2', 'Bob');
    room.startGame();

    const snapshot = room.serialize();
    const restored = Room.restore(snapshot);

    expect(restored.gamePhase).toBe(GamePhase.PLAYING);
    expect(restored.game).not.toBeNull();
    expect(restored.game!.roundNumber).toBe(1);
    // Active players in the engine should match
    expect(restored.game!.getActivePlayers()).toHaveLength(2);
  });

  it('preserves game settings', () => {
    const room = new Room('SETS');
    room.updateSettings({ maxCards: 3, turnTimer: 30 });
    room.addPlayer('socket1', 'player1', 'Alice');

    const snapshot = room.serialize();
    const restored = Room.restore(snapshot);

    expect(restored.settings.maxCards).toBe(3);
    expect(restored.settings.turnTimer).toBe(30);
  });

  it('preserves bot players', () => {
    const room = new Room('BOTS');
    room.addPlayer('socket1', 'player1', 'Alice');
    room.addBot('bot1', 'BotBob');

    const snapshot = room.serialize();
    const restored = Room.restore(snapshot);

    expect(restored.playerCount).toBe(2);
    const bot = restored.players.get('bot1');
    expect(bot).toBeDefined();
    expect(bot!.isBot).toBe(true);
    expect(bot!.name).toBe('BotBob');
    // Bots should remain connected after restore (they don't have sockets)
    expect(bot!.isConnected).toBe(true);
  });

  it('handles corrupted game snapshot gracefully', () => {
    const room = new Room('CORR');
    room.addPlayer('socket1', 'player1', 'Alice');
    room.addPlayer('socket2', 'player2', 'Bob');
    room.startGame();

    const snapshot = room.serialize();
    // Corrupt the game snapshot
    snapshot.gameSnapshot!.players = [];

    const restored = Room.restore(snapshot);

    // Should fall back to lobby phase with null game
    expect(restored.gamePhase).toBe(GamePhase.LOBBY);
    expect(restored.game).toBeNull();
  });

  it('preserves isBackgroundGame flag', () => {
    const room = new Room('BG');
    room.isBackgroundGame = true;
    room.addPlayer('socket1', 'player1', 'Alice');

    const snapshot = room.serialize();
    const restored = Room.restore(snapshot);

    expect(restored.isBackgroundGame).toBe(true);
  });
});
