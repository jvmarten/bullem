import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';
import { RoomManager } from './rooms/RoomManager.js';
import { BotManager } from './game/BotManager.js';
import { BackgroundGameManager } from './game/BackgroundGameManager.js';
import { registerHandlers } from './socket/registerHandlers.js';

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
  },
});

const roomManager = new RoomManager();
const botManager = new BotManager();
const backgroundGameManager = new BackgroundGameManager(io, roomManager, botManager);
registerHandlers(io, roomManager, botManager);
roomManager.startCleanup(io);
backgroundGameManager.start();

// Health check — registered before the SPA catch-all
app.get('/health', (_req, res) => res.json({
  status: 'ok',
  rooms: roomManager.roomCount,
  players: io.engine.clientsCount,
}));

// In production, serve built client
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
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
  console.log('Shutting down...');
  backgroundGameManager.stop();
  botManager.clearTimers();
  roomManager.stopCleanup();
  io.close();
  httpServer.close(() => process.exit(0));
  // Force exit after 5s if connections don't close cleanly
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const PORT = process.env.PORT ?? 3001;
httpServer.listen(PORT, () => {
  console.log(`Bull 'Em server running on port ${PORT}`);
});
