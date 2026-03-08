import './instrument.js';

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import * as Sentry from '@sentry/node';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';
import { RoomManager } from './rooms/RoomManager.js';
import { RedisStore } from './rooms/RedisStore.js';
import { BotManager } from './game/BotManager.js';
import { BackgroundGameManager } from './game/BackgroundGameManager.js';
import { CalibrationManager } from './game/CalibrationManager.js';
import { registerHandlers } from './socket/registerHandlers.js';
import { MatchmakingQueue } from './matchmaking/MatchmakingQueue.js';
import { setPushManager } from './socket/broadcast.js';
import { authRouter, setAuthRateLimiter } from './auth/routes.js';
import { oauthRouter } from './auth/oauth.js';
import { optionalAuth, requireAuth, requireAdmin } from './auth/middleware.js';
import { createAdminRouter } from './admin/routes.js';
import logger from './logger.js';
import { pool, closePool, connectWithRetry, getDbStatus, migrate, query } from './db/index.js';
import { registerGaugeCallbacks, serializeMetrics, httpRequestsTotal } from './metrics.js';
import { RateLimiter } from './rateLimit.js';
import { PushManager } from './push/PushManager.js';
import { isDevAuthActive, isDevMatchmakingActive } from './dev/isDevMode.js';
import { createDevAuthRouter, logDevAuthActive } from './dev/devAuth.js';
import {
  logDevSeedDataActive,
  getDevLeaderboard,
  getDevLeaderboardNearby,
  getDevPlayerStats,
  getDevAdvancedStats,
  getDevUserRatings,
  getDevGameHistory,
} from './dev/devSeedData.js';
import { InMemoryMatchmakingQueue } from './dev/InMemoryMatchmakingQueue.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
/** Build the CORS origin setting.
 *  - Development: allow all origins for local testing.
 *  - Production: if CORS_ORIGINS env var is set, use it as an allowlist
 *    (comma-separated). Otherwise default to same-origin (false). */
function getCorsOrigin(): boolean | string[] {
  if (process.env.NODE_ENV !== 'production') return true;
  const envOrigins = process.env.CORS_ORIGINS;
  if (envOrigins) {
    return envOrigins.split(',').map(o => o.trim()).filter(Boolean);
  }
  // TODO(scale): When serving from multiple domains or via a CDN, set
  // CORS_ORIGINS to the allowed origins (e.g. "https://bullem.fly.dev,https://bullem.com").
  return false;
}

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: getCorsOrigin(),
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Attach Redis adapter for multi-instance pub/sub when REDIS_URL is set.
// Falls back to the default in-memory adapter for local development.
// The same Redis instance is reused for session persistence (RedisStore).
let redisStore: RedisStore | null = null;
/** Redis client for rate limiting, if configured. */
let rateLimitRedis: Redis | null = null;
/** All Redis clients created by this process, tracked for graceful shutdown. */
const redisClients: Redis[] = [];
if (process.env.REDIS_URL) {
  const pubClient = new Redis(process.env.REDIS_URL);
  const subClient = pubClient.duplicate();
  redisClients.push(pubClient, subClient);
  io.adapter(createAdapter(pubClient, subClient));
  pubClient.on('connect', () => {
    logger.info('Redis adapter connected — Socket.io pub/sub is active');
  });

  // Create a dedicated client for session persistence (separate from pub/sub
  // clients to avoid command conflicts on subscribed connections).
  const storeClient = new Redis(process.env.REDIS_URL);
  redisClients.push(storeClient);
  redisStore = new RedisStore(storeClient);

  // Create a dedicated client for rate limiting — separate from pub/sub and
  // store clients to avoid contention on the hot path.
  const rateLimitClient = new Redis(process.env.REDIS_URL);
  redisClients.push(rateLimitClient);
  rateLimitRedis = rateLimitClient;
}

// Attach authenticated user info to socket handshake if JWT cookie is present.
// This is optional — unauthenticated sockets (guests) work normally.
import { verifyToken } from './auth/jwt.js';
import { AUTH_COOKIE_NAME } from './auth/middleware.js';
import cookie from 'cookie';

io.use((socket, next) => {
  const cookieHeader = socket.handshake.headers.cookie;
  if (cookieHeader) {
    const cookies = cookie.parse(cookieHeader);
    const token = cookies[AUTH_COOKIE_NAME];
    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        // Attach user info to socket.data for use in handlers
        socket.data.userId = payload.userId;
        socket.data.username = payload.username;
        socket.data.role = payload.role;
      }
    }
  }
  next();
});

const roomManager = new RoomManager();
if (redisStore) {
  roomManager.setRedisStore(redisStore);
}

// Register gauge callbacks so metrics can read live values at scrape time
registerGaugeCallbacks(
  () => roomManager.roomCount,
  () => io.engine.clientsCount,
);
const rateLimiter = new RateLimiter(rateLimitRedis);

// Configure auth endpoint rate limiting with the shared RateLimiter instance
setAuthRateLimiter(rateLimiter);

const botManager = new BotManager();
botManager.setRoomManager(roomManager);
const pushManager = new PushManager();
setPushManager(pushManager);
const backgroundGameManager = new BackgroundGameManager(io, roomManager, botManager);
const calibrationManager = new CalibrationManager(io, roomManager, botManager);

// Create matchmaking queue when Redis is available — matchmaking requires
// Redis for queue state. Without Redis, ranked matchmaking is disabled
// (unless dev mode is active, in which case an in-memory fallback is used).
let matchmakingQueue: MatchmakingQueue | InMemoryMatchmakingQueue | undefined;
if (rateLimitRedis) {
  // Reuse a dedicated Redis client for matchmaking sorted sets.
  // TODO(scale): At very high scale, consider a separate Redis client
  // to avoid contention with rate limiting on the same connection.
  const matchmakingRedis = new Redis(process.env.REDIS_URL!);
  redisClients.push(matchmakingRedis);
  matchmakingQueue = new MatchmakingQueue(io, matchmakingRedis, roomManager, botManager);
} else if (isDevMatchmakingActive()) {
  matchmakingQueue = new InMemoryMatchmakingQueue(io, roomManager, botManager);
}

registerHandlers(io, roomManager, botManager, rateLimiter, pushManager, matchmakingQueue);

// Restore rooms from Redis before accepting connections, then start cleanup.
// Uses an async IIFE — server starts listening immediately but rooms are
// restored in the background. This is safe because Socket.io buffers events
// until handlers are registered, and the restore typically completes in <100ms.
(async () => {
  // Verify database connectivity with retries before running migrations.
  // If the DB is unreachable after all retries, the app continues in degraded
  // mode without persistence rather than crashing.
  await connectWithRetry();

  if (pool && getDbStatus() === 'ok') {
    try {
      await migrate(pool);
    } catch (err) {
      logger.error({ err }, 'Database migration failed — continuing without persistence');
    }

    // Load persisted push subscriptions into the in-memory cache
    try {
      await pushManager.loadFromDatabase();
    } catch (err) {
      logger.error({ err }, 'Failed to load push subscriptions — push will still work for new subscribers');
    }
  }

  if (redisStore) {
    try {
      const count = await roomManager.restoreFromRedis();
      if (count > 0) {
        logger.info({ count }, 'Session persistence: rooms restored from Redis');
      }
    } catch (err) {
      logger.error({ err }, 'Failed to restore rooms from Redis on startup');
    }
  }
  roomManager.startCleanup(io, (roomCode) => botManager.clearTurnTimer(roomCode));
  backgroundGameManager.start();

  // Log dev mode status at startup
  if (isDevAuthActive()) {
    logDevAuthActive();
    logDevSeedDataActive();
  }

  // Start matchmaking queue after Redis and DB are ready
  if (matchmakingQueue) {
    matchmakingQueue.start();
    if (matchmakingQueue instanceof InMemoryMatchmakingQueue) {
      logger.info('Ranked matchmaking enabled (in-memory dev mode)');
    } else {
      logger.info('Ranked matchmaking enabled (Redis available)');
    }
  } else {
    logger.info('Ranked matchmaking disabled (no Redis configured)');
  }

  // Start bot calibration if enabled via environment variable.
  // Disabled by default — you don't want calibration running in local dev.
  if (process.env.ENABLE_BOT_CALIBRATION === 'true') {
    calibrationManager.start().catch((err) => {
      logger.error({ err }, 'CalibrationManager failed to start');
    });
    logger.info('Bot calibration enabled');
  } else {
    logger.info('Bot calibration disabled (set ENABLE_BOT_CALIBRATION=true to enable)');
  }
})();

// Parse JSON bodies, URL-encoded bodies (Apple OAuth POST callback), and cookies
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// CORS for HTTP routes (auth API). In dev, allow localhost; in prod, same-origin handles it.
if (process.env.NODE_ENV !== 'production') {
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', _req.headers.origin ?? '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });
}

app.use(optionalAuth);

// Dev auth routes — mounted before real auth so they take precedence in dev mode
if (isDevAuthActive()) {
  app.use('/auth', createDevAuthRouter());
}

// Auth routes
app.use('/auth', authRouter);
app.use('/auth', oauthRouter);

// Admin routes
app.use('/admin', createAdminRouter(io, roomManager, botManager));

// Dev status endpoint — tells the client whether dev auth is active
app.get('/api/dev-status', (_req, res) => {
  res.json({
    devAuth: isDevAuthActive(),
    devMatchmaking: isDevMatchmakingActive(),
  });
});

// Replay routes
import { getReplayByGameId, getReplayList, getUserReplays } from './db/replays.js';

/** GET /api/replays — list replays. Authenticated users see their own; guests see recent public replays. */
app.get('/api/replays', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 50);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);

    const result = req.user
      ? await getUserReplays(req.user.userId, limit, offset)
      : await getReplayList(limit, offset);

    if (!result) {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch replay list');
    res.status(500).json({ error: 'Failed to fetch replays' });
  }
});

/** GET /api/replays/:gameId — fetch a full replay by game ID. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
app.get('/api/replays/:gameId', async (req, res) => {
  try {
    const { gameId } = req.params;
    if (!gameId || !UUID_REGEX.test(gameId)) {
      res.status(400).json({ error: 'Invalid game ID' });
      return;
    }
    const replay = await getReplayByGameId(gameId);
    if (!replay) {
      res.status(404).json({ error: 'Replay not found' });
      return;
    }
    res.json({ replay });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch replay');
    res.status(500).json({ error: 'Failed to fetch replay' });
  }
});

// ── Dev seed data routes (registered before real DB routes to take precedence) ──
if (isDevAuthActive()) {
  // Stats
  app.get('/api/stats/me', requireAuth, (req, res) => {
    res.json(getDevPlayerStats(req.user!.userId));
  });
  app.get('/api/stats/:userId', (req, res) => {
    res.json(getDevPlayerStats(req.params.userId!));
  });
  app.get('/api/stats/:userId/advanced', (req, res) => {
    res.json(getDevAdvancedStats(req.params.userId!));
  });

  // Ratings
  app.get('/api/ratings/:userId', (req, res) => {
    res.json(getDevUserRatings(req.params.userId!));
  });

  // Leaderboard
  app.get('/api/leaderboard/:mode', (req, res) => {
    const mode = req.params.mode as import('@bull-em/shared').RankedMode;
    const period = (req.query.period as string) ?? 'all_time';
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 100);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
    res.json(getDevLeaderboard(
      mode,
      period as import('@bull-em/shared').LeaderboardPeriod,
      limit,
      offset,
      req.user?.userId,
      req.user?.username,
    ));
  });
  app.get('/api/leaderboard/:mode/nearby', requireAuth, (req, res) => {
    const mode = req.params.mode as import('@bull-em/shared').RankedMode;
    const result = getDevLeaderboardNearby(mode, req.user!.userId, req.user!.username);
    if (!result) {
      res.status(404).json({ error: 'Not ranked or not enough games played' });
      return;
    }
    res.json(result);
  });

  // Game history (for /auth/games)
  app.get('/auth/games', requireAuth, (req, res) => {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 50);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
    res.json(getDevGameHistory(req.user!.userId, limit, offset));
  });
}

// Stats routes
import { getPlayerStats } from './db/stats.js';
import { getAdvancedStats } from './db/advancedStats.js';

/** GET /api/stats/me — convenience endpoint using the authenticated user's ID. */
app.get('/api/stats/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const stats = await getPlayerStats(userId);
    if (!stats) {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }
    res.json(stats);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch player stats');
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/** GET /api/stats/:userId — fetch aggregated stats for any user. */
app.get('/api/stats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId || !UUID_REGEX.test(userId)) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }
    const stats = await getPlayerStats(userId);
    if (!stats) {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }
    if (stats.gamesPlayed === 0) {
      // Check if user actually exists
      const userResult = await query<{ id: string }>(
        'SELECT id FROM users WHERE id = $1',
        [userId],
      );
      if (!userResult || userResult.rows.length === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
    }
    res.json(stats);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch player stats');
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/** GET /api/stats/:userId/advanced — fetch advanced stats for any user. */
app.get('/api/stats/:userId/advanced', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId || !UUID_REGEX.test(userId)) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }
    const stats = await getAdvancedStats(userId);
    if (!stats) {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }
    res.json(stats);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch advanced stats');
    res.status(500).json({ error: 'Failed to fetch advanced stats' });
  }
});

/** GET /api/users/:userId/profile — fetch public profile for any user. */
app.get('/api/users/:userId/profile', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId || !UUID_REGEX.test(userId)) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }
    const userResult = await query<{
      id: string; username: string; display_name: string;
      avatar: string | null; photo_url: string | null; created_at: string;
      is_bot: boolean; bot_profile: string | null;
    }>(
      'SELECT id, username, display_name, avatar, photo_url, created_at, is_bot, bot_profile FROM users WHERE id = $1',
      [userId],
    );
    if (!userResult || userResult.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const row = userResult.rows[0]!;
    const statsResult = await query<{
      games_played: string; games_won: string;
      total_correct_bulls: string; total_bulls_called: string;
      total_bluffs_successful: string; total_calls_made: string;
    }>(
      `SELECT COUNT(*)::text AS games_played,
       COUNT(*) FILTER (WHERE finish_position = 1)::text AS games_won,
       COALESCE(SUM((stats->>'correctBulls')::int), 0)::text AS total_correct_bulls,
       COALESCE(SUM((stats->>'bullsCalled')::int), 0)::text AS total_bulls_called,
       COALESCE(SUM((stats->>'bluffsSuccessful')::int), 0)::text AS total_bluffs_successful,
       COALESCE(SUM((stats->>'callsMade')::int), 0)::text AS total_calls_made
      FROM game_players WHERE user_id = $1`,
      [userId],
    );
    const stats = statsResult?.rows[0];
    const bullsCalled = stats ? parseInt(stats.total_bulls_called, 10) : 0;
    const correctBulls = stats ? parseInt(stats.total_correct_bulls, 10) : 0;
    const callsMade = stats ? parseInt(stats.total_calls_made, 10) : 0;
    const bluffsSuccessful = stats ? parseInt(stats.total_bluffs_successful, 10) : 0;

    res.json({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatar: row.avatar,
      photoUrl: row.photo_url,
      createdAt: row.created_at,
      gamesPlayed: stats ? parseInt(stats.games_played, 10) : 0,
      gamesWon: stats ? parseInt(stats.games_won, 10) : 0,
      bullAccuracy: bullsCalled > 0 ? Math.round((correctBulls / bullsCalled) * 100) : null,
      bluffSuccessRate: callsMade > 0 ? Math.round((bluffsSuccessful / callsMade) * 100) : null,
      isBot: row.is_bot,
      botProfile: row.bot_profile,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch user profile');
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Rating routes
import { getUserRatings as fetchUserRatings } from './db/ratings.js';

/** GET /api/ratings/:userId — fetch both ratings for a user. */
app.get('/api/ratings/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId || !UUID_REGEX.test(userId)) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }
    const ratings = await fetchUserRatings(userId);
    if (!ratings) {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }
    res.json(ratings);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch user ratings');
    res.status(500).json({ error: 'Failed to fetch ratings' });
  }
});

// Leaderboard routes
import { getLeaderboard, getLeaderboardNearby } from './db/leaderboard.js';
import type { RankedMode, LeaderboardPeriod } from '@bull-em/shared';

const VALID_MODES: RankedMode[] = ['heads_up', 'multiplayer'];
const VALID_PERIODS: LeaderboardPeriod[] = ['all_time', 'month', 'week'];

/** GET /api/leaderboard/:mode — fetch ranked leaderboard entries. */
app.get('/api/leaderboard/:mode', async (req, res) => {
  try {
    const { mode } = req.params;
    if (!mode || !VALID_MODES.includes(mode as RankedMode)) {
      res.status(400).json({ error: 'Invalid mode. Must be "heads_up" or "multiplayer".' });
      return;
    }

    const period = (req.query.period as string) ?? 'all_time';
    if (!VALID_PERIODS.includes(period as LeaderboardPeriod)) {
      res.status(400).json({ error: 'Invalid period. Must be "all_time", "month", or "week".' });
      return;
    }

    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 100);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);

    const VALID_PLAYER_FILTERS = ['all', 'players', 'bots'] as const;
    type PlayerFilter = typeof VALID_PLAYER_FILTERS[number];
    const playerFilter = (req.query.playerFilter as string) ?? 'all';
    if (!VALID_PLAYER_FILTERS.includes(playerFilter as PlayerFilter)) {
      res.status(400).json({ error: 'Invalid playerFilter. Must be "all", "players", or "bots".' });
      return;
    }

    const result = await getLeaderboard(
      mode as RankedMode,
      period as LeaderboardPeriod,
      limit,
      offset,
      req.user?.userId,
      playerFilter as PlayerFilter,
    );

    if (!result) {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }

    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch leaderboard');
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

/** GET /api/leaderboard/:mode/nearby — fetch ±5 players around the current user. */
app.get('/api/leaderboard/:mode/nearby', requireAuth, async (req, res) => {
  try {
    const { mode } = req.params;
    if (!mode || !VALID_MODES.includes(mode as RankedMode)) {
      res.status(400).json({ error: 'Invalid mode. Must be "heads_up" or "multiplayer".' });
      return;
    }

    const result = await getLeaderboardNearby(mode as RankedMode, req.user!.userId);

    if (!result) {
      res.status(404).json({ error: 'Not ranked or not enough games played' });
      return;
    }

    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch nearby leaderboard');
    res.status(500).json({ error: 'Failed to fetch nearby leaderboard' });
  }
});

// ── Deck Draw minigame endpoints ─────────────────────────────────────────
import { getDeckDrawStats, updateDeckDrawStats, syncGuestStats } from './db/deckDraw.js';
import {
  executeDraw, isFreeDrawAvailable,
  DECK_DRAW_MIN_WAGER, DECK_DRAW_MAX_WAGER,
  type DeckDrawStats,
} from '@bull-em/shared';

/** GET /api/deck-draw/stats — fetch deck draw stats for the authenticated user. */
app.get('/api/deck-draw/stats', requireAuth, async (req, res) => {
  try {
    const stats = await getDeckDrawStats(req.user!.userId);
    if (!stats) {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }
    res.json(stats);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch deck draw stats');
    res.status(500).json({ error: 'Failed to fetch deck draw stats' });
  }
});

/** POST /api/deck-draw/draw — execute a draw (wager or free). */
app.post('/api/deck-draw/draw', requireAuth, async (req, res) => {
  try {
    const { wager, isFreeDraw } = req.body as { wager?: number; isFreeDraw?: boolean };

    const stats = await getDeckDrawStats(req.user!.userId);
    if (!stats) {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }

    if (isFreeDraw) {
      if (!isFreeDrawAvailable(stats.lastFreeDrawAt)) {
        res.status(400).json({ error: 'Free draw not available yet' });
        return;
      }
      const { result, updatedStats } = executeDraw(stats, 0, true);
      await updateDeckDrawStats(req.user!.userId, updatedStats);
      res.json({ result, stats: updatedStats });
      return;
    }

    // Wagered draw
    if (typeof wager !== 'number' || !Number.isInteger(wager) || wager < DECK_DRAW_MIN_WAGER || wager > DECK_DRAW_MAX_WAGER) {
      res.status(400).json({ error: `Wager must be an integer between ${DECK_DRAW_MIN_WAGER} and ${DECK_DRAW_MAX_WAGER}` });
      return;
    }
    if (stats.balance < wager) {
      res.status(400).json({ error: 'Insufficient balance' });
      return;
    }

    const { result, updatedStats } = executeDraw(stats, wager, false);
    await updateDeckDrawStats(req.user!.userId, updatedStats);
    res.json({ result, stats: updatedStats });
  } catch (err) {
    logger.error({ err }, 'Failed to execute deck draw');
    res.status(500).json({ error: 'Failed to execute draw' });
  }
});

/** POST /api/deck-draw/sync — sync guest localStorage stats to account. */
app.post('/api/deck-draw/sync', requireAuth, async (req, res) => {
  try {
    const guestStats = req.body as DeckDrawStats;

    // Basic validation
    if (typeof guestStats !== 'object' || guestStats === null) {
      res.status(400).json({ error: 'Invalid stats object' });
      return;
    }
    if (typeof guestStats.totalDraws !== 'number' || typeof guestStats.balance !== 'number') {
      res.status(400).json({ error: 'Invalid stats format' });
      return;
    }

    const merged = await syncGuestStats(req.user!.userId, guestStats);
    if (!merged) {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }
    res.json(merged);
  } catch (err) {
    logger.error({ err }, 'Failed to sync deck draw stats');
    res.status(500).json({ error: 'Failed to sync stats' });
  }
});

// ── Calibration status endpoint ─────────────────────────────────────────
app.get('/api/admin/calibration', requireAuth, requireAdmin, (_req, res) => {
  res.json(calibrationManager.getStatus());
});

// Health check — registered before the SPA catch-all
app.get('/health', async (_req, res) => {
  let db = getDbStatus();

  // If the pool exists and we think we're ok, do a live probe to confirm.
  // If degraded/unavailable, skip the probe to avoid adding latency.
  if (pool && db === 'ok') {
    try {
      await pool.query('SELECT 1');
    } catch {
      db = 'degraded';
    }
  }

  // Probe Redis health if adapter is configured
  let redis: 'ok' | 'unavailable' | 'not_configured' = 'not_configured';
  if (redisClients.length > 0) {
    try {
      // Ping the first (pub) client — if it responds, Redis is reachable
      await redisClients[0]!.ping();
      redis = 'ok';
    } catch {
      redis = 'unavailable';
    }
  }

  const allOk = db === 'ok' && (redis === 'ok' || redis === 'not_configured');
  const httpStatus = allOk ? 200 : 503;
  res.status(httpStatus).json({
    status: allOk ? 'ok' : 'degraded',
    db,
    redis,
    rooms: roomManager.roomCount,
    // NOTE: This count is per-instance. With multiple instances behind a load
    // balancer, each instance reports only its own connected sockets. Aggregate
    // across instances for the true global count.
    players: io.engine.clientsCount,
  });
});

// Prometheus metrics endpoint — expose counters, gauges, and histograms
// for scraping by Prometheus/Grafana. Protected by a bearer token when
// METRICS_TOKEN is set; unauthenticated access is allowed in development
// when the env var is absent.
const METRICS_TOKEN = process.env.METRICS_TOKEN;
app.get('/metrics', (req, res) => {
  if (METRICS_TOKEN) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${METRICS_TOKEN}`) {
      res.status(401).send('Unauthorized');
      return;
    }
  }
  httpRequestsTotal.inc('/metrics');
  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(serializeMetrics());
});

// Sentry Express error handler — must be registered after all routes/middleware
Sentry.setupExpressErrorHandler(app);

// In production, serve built client
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  // SPA catch-all: only serve index.html for non-API paths. Without this guard,
  // requests to non-existent API endpoints (e.g. GET /auth/foo) would return
  // HTML with a 200 instead of a proper 404, confusing API clients.
  app.get('*', (req, res) => {
    if (req.path.startsWith('/auth/') || req.path.startsWith('/api/') || req.path.startsWith('/admin/') || req.path.startsWith('/health') || req.path.startsWith('/metrics')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Broadcast online player count and names on connect/disconnect.
// Debounced: rapid connect/disconnect bursts (e.g. 20 players joining at once)
// collapse into a single broadcast instead of one per event.
//
// With the Redis adapter, io.fetchSockets() returns sockets across ALL
// instances, giving us a true global count. We fall back to the local
// io.engine.clientsCount when Redis isn't configured (single-instance dev).
let broadcastPending: ReturnType<typeof setTimeout> | null = null;
function scheduleBroadcastPlayerCount(): void {
  if (broadcastPending) return;
  broadcastPending = setTimeout(() => {
    broadcastPending = null;
    void (async () => {
      let count: number;
      if (redisClients.length > 0) {
        // fetchSockets() queries all instances via the Redis adapter
        const allSockets = await io.fetchSockets();
        count = allSockets.length;
      } else {
        count = io.engine.clientsCount;
      }
      io.emit('server:playerCount', count);
      // TODO(scale): getOnlinePlayerNames() only returns names from this
      // instance's in-memory RoomManager. At multi-instance scale, aggregate
      // names via Redis or a shared store. Low priority — player names in the
      // lobby are a nice-to-have, not a correctness requirement.
      io.emit('server:playerNames', roomManager.getOnlinePlayerNames());
    })();
  }, 100);
}
io.on('connection', () => scheduleBroadcastPlayerCount());
io.engine.on('close', () => scheduleBroadcastPlayerCount());

// Graceful shutdown — clean up timers and close connections
function shutdown(): void {
  logger.info('Shutting down...');
  // Clear debounced broadcast timer to prevent firing after teardown
  if (broadcastPending) {
    clearTimeout(broadcastPending);
    broadcastPending = null;
  }
  if (matchmakingQueue) matchmakingQueue.stop();
  calibrationManager.stop();
  backgroundGameManager.stop();
  botManager.clearTimers();
  roomManager.stopCleanup();
  io.close();
  // Close all Redis connections (pub, sub, store clients)
  for (const client of redisClients) {
    client.disconnect();
  }
  // Close the database pool before exiting
  closePool().catch((err) => {
    logger.error({ err }, 'Error closing database pool during shutdown');
  });
  httpServer.close(() => process.exit(0));
  // Force exit after 5s if connections don't close cleanly
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const PORT = process.env.PORT ?? 3001;
httpServer.listen(PORT, () => {
  logger.info({ port: PORT }, `Bull 'Em server running on port ${PORT}`);
});
