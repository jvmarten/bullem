/**
 * Rate limiting utilities with Redis-backed storage for multi-instance scale.
 *
 * When Redis is available, rate limit state is stored in Redis so that players
 * can't bypass cooldowns by reconnecting to a different server instance.
 * Falls back to in-memory Maps when Redis is not configured (local dev).
 *
 * Includes a circuit breaker that automatically switches to in-memory limiting
 * when Redis errors accumulate, preventing abuse during Redis outages. The
 * breaker resets after a cooldown period, resuming Redis-backed limiting once
 * the connection recovers.
 *
 * Two strategies are provided:
 * - **Sliding window counter** — used for connection-level event limits and
 *   HTTP endpoint rate limiting (N requests per window).
 * - **Cooldown** — used for per-action throttling (minimum interval between
 *   actions, e.g. 200ms game action cooldown).
 */

import type { Redis } from 'ioredis';
import logger from './logger.js';

// ── Circuit breaker ─────────────────────────────────────────────────────

/** Number of consecutive Redis failures before the circuit opens. */
const CIRCUIT_BREAKER_THRESHOLD = 5;
/** How long (ms) the circuit stays open before attempting Redis again. */
const CIRCUIT_BREAKER_RESET_MS = 30_000;

enum CircuitState {
  CLOSED = 'closed',       // Normal — Redis is used
  OPEN = 'open',           // Redis failed too many times — using in-memory only
  HALF_OPEN = 'half_open', // Testing if Redis has recovered
}

class CircuitBreaker {
  private state = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;

  /** Record a successful Redis call — resets failure count and closes the circuit. */
  onSuccess(): void {
    this.failureCount = 0;
    if (this.state !== CircuitState.CLOSED) {
      logger.info('Rate limiter circuit breaker closed — Redis recovered');
      this.state = CircuitState.CLOSED;
    }
  }

  /** Record a Redis failure. Opens the circuit if the threshold is exceeded. */
  onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= CIRCUIT_BREAKER_THRESHOLD && this.state === CircuitState.CLOSED) {
      this.state = CircuitState.OPEN;
      logger.warn(
        { failureCount: this.failureCount },
        'Rate limiter circuit breaker opened — falling back to in-memory limiting',
      );
    }
  }

  /** Returns true if Redis should be attempted for this request. */
  shouldAttemptRedis(): boolean {
    switch (this.state) {
      case CircuitState.CLOSED:
        return true;
      case CircuitState.OPEN:
        // After the reset period, allow one probe request
        if (Date.now() - this.lastFailureTime >= CIRCUIT_BREAKER_RESET_MS) {
          this.state = CircuitState.HALF_OPEN;
          logger.info('Rate limiter circuit breaker half-open — probing Redis');
          return true;
        }
        return false;
      case CircuitState.HALF_OPEN:
        // Only one probe at a time — additional requests use in-memory
        return false;
    }
  }
}

// ── Sliding window rate limiter ──────────────────────────────────────────

/**
 * Lua script for atomic INCR + conditional PEXPIRE.
 * Ensures the TTL is always set when the key is first created, even if
 * the server crashes between operations (prevents immortal rate-limit keys).
 */
const INCR_WITH_EXPIRE_LUA = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
  end
  return count
`;

/**
 * Check whether a key has exceeded a rate limit (N events per window).
 * Uses a Lua script for atomic INCR + conditional PEXPIRE.
 * Returns true if the request is ALLOWED, false if rate-limited.
 */
async function redisSlidingWindowCheck(
  redis: Redis,
  key: string,
  maxEvents: number,
  windowMs: number,
): Promise<boolean> {
  const count = await redis.eval(
    INCR_WITH_EXPIRE_LUA,
    1,     // number of keys
    key,   // KEYS[1]
    windowMs, // ARGV[1]
  ) as number;
  return count <= maxEvents;
}

/**
 * In-memory sliding window — used when Redis is not available.
 * Stores { count, windowStart } per key.
 */
const inMemoryWindows = new Map<string, { count: number; windowStart: number }>();

function inMemorySlidingWindowCheck(
  key: string,
  maxEvents: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const entry = inMemoryWindows.get(key);

  if (!entry || now - entry.windowStart > windowMs) {
    inMemoryWindows.set(key, { count: 1, windowStart: now });
    return true;
  }

  entry.count++;
  return entry.count <= maxEvents;
}

// ── Cooldown rate limiter ────────────────────────────────────────────────

/**
 * Check whether a key is within its cooldown period.
 * Uses Redis SET with PX (millisecond expiry) and NX (only set if not exists).
 * Returns true if the action is ALLOWED (cooldown has passed), false otherwise.
 */
async function redisCooldownCheck(
  redis: Redis,
  key: string,
  cooldownMs: number,
): Promise<boolean> {
  // SET key "1" PX cooldownMs NX — only succeeds if key doesn't exist.
  // If the key exists (cooldown active), returns null → action blocked.
  // If the key doesn't exist, it's set with the cooldown TTL → action allowed.
  const result = await redis.set(key, '1', 'PX', cooldownMs, 'NX');
  return result === 'OK';
}

/**
 * In-memory cooldown — used when Redis is not available.
 */
const inMemoryCooldowns = new Map<string, number>();

function inMemoryCooldownCheck(key: string, cooldownMs: number): boolean {
  const now = Date.now();
  const lastTime = inMemoryCooldowns.get(key) ?? 0;
  if (now - lastTime < cooldownMs) {
    return false;
  }
  inMemoryCooldowns.set(key, now);
  return true;
}

// ── Clean up in-memory state ─────────────────────────────────────────────

/** Prune stale in-memory entries. Only relevant when Redis is not configured. */
function pruneInMemoryState(): void {
  const now = Date.now();
  // Prune windows older than 2 minutes
  for (const [key, entry] of inMemoryWindows) {
    if (now - entry.windowStart > 120_000) inMemoryWindows.delete(key);
  }
  // Prune cooldowns older than 60 seconds
  for (const [key, ts] of inMemoryCooldowns) {
    if (now - ts > 60_000) inMemoryCooldowns.delete(key);
  }
}

setInterval(pruneInMemoryState, 60_000).unref();

// ── Public API ───────────────────────────────────────────────────────────

/** Rate limiter that uses Redis when available, falling back to in-memory.
 *  Includes a circuit breaker to avoid hammering a failing Redis and to
 *  ensure rate limiting remains enforced via in-memory during outages. */
export class RateLimiter {
  private redis: Redis | null;
  private breaker: CircuitBreaker;

  constructor(redis: Redis | null) {
    this.redis = redis;
    this.breaker = new CircuitBreaker();
    if (!redis) {
      // TODO(scale): In-memory rate limiting only works on a single instance.
      // At multi-instance scale, REDIS_URL must be set for rate limits to be
      // enforced globally across all instances.
      logger.warn('RateLimiter initialized without Redis — using in-memory storage (single-instance only)');
    }
  }

  /**
   * Check a sliding window rate limit (N events per window).
   * Returns true if the request is ALLOWED.
   *
   * @param key   Unique identifier (e.g. `socket:${socketId}`, `ip:${ip}`)
   * @param max   Maximum events allowed in the window
   * @param windowMs  Window duration in milliseconds
   */
  async checkWindow(key: string, max: number, windowMs: number): Promise<boolean> {
    if (this.redis && this.breaker.shouldAttemptRedis()) {
      try {
        const result = await redisSlidingWindowCheck(this.redis, `rl:win:${key}`, max, windowMs);
        this.breaker.onSuccess();
        return result;
      } catch (err) {
        this.breaker.onFailure();
        logger.warn({ err, key }, 'Redis rate limit check failed — falling back to in-memory');
        return inMemorySlidingWindowCheck(key, max, windowMs);
      }
    }
    return inMemorySlidingWindowCheck(key, max, windowMs);
  }

  /**
   * Check a cooldown (minimum interval between actions).
   * Returns true if the action is ALLOWED (cooldown has elapsed).
   *
   * @param key   Unique identifier (e.g. `action:${playerId}`)
   * @param cooldownMs  Minimum interval in milliseconds
   */
  async checkCooldown(key: string, cooldownMs: number): Promise<boolean> {
    if (this.redis && this.breaker.shouldAttemptRedis()) {
      try {
        const result = await redisCooldownCheck(this.redis, `rl:cd:${key}`, cooldownMs);
        this.breaker.onSuccess();
        return result;
      } catch (err) {
        this.breaker.onFailure();
        logger.warn({ err, key }, 'Redis cooldown check failed — falling back to in-memory');
        return inMemoryCooldownCheck(key, cooldownMs);
      }
    }
    return inMemoryCooldownCheck(key, cooldownMs);
  }
}
