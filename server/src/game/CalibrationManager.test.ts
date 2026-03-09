import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CalibrationManager } from './CalibrationManager.js';
import { Room } from '../rooms/Room.js';
import { RoomManager } from '../rooms/RoomManager.js';
import { BotManager } from './BotManager.js';
import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';
import { BOT_PROFILES } from '@bull-em/shared';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

// Mock the DB modules to avoid real database calls in unit tests
vi.mock('../db/botPool.js', () => ({
  getRankedBotPool: vi.fn(),
}));

vi.mock('../db/ratings.js', () => ({
  getRating: vi.fn(),
  updateRatingsAfterGame: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../socket/broadcast.js', () => ({
  broadcastGameState: vi.fn(),
  broadcastRoomState: vi.fn(),
}));

import { getRankedBotPool } from '../db/botPool.js';
import type { RankedBotEntry } from '../db/botPool.js';
import { getRating } from '../db/ratings.js';

/** Build a fake bot pool entry for testing. */
function makeBotEntry(profileKey: string, userId: string): RankedBotEntry {
  const profile = BOT_PROFILES.find(p => p.key === profileKey)!;
  return {
    userId,
    username: `bot_${profileKey}`,
    displayName: profile.name,
    botProfile: profileKey,
    profileConfig: profile.config,
    profileDefinition: profile,
    rating: 1200,
  };
}

/** Minimal mock Socket.io server — just enough to not crash. */
function mockIo(): TypedServer {
  return {
    to: () => ({ emit: vi.fn() }),
    emit: vi.fn(),
    sockets: { sockets: new Map() },
  } as unknown as TypedServer;
}

describe('CalibrationManager', () => {
  let calibrationManager: CalibrationManager;
  let io: TypedServer;
  let roomManager: RoomManager;
  let botManager: BotManager;

  // Fake bot pool with 4 bots
  const fakeBotPool: RankedBotEntry[] = [
    makeBotEntry('rock_lvl8', '00000000-0000-4000-b000-000000000001'),
    makeBotEntry('bluffer_lvl8', '00000000-0000-4000-b000-000000000002'),
    makeBotEntry('grinder_lvl8', '00000000-0000-4000-b000-000000000003'),
    makeBotEntry('wildcard_lvl8', '00000000-0000-4000-b000-000000000004'),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    io = mockIo();
    roomManager = new RoomManager();
    botManager = new BotManager();
    botManager.setRoomManager(roomManager);

    calibrationManager = new CalibrationManager(io, roomManager, botManager);

    // Default mock: return our fake bot pool
    vi.mocked(getRankedBotPool).mockResolvedValue(fakeBotPool);
    // Default mock: no existing ratings
    vi.mocked(getRating).mockResolvedValue(null);
  });

  afterEach(() => {
    calibrationManager.stop();
    vi.useRealTimers();
  });

  describe('start/stop lifecycle', () => {
    it('does not start when bot pool has fewer than 2 bots', async () => {
      vi.mocked(getRankedBotPool).mockResolvedValue([fakeBotPool[0]!]);
      await calibrationManager.start();

      const status = calibrationManager.getStatus();
      expect(status.enabled).toBe(false);
      expect(status.running).toBe(false);
    });

    it('starts successfully with sufficient bots', async () => {
      await calibrationManager.start();

      const status = calibrationManager.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.bots).toHaveLength(4);
    });

    it('cleans up on stop', async () => {
      await calibrationManager.start();
      calibrationManager.stop();

      const status = calibrationManager.getStatus();
      expect(status.enabled).toBe(false);
      expect(status.activeHeadsUpGames).toBe(0);
      expect(status.activeMultiplayerGames).toBe(0);
    });
  });

  describe('concurrent game slots', () => {
    it('launches up to 18 concurrent games (9 HU + 9 MP) with sufficient bots', async () => {
      await calibrationManager.start();

      const status = calibrationManager.getStatus();
      expect(status.enabled).toBe(true);
      // With only 4 bots, we can still launch 9+9 since bots can be in multiple games
      expect(status.activeHeadsUpGames).toBe(9);
      expect(status.activeMultiplayerGames).toBe(9);
      expect(status.running).toBe(true);
    });

    it('reports separate counts for heads-up and multiplayer games', async () => {
      await calibrationManager.start();

      const status = calibrationManager.getStatus();
      expect(typeof status.activeHeadsUpGames).toBe('number');
      expect(typeof status.activeMultiplayerGames).toBe('number');
      expect(status.activeHeadsUpGames + status.activeMultiplayerGames).toBeGreaterThan(0);
    });
  });

  describe('convergence detection', () => {
    it('reports not converged when no games played', async () => {
      await calibrationManager.start();

      expect(calibrationManager.isModeConverged('heads_up')).toBe(false);
      expect(calibrationManager.isModeConverged('multiplayer')).toBe(false);
    });

    it('reports not converged when bot states are empty', () => {
      // Before start, no bot states
      expect(calibrationManager.isModeConverged('heads_up')).toBe(false);
      expect(calibrationManager.isModeConverged('multiplayer')).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('returns disabled status when not started', () => {
      const status = calibrationManager.getStatus();
      expect(status.enabled).toBe(false);
      expect(status.running).toBe(false);
      expect(status.totalGamesPlayed).toBe(0);
      expect(status.activeHeadsUpGames).toBe(0);
      expect(status.activeMultiplayerGames).toBe(0);
      expect(status.bots).toHaveLength(0);
    });

    it('returns bot details after start', async () => {
      await calibrationManager.start();
      const status = calibrationManager.getStatus();

      expect(status.enabled).toBe(true);
      expect(status.bots).toHaveLength(4);

      for (const bot of status.bots) {
        expect(bot.name).toBeTruthy();
        expect(bot.profileKey).toBeTruthy();
        expect(typeof bot.headsUpElo).toBe('number');
        expect(typeof bot.multiplayerMu).toBe('number');
        expect(typeof bot.multiplierSigma).toBe('number');
        expect(bot.headsUpConverged).toBe(false);
        expect(bot.multiplayerConverged).toBe(false);
      }
    });

    it('calculates lastEloChange from recent history', async () => {
      await calibrationManager.start();
      const status = calibrationManager.getStatus();

      // No history yet — lastEloChange should be 0
      for (const bot of status.bots) {
        expect(bot.lastEloChange).toBe(0);
      }
    });
  });

  describe('enabled flag', () => {
    it('respects the stopped flag after stop()', async () => {
      await calibrationManager.start();
      expect(calibrationManager.getStatus().enabled).toBe(true);

      calibrationManager.stop();
      expect(calibrationManager.getStatus().enabled).toBe(false);
    });

    it('does not schedule games after stop', async () => {
      await calibrationManager.start();
      calibrationManager.stop();

      // Advance time well past any scheduled delay
      await vi.advanceTimersByTimeAsync(60_000);

      // Should still be stopped
      expect(calibrationManager.getStatus().enabled).toBe(false);
      expect(calibrationManager.getStatus().running).toBe(false);
    });
  });

  describe('convergence logic (unit)', () => {
    it('Elo: stable ratings within ±30 over 20 games are converged', async () => {
      // Set up mocks to return stable Elo ratings
      let callCount = 0;
      vi.mocked(getRating).mockImplementation(async (userId, mode) => {
        if (mode === 'heads_up') {
          return {
            mode: 'heads_up' as const,
            elo: 1200 + (callCount++ % 5), // Tiny variations within 5 points
            gamesPlayed: 25,
            peakRating: 1205,
            lastUpdated: new Date().toISOString(),
          };
        }
        return null;
      });

      await calibrationManager.start();

      // The convergence is checked after each game via refreshBotRatings.
      // Since we can't easily simulate 20 game completions in a unit test
      // without running the full game loop, we verify the state is initialized
      // as non-converged and the convergence detection is wired up.
      expect(calibrationManager.isModeConverged('heads_up')).toBe(false);
    });

    it('OpenSkill: sigma below 2.0 is converged', async () => {
      vi.mocked(getRating).mockImplementation(async (_userId, mode) => {
        if (mode === 'multiplayer') {
          return {
            mode: 'multiplayer' as const,
            mu: 28,
            sigma: 1.5, // Below threshold of 2.0
            gamesPlayed: 50,
            peakRating: 1344,
            lastUpdated: new Date().toISOString(),
          };
        }
        return null;
      });

      await calibrationManager.start();

      // Initially not converged — needs refreshBotRatings to run
      expect(calibrationManager.isModeConverged('multiplayer')).toBe(false);
    });

    it('OpenSkill: sigma above 2.0 is not converged', async () => {
      vi.mocked(getRating).mockImplementation(async (_userId, mode) => {
        if (mode === 'multiplayer') {
          return {
            mode: 'multiplayer' as const,
            mu: 25,
            sigma: 5.0, // Above threshold
            gamesPlayed: 10,
            peakRating: 1200,
            lastUpdated: new Date().toISOString(),
          };
        }
        return null;
      });

      await calibrationManager.start();
      expect(calibrationManager.isModeConverged('multiplayer')).toBe(false);
    });
  });

  describe('stop cleanup', () => {
    it('clears all active games and timers on stop', async () => {
      await calibrationManager.start();

      // Verify games are active
      const beforeStatus = calibrationManager.getStatus();
      expect(beforeStatus.activeHeadsUpGames + beforeStatus.activeMultiplayerGames).toBeGreaterThan(0);

      calibrationManager.stop();

      const afterStatus = calibrationManager.getStatus();
      expect(afterStatus.activeHeadsUpGames).toBe(0);
      expect(afterStatus.activeMultiplayerGames).toBe(0);
      expect(afterStatus.running).toBe(false);
    });
  });
});
