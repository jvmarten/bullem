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
import { registerHandlers } from './socket/registerHandlers.js';
import { authRouter } from './auth/routes.js';
import { optionalAuth } from './auth/middleware.js';
import logger from './logger.js';
import { pool, closePool, connectWithRetry, getDbStatus, migrate } from './db/index.js';

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
if (process.env.REDIS_URL) {
  const pubClient = new Redis(process.env.REDIS_URL);
  const subClient = pubClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));
  pubClient.on('connect', () => {
    logger.info('Redis adapter connected — Socket.io pub/sub is active');
  });

  // Create a dedicated client for session persistence (separate from pub/sub
  // clients to avoid command conflicts on subscribed connections).
  const storeClient = new Redis(process.env.REDIS_URL);
  redisStore = new RedisStore(storeClient);
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
      }
    }
  }
  next();
});

const roomManager = new RoomManager();
if (redisStore) {
  roomManager.setRedisStore(redisStore);
}
const botManager = new BotManager();
botManager.setRoomManager(roomManager);
const backgroundGameManager = new BackgroundGameManager(io, roomManager, botManager);
registerHandlers(io, roomManager, botManager);

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
})();

// Parse JSON bodies and cookies for auth routes
app.use(express.json());
app.use(cookieParser());

// CORS for HTTP routes (auth API). In dev, allow localhost; in prod, same-origin handles it.
if (process.env.NODE_ENV !== 'production') {
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', _req.headers.origin ?? '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });
}

app.use(optionalAuth);

// Auth routes
app.use('/auth', authRouter);

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

  const httpStatus = db === 'ok' ? 200 : 503;
  res.status(httpStatus).json({
    status: db === 'ok' ? 'ok' : 'degraded',
    db,
    rooms: roomManager.roomCount,
    players: io.engine.clientsCount,
  });
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
    if (req.path.startsWith('/auth/') || req.path.startsWith('/health')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Broadcast online player count and names on connect/disconnect.
// Debounced: rapid connect/disconnect bursts (e.g. 20 players joining at once)
// collapse into a single broadcast instead of one per event.
let broadcastPending: ReturnType<typeof setTimeout> | null = null;
function scheduleBroadcastPlayerCount(): void {
  if (broadcastPending) return;
  broadcastPending = setTimeout(() => {
    broadcastPending = null;
    const count = io.engine.clientsCount;
    io.emit('server:playerCount', count);
    io.emit('server:playerNames', roomManager.getOnlinePlayerNames());
  }, 100);
}
io.on('connection', () => scheduleBroadcastPlayerCount());
io.engine.on('close', () => scheduleBroadcastPlayerCount());

// Graceful shutdown — clean up timers and close connections
function shutdown(): void {
  logger.info('Shutting down...');
  backgroundGameManager.stop();
  botManager.clearTimers();
  roomManager.stopCleanup();
  io.close();
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
