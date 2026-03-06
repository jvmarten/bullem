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
import { optionalAuth, requireAuth } from './auth/middleware.js';
import { createAdminRouter } from './admin/routes.js';
import logger from './logger.js';
import { pool, closePool, connectWithRetry, getDbStatus, migrate, query } from './db/index.js';
import { registerGaugeCallbacks, serializeMetrics, httpRequestsTotal } from './metrics.js';
import { RateLimiter } from './rateLimit.js';
import { PushManager } from './push/PushManager.js';

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
// Redis for queue state. Without Redis, ranked matchmaking is disabled.
let matchmakingQueue: MatchmakingQueue | undefined;
if (rateLimitRedis) {
  // Reuse a dedicated Redis client for matchmaking sorted sets.
  // TODO(scale): At very high scale, consider a separate Redis client
  // to avoid contention with rate limiting on the same connection.
  const matchmakingRedis = new Redis(process.env.REDIS_URL!);
  redisClients.push(matchmakingRedis);
  matchmakingQueue = new MatchmakingQueue(io, matchmakingRedis, roomManager, botManager);
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

  // Start matchmaking queue after Redis and DB are ready
  if (matchmakingQueue) {
    matchmakingQueue.start();
    logger.info('Ranked matchmaking enabled (Redis available)');
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

// Auth routes
app.use('/auth', authRouter);
app.use('/auth', oauthRouter);

// Admin routes
app.use('/admin', createAdminRouter(io, roomManager, botManager));

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

    const result = await getLeaderboard(
      mode as RankedMode,
      period as LeaderboardPeriod,
      limit,
      offset,
      req.user?.userId,
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

// ── Calibration status endpoint ─────────────────────────────────────────
// TODO: add admin auth — currently unauthenticated for dev/monitoring convenience
app.get('/api/admin/calibration', (_req, res) => {
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
