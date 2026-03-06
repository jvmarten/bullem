/**
 * Rate limiting utilities with Redis-backed storage for multi-instance scale.
 *
 * When Redis is available, rate limit state is stored in Redis so that players
 * can't bypass cooldowns by reconnecting to a different server instance.
 * Falls back to in-memory Maps when Redis is not configured (local dev).
 *
 * Two strategies are provided:
 * - **Sliding window counter** — used for connection-level event limits and
 *   HTTP endpoint rate limiting (N requests per window).
 * - **Cooldown** — used for per-action throttling (minimum interval between
 *   actions, e.g. 200ms game action cooldown).
 */

import type { Redis } from 'ioredis';
import logger from './logger.js';

// ── Sliding window rate limiter ──────────────────────────────────────────

/**
 * Check whether a key has exceeded a rate limit (N events per window).
 * Uses Redis INCR + PEXPIRE for atomic counter with TTL.
 * Returns true if the request is ALLOWED, false if rate-limited.
 */
async function redisSlidingWindowCheck(
  redis: Redis,
  key: string,
  maxEvents: number,
  windowMs: number,
): Promise<boolean> {
  // INCR atomically increments and returns the new count.
  // If the key didn't exist, Redis creates it with value 1.
  const count = await redis.incr(key);
  if (count === 1) {
    // First event in this window — set the expiry
    await redis.pexpire(key, windowMs);
  }
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

/** Rate limiter that uses Redis when available, falling back to in-memory. */
export class RateLimiter {
  private redis: Redis | null;

  constructor(redis: Redis | null) {
    this.redis = redis;
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
    if (this.redis) {
      try {
        return await redisSlidingWindowCheck(this.redis, `rl:win:${key}`, max, windowMs);
      } catch (err) {
        // Redis failure — fall back to in-memory to avoid blocking the game
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
    if (this.redis) {
      try {
        return await redisCooldownCheck(this.redis, `rl:cd:${key}`, cooldownMs);
      } catch (err) {
        logger.warn({ err, key }, 'Redis cooldown check failed — falling back to in-memory');
        return inMemoryCooldownCheck(key, cooldownMs);
      }
    }
    return inMemoryCooldownCheck(key, cooldownMs);
  }
}
