import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';

// In dev, Vite's proxy forwards /socket.io to localhost:3001, so '/' works
// from any device on the LAN (phone, tablet). In prod, same-origin serves it.
const URL = '/';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(URL, {
  autoConnect: false,
  // Skip HTTP long-polling and connect via WebSocket directly. This is critical
  // for multi-instance deployments: Socket.io's default polling transport sends
  // sequential HTTP requests that can land on different server instances behind a
  // load balancer, breaking the handshake. WebSocket connections are inherently
  // sticky once the TCP upgrade completes.
  transports: ['websocket'],
  reconnection: true,
  reconnectionAttempts: 20,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  withCredentials: true,
});

// Connect once at module load — the socket stays connected for the lifetime of
// the app. Individual providers register/unregister listeners but never
// disconnect, preventing the player-count inflation that occurred when
// GameProvider rapidly disconnected/reconnected on route changes.
socket.connect();
