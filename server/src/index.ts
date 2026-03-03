import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';
import { RoomManager } from './rooms/RoomManager.js';
import { BotManager } from './game/BotManager.js';
import { registerHandlers } from './socket/registerHandlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : true,
    methods: ['GET', 'POST'],
  },
});

const roomManager = new RoomManager();
const botManager = new BotManager();
registerHandlers(io, roomManager, botManager);
roomManager.startCleanup();

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

// Broadcast online player count and names on connect/disconnect
function broadcastPlayerCount(): void {
  const count = io.engine.clientsCount;
  io.emit('server:playerCount', count);
  io.emit('server:playerNames', roomManager.getOnlinePlayerNames());
}
io.on('connection', () => broadcastPlayerCount());
io.engine.on('close', () => {
  // engine 'close' fires after socket disconnect — delay to let count update
  setTimeout(broadcastPlayerCount, 50);
});

// Graceful shutdown — clean up timers and close connections
function shutdown(): void {
  console.log('Shutting down...');
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
