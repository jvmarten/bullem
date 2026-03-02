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

// Health check must be registered before the SPA catch-all
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// In production, serve built client
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

const roomManager = new RoomManager();
const botManager = new BotManager();
registerHandlers(io, roomManager, botManager);
roomManager.startCleanup();

// Broadcast online player count on connect/disconnect
function broadcastPlayerCount(): void {
  const count = io.engine.clientsCount;
  io.emit('server:playerCount', count);
}
io.on('connection', () => broadcastPlayerCount());
io.engine.on('close', () => {
  // engine 'close' fires after socket disconnect — delay to let count update
  setTimeout(broadcastPlayerCount, 50);
});

const PORT = process.env.PORT ?? 3001;
httpServer.listen(PORT, () => {
  console.log(`Bull 'Em server running on port ${PORT}`);
});
