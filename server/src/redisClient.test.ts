import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import net from 'node:net';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import logger from './logger.js';
import { createRedisClient, handleOrphanedCommandRejections, isRedisHealthy } from './redisClient.js';

vi.mock('./logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/** A TCP server that accepts connections and drops them immediately —
 *  the shape of the production Redis outage (no reply, just a close). */
async function startBlackhole(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `redis://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// Retry fast and give up after one reconnect so ioredis flushes its offline
// queue within milliseconds rather than the production ~minutes.
const FAST_FAIL = { maxRetriesPerRequest: 1, retryStrategy: () => 5 };

describe('Redis adapter during an outage', () => {
  let blackhole: Awaited<ReturnType<typeof startBlackhole>>;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };

  beforeEach(async () => {
    unhandled.length = 0;
    process.on('unhandledRejection', onUnhandled);
    blackhole = await startBlackhole();
  });

  afterEach(async () => {
    process.off('unhandledRejection', onUnhandled);
    await blackhole.close();
  });

  // Regression: Sentry NODE-EXPRESS-3. The adapter fires PUBLISH/SUBSCRIBE
  // without handling the promises; when ioredis gave up reconnecting each one
  // became an unhandled MaxRetriesPerRequestError.
  it('does not leak unhandled rejections from adapter commands', async () => {
    const pub = createRedisClient(blackhole.url, 'adapter-pub', FAST_FAIL);
    const sub = createRedisClient(blackhole.url, 'adapter-sub', FAST_FAIL);
    handleOrphanedCommandRejections(pub);
    handleOrphanedCommandRejections(sub);
    const io = new Server();
    io.adapter(createAdapter(pub, sub));

    io.to('room').emit('server:playerCount', 1); // adapter publishes, ignores the promise

    // Awaited commands share the flush with the orphaned ones, and must still
    // reject so callers can fall back.
    const results = await Promise.allSettled([pub.ping(), sub.ping()]);
    expect(results.map(r => r.status)).toEqual(['rejected', 'rejected']);
    const reason = (results[0] as PromiseRejectedResult).reason as Error;
    expect(reason.name).toBe('MaxRetriesPerRequestError');

    // Unhandled rejections are reported after the microtask queue drains.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unhandled).toEqual([]);

    // No engine is attached, so close the adapter rather than the server.
    await io.of('/').adapter.close();
    pub.disconnect();
    sub.disconnect();
  });
});

describe('createRedisClient', () => {
  let client: Redis;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(logger.error).mockClear();
    vi.mocked(logger.info).mockClear();
    client = createRedisClient('redis://127.0.0.1:1', 'test', { lazyConnect: true });
  });

  afterEach(() => {
    client.disconnect();
    vi.useRealTimers();
  });

  it('logs connection errors through the logger, throttled per client', () => {
    client.emit('error', new Error('ECONNREFUSED'));
    client.emit('error', new Error('ECONNREFUSED'));
    client.emit('error', new Error('ECONNREFUSED'));
    expect(logger.error).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    client.emit('error', new Error('ECONNREFUSED'));
    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(vi.mocked(logger.error).mock.calls[1]![0]).toMatchObject({
      client: 'test',
      suppressedSinceLastLog: 2,
    });
  });

  it('logs recovery only after a failure', () => {
    client.emit('ready');
    expect(logger.info).not.toHaveBeenCalled();

    client.emit('error', new Error('ECONNRESET'));
    client.emit('ready');
    expect(logger.info).toHaveBeenCalledWith({ client: 'test' }, 'Redis client reconnected');
  });
});

describe('isRedisHealthy', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a disconnected client unhealthy without queueing a PING', async () => {
    const client = { status: 'reconnecting', ping: vi.fn() };
    expect(await isRedisHealthy(client as never, 2000)).toBe(false);
    expect(client.ping).not.toHaveBeenCalled();
  });

  it('reports a responsive client healthy', async () => {
    const client = { status: 'ready', ping: vi.fn().mockResolvedValue('PONG') };
    expect(await isRedisHealthy(client as never, 2000)).toBe(true);
  });

  it('times out a PING that never answers', async () => {
    vi.useFakeTimers();
    const client = { status: 'ready', ping: vi.fn(() => new Promise(() => {})) };
    const result = isRedisHealthy(client as never, 2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toBe(false);
  });

  it('reports a failing PING unhealthy', async () => {
    const client = { status: 'ready', ping: vi.fn().mockRejectedValue(new Error('READONLY')) };
    expect(await isRedisHealthy(client as never, 2000)).toBe(false);
  });
});
