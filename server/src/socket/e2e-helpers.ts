/**
 * E2E test utilities for spinning up a real Socket.io server and connecting
 * multiple clients. Used by integration tests to exercise the full socket
 * pipeline: validation → engine → broadcast → client receive.
 */
import { createServer, type Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  ClientGameState,
  RoomState,
  RoundResult,
  HandCall,
  GameSettings,
  PlayerId,
  GameStats,
} from '@bull-em/shared';
import { RoomManager } from '../rooms/RoomManager.js';
import { BotManager } from '../game/BotManager.js';
import { registerHandlers } from './registerHandlers.js';
import { RateLimiter } from '../rateLimit.js';

type TypedClientSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

export interface TestContext {
  httpServer: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  roomManager: RoomManager;
  botManager: BotManager;
  port: number;
  /** Connect a new client socket. Must be disconnected manually or via cleanup(). */
  connectClient: () => Promise<TypedClientSocket>;
  /** Disconnect all clients and shut down the server. */
  cleanup: () => Promise<void>;
}

/**
 * Spin up a real HTTP + Socket.io server on a random port.
 * Returns helpers for connecting clients and tearing down.
 */
export async function createTestServer(): Promise<TestContext> {
  const httpServer = createServer();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: true },
  });

  const roomManager = new RoomManager();
  const botManager = new BotManager();
  botManager.setRoomManager(roomManager);
  const rateLimiter = new RateLimiter(null);
  const { PushManager } = await import('../push/PushManager.js');
  const pushManager = new PushManager();
  registerHandlers(io, roomManager, botManager, rateLimiter, pushManager);

  const clients: TypedClientSocket[] = [];

  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve());
  });

  const addr = httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  const connectClient = async (): Promise<TypedClientSocket> => {
    const client = ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
    }) as TypedClientSocket;
    clients.push(client);
    await new Promise<void>((resolve) => {
      client.on('connect', resolve);
    });
    return client;
  };

  const cleanup = async (): Promise<void> => {
    botManager.clearTimers();
    for (const c of clients) {
      if (c.connected) c.disconnect();
    }
    clients.length = 0;
    io.close();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  };

  return { httpServer, io, roomManager, botManager, port, connectClient, cleanup };
}

// ── Client helper wrappers ──────────────────────────────────────────────

/** Create a room and return the room code + reconnect token. */
export function createRoom(
  client: TypedClientSocket,
  playerName: string,
): Promise<{ roomCode: string; reconnectToken: string }> {
  return new Promise((resolve, reject) => {
    client.emit('room:create', { playerName }, (res) => {
      if ('error' in res) return reject(new Error(res.error));
      resolve(res as { roomCode: string; reconnectToken: string });
    });
  });
}

/** Join a room and return the player ID + reconnect token. */
export function joinRoom(
  client: TypedClientSocket,
  roomCode: string,
  playerName: string,
  reconnectData?: { playerId: string; reconnectToken: string },
): Promise<{ playerId: string; reconnectToken: string }> {
  return new Promise((resolve, reject) => {
    client.emit('room:join', {
      roomCode,
      playerName,
      ...reconnectData,
    }, (res) => {
      if ('error' in res) return reject(new Error(res.error));
      resolve(res as { playerId: string; reconnectToken: string });
    });
  });
}

/** Add a bot to the room. */
export function addBot(
  client: TypedClientSocket,
  botName?: string,
): Promise<{ botId: string }> {
  return new Promise((resolve, reject) => {
    client.emit('room:addBot', { botName }, (res) => {
      if ('error' in res) return reject(new Error(res.error));
      resolve(res as { botId: string });
    });
  });
}

/** Kick a player from the room. */
export function kickPlayer(
  client: TypedClientSocket,
  playerId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    client.emit('room:kickPlayer', { playerId }, (res) => {
      if ('error' in res) return reject(new Error(res.error));
      resolve();
    });
  });
}

/** Wait for a specific server event, with a timeout. */
export function waitForEvent<E extends keyof ServerToClientEvents>(
  client: TypedClientSocket,
  event: E,
  timeoutMs = 5000,
): Promise<Parameters<ServerToClientEvents[E]>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for "${event}" after ${timeoutMs}ms`));
    }, timeoutMs);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).once(event, (...args: unknown[]) => {
      clearTimeout(timer);
      resolve(args as Parameters<ServerToClientEvents[E]>);
    });
  });
}

/** Collect N occurrences of an event. */
export function collectEvents<E extends keyof ServerToClientEvents>(
  client: TypedClientSocket,
  event: E,
  count: number,
  timeoutMs = 10000,
): Promise<Parameters<ServerToClientEvents[E]>[]> {
  return new Promise((resolve, reject) => {
    const results: Parameters<ServerToClientEvents[E]>[] = [];
    const timer = setTimeout(() => {
      reject(new Error(`Timed out collecting ${count} "${event}" events (got ${results.length}) after ${timeoutMs}ms`));
    }, timeoutMs);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (...args: unknown[]): void => {
      results.push(args as Parameters<ServerToClientEvents[E]>);
      if (results.length >= count) {
        clearTimeout(timer);
        (client as any).off(event, handler);
        resolve(results);
      }
    };
    (client as any).on(event, handler);
  });
}

/** Small delay for letting async socket events propagate. */
export function tick(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Update room settings (host only, fire-and-forget). */
export function updateSettings(
  client: TypedClientSocket,
  settings: GameSettings,
): void {
  client.emit('room:updateSettings', { settings });
}

/** Start the game (host only, fire-and-forget). */
export function startGame(client: TypedClientSocket): void {
  client.emit('game:start');
}

/** Make a hand call. */
export function gameCall(client: TypedClientSocket, hand: HandCall): void {
  client.emit('game:call', { hand });
}

/** Call bull. */
export function gameBull(client: TypedClientSocket): void {
  client.emit('game:bull');
}

/** Call true. */
export function gameTrue(client: TypedClientSocket): void {
  client.emit('game:true');
}

/** Last chance raise. */
export function gameLastChanceRaise(client: TypedClientSocket, hand: HandCall): void {
  client.emit('game:lastChanceRaise', { hand });
}

/** Last chance pass. */
export function gameLastChancePass(client: TypedClientSocket): void {
  client.emit('game:lastChancePass');
}

/** Press continue after round result. */
export function gameContinue(client: TypedClientSocket): void {
  client.emit('game:continue');
}

/** Start a rematch (host only). */
export function gameRematch(client: TypedClientSocket): void {
  client.emit('game:rematch');
}
