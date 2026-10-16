import { Redis, type RedisOptions } from 'ioredis';
import logger from './logger.js';

/** Minimum interval between repeated error logs for the same client. */
const ERROR_LOG_INTERVAL_MS = 60_000;

/**
 * Create an ioredis client with structured connection logging.
 *
 * Every client needs an `error` listener: without one ioredis prints
 * "[ioredis] Unhandled error event" to the console on each connection
 * failure, bypassing the structured logger. Errors are throttled per client
 * because an outage emits one per reconnect attempt, on every client.
 */
export function createRedisClient(url: string, name: string, options: RedisOptions = {}): Redis {
  const client = new Redis(url, options);
  let lastLoggedAt = 0;
  let suppressed = 0;
  let failing = false;

  client.on('error', (err: Error) => {
    failing = true;
    const now = Date.now();
    if (now - lastLoggedAt < ERROR_LOG_INTERVAL_MS) {
      suppressed++;
      return;
    }
    logger.error({ err, client: name, suppressedSinceLastLog: suppressed }, 'Redis client error');
    lastLoggedAt = now;
    suppressed = 0;
  });

  client.on('ready', () => {
    if (!failing) return;
    failing = false;
    logger.info({ client: name }, 'Redis client reconnected');
  });

  return client;
}

/**
 * Mark every command promise on `client` as handled.
 *
 * @socket.io/redis-adapter issues PUBLISH/PSUBSCRIBE/SUBSCRIBE without
 * handling the returned promise, and ioredis's own auto-resubscribe does the
 * same. While Redis is unreachable those commands wait in the offline queue;
 * once reconnect attempts reach `maxRetriesPerRequest` ioredis rejects them
 * all with MaxRetriesPerRequestError, and each one surfaces as an unhandled
 * rejection. Callers that await a command still receive the rejection — this
 * only stops orphaned promises from being reported. The outage itself is
 * logged by the client's `error` listener and reported by /health.
 *
 * Only apply this to clients whose commands are issued by library code.
 */
export function handleOrphanedCommandRejections(client: Redis): void {
  const sendCommand = client.sendCommand.bind(client);
  client.sendCommand = (command, stream) => {
    command.promise.catch(() => { /* surfaced via the error listener */ });
    return sendCommand(command, stream);
  };
}

/**
 * Probe Redis without queueing behind an outage.
 *
 * A client that isn't connected is reported unhealthy immediately: a PING
 * issued while reconnecting waits in ioredis's offline queue until reconnect
 * attempts are exhausted (minutes), far past any health check timeout.
 */
export async function isRedisHealthy(client: Redis, timeoutMs: number): Promise<boolean> {
  if (client.status !== 'ready') return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.ping(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Redis ping timed out')), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
