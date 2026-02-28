import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';

const isCodespaces = typeof window !== 'undefined' && window.location.hostname.includes('.app.github.dev');
const URL = import.meta.env.DEV && !isCodespaces ? 'http://localhost:3001' : '/';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});
