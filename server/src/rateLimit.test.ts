import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from './rateLimit.js';

vi.mock('./logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const BREAKER_THRESHOLD = 5;
const BREAKER_RESET_MS = 30_000;

function createMockRedis(status = 'ready') {
  return {
    status,
    eval: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue('OK'),
  };
}

// In-memory fallback state is module-level, so every check uses a fresh key.
let keySeq = 0;
const nextKey = (): string => `test-${++keySeq}`;

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses Redis when connected', async () => {
    const redis = createMockRedis();
    const limiter = new RateLimiter(redis as never);
    expect(await limiter.checkWindow(nextKey(), 10, 1000)).toBe(true);
    expect(await limiter.checkCooldown(nextKey(), 200)).toBe(true);
    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  // Regression: a disconnected client queued each check in ioredis's offline
  // queue until reconnects were exhausted, stalling every socket event for
  // minutes during the NODE-EXPRESS-3 outage.
  it('falls back to in-memory without touching a disconnected client', async () => {
    const redis = createMockRedis('reconnecting');
    const limiter = new RateLimiter(redis as never);
    const key = nextKey();
    expect(await limiter.checkWindow(key, 1, 1000)).toBe(true);
    expect(await limiter.checkWindow(key, 1, 1000)).toBe(false);
    expect(await limiter.checkCooldown(nextKey(), 200)).toBe(true);
    expect(redis.eval).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('opens the circuit after repeated Redis failures', async () => {
    const redis = createMockRedis();
    redis.eval.mockRejectedValue(new Error('ERR max requests limit exceeded'));
    const limiter = new RateLimiter(redis as never);

    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      expect(await limiter.checkWindow(nextKey(), 10, 1000)).toBe(true);
    }
    expect(redis.eval).toHaveBeenCalledTimes(BREAKER_THRESHOLD);

    await limiter.checkWindow(nextKey(), 10, 1000);
    expect(redis.eval).toHaveBeenCalledTimes(BREAKER_THRESHOLD);
  });

  // Regression: a failed half-open probe left the breaker half-open, where it
  // never probes again — Redis-backed limiting stayed off until restart.
  it('re-opens after a failed probe and keeps probing until Redis recovers', async () => {
    const redis = createMockRedis();
    redis.eval.mockRejectedValue(new Error('ERR max requests limit exceeded'));
    const limiter = new RateLimiter(redis as never);
    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      await limiter.checkWindow(nextKey(), 10, 1000);
    }

    // First probe after the reset period fails
    vi.advanceTimersByTime(BREAKER_RESET_MS);
    await limiter.checkWindow(nextKey(), 10, 1000);
    expect(redis.eval).toHaveBeenCalledTimes(BREAKER_THRESHOLD + 1);

    // Circuit is open again — no Redis calls until the next reset period
    await limiter.checkWindow(nextKey(), 10, 1000);
    expect(redis.eval).toHaveBeenCalledTimes(BREAKER_THRESHOLD + 1);

    // Second probe succeeds and closes the circuit
    redis.eval.mockResolvedValue(1);
    vi.advanceTimersByTime(BREAKER_RESET_MS);
    await limiter.checkWindow(nextKey(), 10, 1000);
    expect(redis.eval).toHaveBeenCalledTimes(BREAKER_THRESHOLD + 2);

    await limiter.checkWindow(nextKey(), 10, 1000);
    expect(redis.eval).toHaveBeenCalledTimes(BREAKER_THRESHOLD + 3);
  });
});
