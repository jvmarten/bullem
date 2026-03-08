import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MATCHMAKING_ELO_WINDOW,
  MATCHMAKING_WIDEN_AFTER_SECONDS,
  MATCHMAKING_BOT_BACKFILL_SECONDS,
  MATCHMAKING_MULTIPLAYER_MIN,
  MATCHMAKING_MULTIPLAYER_TARGET,
  MATCHMAKING_FOUND_COUNTDOWN_MS,
  RANKED_SETTINGS,
  ELO_DEFAULT,
  GamePhase,
} from '@bull-em/shared';
import { MatchmakingQueue, type QueueEntry } from './MatchmakingQueue.js';

// ── Mock Redis ──────────────────────────────────────────────────────────

function createMockRedis() {
  /** sorted sets: key → Map<member, score> */
  const zsets = new Map<string, Map<string, number>>();

  function getZset(key: string): Map<string, number> {
    if (!zsets.has(key)) zsets.set(key, new Map());
    return zsets.get(key)!;
  }

  return {
    zadd: vi.fn(async (key: string, score: number, member: string) => {
      getZset(key).set(member, score);
      return 1;
    }),
    zrem: vi.fn(async (key: string, member: string) => {
      return getZset(key).delete(member) ? 1 : 0;
    }),
    zrange: vi.fn(async (key: string, start: number, stop: number, ...args: string[]) => {
      const zset = getZset(key);
      // Sort by score ascending
      const sorted = [...zset.entries()].sort((a, b) => a[1] - b[1]);
      const withScores = args.includes('WITHSCORES');
      if (withScores) {
        const result: string[] = [];
        for (const [member, score] of sorted) {
          result.push(member, String(score));
        }
        return result;
      }
      return sorted.map(([member]) => member);
    }),
    del: vi.fn(async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (zsets.delete(key)) count++;
      }
      return count;
    }),
    _zsets: zsets,
    getZset,
  };
}

// ── Mock Socket ─────────────────────────────────────────────────────────

function createMockSocket(id: string, userId?: string, username?: string) {
  return {
    id,
    data: { userId, username },
    join: vi.fn(),
    emit: vi.fn(),
    connected: true,
  };
}

// ── Mock Socket.io Server ───────────────────────────────────────────────

function createMockIo() {
  const sockets = new Map<string, ReturnType<typeof createMockSocket>>();
  return {
    sockets: {
      sockets,
    },
    to: vi.fn(() => ({
      emit: vi.fn(),
    })),
    _addSocket(socket: ReturnType<typeof createMockSocket>) {
      sockets.set(socket.id, socket);
    },
  };
}

// ── Mock RoomManager ────────────────────────────────────────────────────

function createMockRoomManager() {
  const rooms = new Map<string, ReturnType<typeof createMockRoom>>();
  return {
    createRoom: vi.fn(() => {
      const room = createMockRoom();
      rooms.set(room.roomCode, room);
      return room;
    }),
    getRoom: vi.fn((code: string) => rooms.get(code)),
    getRoomForSocket: vi.fn(() => undefined),
    assignSocketToRoom: vi.fn(),
    assignPlayerToRoom: vi.fn(),
    persistRoom: vi.fn(),
    effectiveMaxPlayers: vi.fn(() => 12),
    _rooms: rooms,
  };
}

let roomCounter = 0;
function createMockRoom() {
  const players = new Map<string, { id: string; name: string; isBot?: boolean; cards: never[] }>();
  const playerUserIds = new Map<string, string>();
  return {
    roomCode: `ROOM${++roomCounter}`,
    players,
    playerUserIds,
    settings: { ...RANKED_SETTINGS, ranked: false as boolean, rankedMode: undefined as string | undefined },
    gamePhase: GamePhase.LOBBY,
    game: null as null | { currentPlayerId: string },
    addPlayer: vi.fn((socketId: string, playerId: string, name: string) => {
      players.set(playerId, { id: playerId, name, cards: [] });
      return { player: { id: playerId, name }, reconnectToken: `token-${playerId}` };
    }),
    setPlayerUserId: vi.fn((playerId: string, userId: string) => {
      playerUserIds.set(playerId, userId);
    }),
    addBot: vi.fn((botId: string, name: string) => {
      players.set(botId, { id: botId, name, isBot: true, cards: [] });
    }),
    startGame: vi.fn(() => {
      return {} as never;
    }),
    playerCount: 0,
    get playerCountGetter() { return players.size; },
  };
}

// ── Mock BotManager ─────────────────────────────────────────────────────

let botIdCounter = 0;
function createMockBotManager() {
  return {
    addBot: vi.fn((room: ReturnType<typeof createMockRoom>, name?: string) => {
      const botId = `bot-mm-${++botIdCounter}`;
      room.addBot(botId, name ?? 'Bot');
      return botId;
    }),
    addRankedBot: vi.fn((room: ReturnType<typeof createMockRoom>, _userId: string, name: string) => {
      const botId = `bot-mm-${++botIdCounter}`;
      room.addBot(botId, name);
      return botId;
    }),
    scheduleBotTurn: vi.fn(),
    clearTurnTimer: vi.fn(),
  };
}

// ── Mock db/ratings ─────────────────────────────────────────────────────

vi.mock('../db/ratings.js', () => ({
  getRating: vi.fn(async () => null),
}));

// ── Mock broadcast/roundTransition ──────────────────────────────────────

vi.mock('../socket/broadcast.js', () => ({
  broadcastRoomState: vi.fn(),
  broadcastGameState: vi.fn(),
}));

vi.mock('../socket/roundTransition.js', () => ({
  recordRoundStart: vi.fn(),
}));

// ── Tests ───────────────────────────────────────────────────────────────

describe('MatchmakingQueue', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockIo: ReturnType<typeof createMockIo>;
  let mockRoomManager: ReturnType<typeof createMockRoomManager>;
  let mockBotManager: ReturnType<typeof createMockBotManager>;
  let queue: MatchmakingQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    roomCounter = 0;
    botIdCounter = 0;
    mockRedis = createMockRedis();
    mockIo = createMockIo();
    mockRoomManager = createMockRoomManager();
    mockBotManager = createMockBotManager();
    queue = new MatchmakingQueue(
      mockIo as never,
      mockRedis as never,
      mockRoomManager as never,
      mockBotManager as never,
    );
  });

  afterEach(() => {
    queue.stop();
    vi.useRealTimers();
  });

  describe('joinQueue', () => {
    it('rejects unauthenticated users', async () => {
      const socket = createMockSocket('s1');
      const error = await queue.joinQueue(socket as never, 'heads_up');
      expect(error).toContain('logged in');
    });

    it('rejects guests (no userId)', async () => {
      const socket = createMockSocket('s1', undefined, 'Guest');
      const error = await queue.joinQueue(socket as never, 'heads_up');
      expect(error).toContain('logged in');
    });

    it('accepts authenticated users', async () => {
      const socket = createMockSocket('s1', 'user-1', 'Alice');
      const error = await queue.joinQueue(socket as never, 'heads_up');
      expect(error).toBeNull();
      expect(mockRedis.zadd).toHaveBeenCalled();
    });

    it('rejects duplicate queue join', async () => {
      const socket = createMockSocket('s1', 'user-1', 'Alice');
      await queue.joinQueue(socket as never, 'heads_up');
      const error = await queue.joinQueue(socket as never, 'heads_up');
      expect(error).toContain('Already in matchmaking');
    });

    it('rejects player already in a room', async () => {
      mockRoomManager.getRoomForSocket.mockReturnValueOnce({} as never);
      const socket = createMockSocket('s1', 'user-1', 'Alice');
      const error = await queue.joinQueue(socket as never, 'heads_up');
      expect(error).toContain('Already in a game');
    });

    it('adds entry to the correct Redis sorted set', async () => {
      const socket = createMockSocket('s1', 'user-1', 'Alice');
      await queue.joinQueue(socket as never, 'multiplayer');

      const zset = mockRedis.getZset('matchmaking:multiplayer');
      expect(zset.size).toBe(1);

      // Check the entry data
      const [raw] = [...zset.keys()];
      const entry: QueueEntry = JSON.parse(raw!);
      expect(entry.userId).toBe('user-1');
      expect(entry.displayName).toBe('Alice');
    });
  });

  describe('leaveQueue', () => {
    it('removes player from queue', async () => {
      const socket = createMockSocket('s1', 'user-1', 'Alice');
      await queue.joinQueue(socket as never, 'heads_up');
      expect(queue.isInQueue('user-1')).toBe(true);

      const left = await queue.leaveQueue('s1');
      expect(left).toBe(true);
      expect(queue.isInQueue('user-1')).toBe(false);
    });

    it('returns false for unknown socket', async () => {
      const left = await queue.leaveQueue('unknown-socket');
      expect(left).toBe(false);
    });
  });

  describe('handleDisconnect', () => {
    it('removes disconnected player from queue', async () => {
      const socket = createMockSocket('s1', 'user-1', 'Alice');
      await queue.joinQueue(socket as never, 'heads_up');

      await queue.handleDisconnect('s1');
      expect(queue.isInQueue('user-1')).toBe(false);
    });

    it('no-ops for sockets not in queue', async () => {
      await queue.handleDisconnect('unknown-socket');
      // Should not throw
    });
  });

  describe('heads-up matching', () => {
    it('matches two close-rated players', async () => {
      const s1 = createMockSocket('s1', 'user-1', 'Alice');
      const s2 = createMockSocket('s2', 'user-2', 'Bob');
      mockIo._addSocket(s1);
      mockIo._addSocket(s2);

      await queue.joinQueue(s1 as never, 'heads_up');
      await queue.joinQueue(s2 as never, 'heads_up');

      // Manually trigger matching (instead of waiting for interval)
      // Access private method via type cast
      await (queue as unknown as { matchHeadsUp(): Promise<void> }).matchHeadsUp();

      // Both players should be removed from queue
      expect(queue.isInQueue('user-1')).toBe(false);
      expect(queue.isInQueue('user-2')).toBe(false);

      // Room should be created with ranked settings
      expect(mockRoomManager.createRoom).toHaveBeenCalled();

      // Players should be notified
      expect(s1.emit).toHaveBeenCalledWith('matchmaking:found', expect.objectContaining({
        roomCode: expect.any(String),
        opponents: expect.arrayContaining([expect.objectContaining({ name: 'Bob' })]),
      }));
      expect(s2.emit).toHaveBeenCalledWith('matchmaking:found', expect.objectContaining({
        roomCode: expect.any(String),
        opponents: expect.arrayContaining([expect.objectContaining({ name: 'Alice' })]),
      }));
    });

    it('does not match players far apart in rating', async () => {
      // Manually set up entries with very different ratings
      const now = Date.now();
      const entry1: QueueEntry = {
        userId: 'user-1', socketId: 's1', rating: 800,
        joinedAt: now, displayName: 'LowRated',
      };
      const entry2: QueueEntry = {
        userId: 'user-2', socketId: 's2', rating: 1600,
        joinedAt: now, displayName: 'HighRated',
      };
      await mockRedis.zadd('matchmaking:heads_up', 800, JSON.stringify(entry1));
      await mockRedis.zadd('matchmaking:heads_up', 1600, JSON.stringify(entry2));

      // Set up in-memory tracking
      (queue as unknown as { userSockets: Map<string, string> }).userSockets.set('user-1', 's1');
      (queue as unknown as { userSockets: Map<string, string> }).userSockets.set('user-2', 's2');
      (queue as unknown as { socketUsers: Map<string, { userId: string; mode: string }> }).socketUsers.set('s1', { userId: 'user-1', mode: 'heads_up' });
      (queue as unknown as { socketUsers: Map<string, { userId: string; mode: string }> }).socketUsers.set('s2', { userId: 'user-2', mode: 'heads_up' });

      await (queue as unknown as { matchHeadsUp(): Promise<void> }).matchHeadsUp();

      // Both should still be in queue (not matched)
      const zset = mockRedis.getZset('matchmaking:heads_up');
      expect(zset.size).toBe(2);
    });

    it('widens window after waiting threshold', async () => {
      const now = Date.now();
      // Players 200 Elo apart — outside base window of 150, but within 225 (150 * 1.5)
      const entry1: QueueEntry = {
        userId: 'user-1', socketId: 's1', rating: 1200,
        joinedAt: now - (MATCHMAKING_WIDEN_AFTER_SECONDS + 1) * 1000, // long wait
        displayName: 'LongWaiter',
      };
      const entry2: QueueEntry = {
        userId: 'user-2', socketId: 's2', rating: 1400,
        joinedAt: now, displayName: 'NewJoiner',
      };

      const s1 = createMockSocket('s1', 'user-1', 'LongWaiter');
      const s2 = createMockSocket('s2', 'user-2', 'NewJoiner');
      mockIo._addSocket(s1);
      mockIo._addSocket(s2);

      await mockRedis.zadd('matchmaking:heads_up', 1200, JSON.stringify(entry1));
      await mockRedis.zadd('matchmaking:heads_up', 1400, JSON.stringify(entry2));
      (queue as unknown as { userSockets: Map<string, string> }).userSockets.set('user-1', 's1');
      (queue as unknown as { userSockets: Map<string, string> }).userSockets.set('user-2', 's2');
      (queue as unknown as { socketUsers: Map<string, { userId: string; mode: string }> }).socketUsers.set('s1', { userId: 'user-1', mode: 'heads_up' });
      (queue as unknown as { socketUsers: Map<string, { userId: string; mode: string }> }).socketUsers.set('s2', { userId: 'user-2', mode: 'heads_up' });

      await (queue as unknown as { matchHeadsUp(): Promise<void> }).matchHeadsUp();

      // Should have matched due to widened window
      const zset = mockRedis.getZset('matchmaking:heads_up');
      expect(zset.size).toBe(0);
    });

    it('backfills with bot after timeout', async () => {
      const now = Date.now();
      const entry: QueueEntry = {
        userId: 'user-1', socketId: 's1', rating: 1200,
        joinedAt: now - (MATCHMAKING_BOT_BACKFILL_SECONDS + 1) * 1000,
        displayName: 'LonelyPlayer',
      };

      const s1 = createMockSocket('s1', 'user-1', 'LonelyPlayer');
      mockIo._addSocket(s1);

      await mockRedis.zadd('matchmaking:heads_up', 1200, JSON.stringify(entry));
      (queue as unknown as { userSockets: Map<string, string> }).userSockets.set('user-1', 's1');
      (queue as unknown as { socketUsers: Map<string, { userId: string; mode: string }> }).socketUsers.set('s1', { userId: 'user-1', mode: 'heads_up' });

      await (queue as unknown as { matchHeadsUp(): Promise<void> }).matchHeadsUp();

      // Player should be removed from queue
      expect(queue.isInQueue('user-1')).toBe(false);

      // Room should be created and bot added (via addRankedBot with fallback profile)
      expect(mockRoomManager.createRoom).toHaveBeenCalled();
      expect(mockBotManager.addRankedBot).toHaveBeenCalled();

      // Player should be notified
      expect(s1.emit).toHaveBeenCalledWith('matchmaking:found', expect.objectContaining({
        roomCode: expect.any(String),
      }));
    });
  });

  describe('multiplayer matching', () => {
    it('matches 3+ compatible players', async () => {
      const sockets = [];
      for (let i = 0; i < 3; i++) {
        const s = createMockSocket(`s${i}`, `user-${i}`, `Player${i}`);
        mockIo._addSocket(s);
        sockets.push(s);
      }

      // Add entries directly with close ratings
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        const entry: QueueEntry = {
          userId: `user-${i}`, socketId: `s${i}`, rating: 1200 + i * 50,
          joinedAt: now, displayName: `Player${i}`,
        };
        await mockRedis.zadd('matchmaking:multiplayer', entry.rating, JSON.stringify(entry));
        (queue as unknown as { userSockets: Map<string, string> }).userSockets.set(`user-${i}`, `s${i}`);
        (queue as unknown as { socketUsers: Map<string, { userId: string; mode: string }> }).socketUsers.set(`s${i}`, { userId: `user-${i}`, mode: 'multiplayer' });
      }

      await (queue as unknown as { matchMultiplayer(): Promise<void> }).matchMultiplayer();

      // All 3 should be removed from queue
      const zset = mockRedis.getZset('matchmaking:multiplayer');
      expect(zset.size).toBe(0);

      // Room created with bot backfill to reach random target (3-9 total)
      expect(mockRoomManager.createRoom).toHaveBeenCalled();
      // Random target 3-9, 3 humans, so 0-6 bots needed (via addRankedBot with fallback profiles)
      const botCalls = mockBotManager.addRankedBot.mock.calls.length;
      expect(botCalls).toBeGreaterThanOrEqual(0);
      expect(botCalls).toBeLessThanOrEqual(6);
    });

    it('does not match fewer than minimum players without timeout', async () => {
      const now = Date.now();
      for (let i = 0; i < 2; i++) {
        const entry: QueueEntry = {
          userId: `user-${i}`, socketId: `s${i}`, rating: 1200,
          joinedAt: now, displayName: `Player${i}`,
        };
        await mockRedis.zadd('matchmaking:multiplayer', entry.rating, JSON.stringify(entry));
        (queue as unknown as { userSockets: Map<string, string> }).userSockets.set(`user-${i}`, `s${i}`);
        (queue as unknown as { socketUsers: Map<string, { userId: string; mode: string }> }).socketUsers.set(`s${i}`, { userId: `user-${i}`, mode: 'multiplayer' });
      }

      await (queue as unknown as { matchMultiplayer(): Promise<void> }).matchMultiplayer();

      // Should NOT have matched — not enough players and no timeout
      const zset = mockRedis.getZset('matchmaking:multiplayer');
      expect(zset.size).toBe(2);
      expect(mockRoomManager.createRoom).not.toHaveBeenCalled();
    });

    it('backfills with bots after timeout even with fewer than min', async () => {
      const now = Date.now();
      const s1 = createMockSocket('s1', 'user-1', 'LoneWolf');
      mockIo._addSocket(s1);

      const entry: QueueEntry = {
        userId: 'user-1', socketId: 's1', rating: 1200,
        joinedAt: now - (MATCHMAKING_BOT_BACKFILL_SECONDS + 1) * 1000,
        displayName: 'LoneWolf',
      };
      await mockRedis.zadd('matchmaking:multiplayer', entry.rating, JSON.stringify(entry));
      (queue as unknown as { userSockets: Map<string, string> }).userSockets.set('user-1', 's1');
      (queue as unknown as { socketUsers: Map<string, { userId: string; mode: string }> }).socketUsers.set('s1', { userId: 'user-1', mode: 'multiplayer' });

      await (queue as unknown as { matchMultiplayer(): Promise<void> }).matchMultiplayer();

      // Should have created a match with bot backfill (via addRankedBot with fallback profiles)
      expect(mockRoomManager.createRoom).toHaveBeenCalled();
      // Random target 3-9, 1 human, so 2-8 bots needed
      const botCalls = mockBotManager.addRankedBot.mock.calls.length;
      expect(botCalls).toBeGreaterThanOrEqual(2);
      expect(botCalls).toBeLessThanOrEqual(8);
    });
  });

  describe('room creation', () => {
    it('creates rooms with ranked settings', async () => {
      const s1 = createMockSocket('s1', 'user-1', 'Alice');
      const s2 = createMockSocket('s2', 'user-2', 'Bob');
      mockIo._addSocket(s1);
      mockIo._addSocket(s2);

      await queue.joinQueue(s1 as never, 'heads_up');
      await queue.joinQueue(s2 as never, 'heads_up');

      await (queue as unknown as { matchHeadsUp(): Promise<void> }).matchHeadsUp();

      const room = [...mockRoomManager._rooms.values()][0]!;
      expect(room.settings.ranked).toBe(true);
      expect(room.settings.rankedMode).toBe('heads_up');
      expect(room.settings.maxCards).toBe(RANKED_SETTINGS.maxCards);
      expect(room.settings.turnTimer).toBe(RANKED_SETTINGS.turnTimer);
    });

    it('starts the game after countdown', async () => {
      const s1 = createMockSocket('s1', 'user-1', 'Alice');
      const s2 = createMockSocket('s2', 'user-2', 'Bob');
      mockIo._addSocket(s1);
      mockIo._addSocket(s2);

      await queue.joinQueue(s1 as never, 'heads_up');
      await queue.joinQueue(s2 as never, 'heads_up');

      await (queue as unknown as { matchHeadsUp(): Promise<void> }).matchHeadsUp();

      const room = [...mockRoomManager._rooms.values()][0]!;
      expect(room.startGame).not.toHaveBeenCalled();

      // Fast-forward past the countdown
      vi.advanceTimersByTime(MATCHMAKING_FOUND_COUNTDOWN_MS + 100);

      // startGame gets called via startMatchedGame which calls room.startGame()
      // But since mockRoomManager.getRoom returns the mock room:
      expect(room.startGame).toHaveBeenCalled();
    });

    it('associates user IDs with players', async () => {
      const s1 = createMockSocket('s1', 'user-1', 'Alice');
      const s2 = createMockSocket('s2', 'user-2', 'Bob');
      mockIo._addSocket(s1);
      mockIo._addSocket(s2);

      await queue.joinQueue(s1 as never, 'heads_up');
      await queue.joinQueue(s2 as never, 'heads_up');

      await (queue as unknown as { matchHeadsUp(): Promise<void> }).matchHeadsUp();

      const room = [...mockRoomManager._rooms.values()][0]!;
      expect(room.setPlayerUserId).toHaveBeenCalledTimes(2);
    });
  });

  describe('queue status', () => {
    it('broadcasts status to waiting players', async () => {
      const s1 = createMockSocket('s1', 'user-1', 'Alice');
      mockIo._addSocket(s1);

      await queue.joinQueue(s1 as never, 'heads_up');

      await (queue as unknown as { broadcastQueueStatus(): Promise<void> }).broadcastQueueStatus();

      expect(s1.emit).toHaveBeenCalledWith('matchmaking:queued', expect.objectContaining({
        position: 1,
        mode: 'heads_up',
        estimatedWaitSeconds: expect.any(Number),
      }));
    });
  });

  describe('start/stop', () => {
    it('clears queues on start', async () => {
      await mockRedis.zadd('matchmaking:heads_up', 1200, 'stale-entry');

      queue.start();

      // Wait for async clearQueues to complete
      await vi.advanceTimersByTimeAsync(0);

      const zset = mockRedis.getZset('matchmaking:heads_up');
      expect(zset.size).toBe(0);
    });

    it('stops intervals on stop', () => {
      queue.start();
      queue.stop();
      // No assertions needed — just verify no errors
    });
  });
});
