import type { Redis } from 'ioredis';
import type { GameEngineSnapshot, GamePhase, GameSettings, PlayerId, ServerPlayer, SeriesState } from '@bull-em/shared';
import { GameEngine } from '../game/GameEngine.js';
import { Room } from './Room.js';
import logger from '../logger.js';

// ── Key design ──────────────────────────────────────────────────────────
// room:{roomCode}        → JSON-serialized RoomSnapshot (TTL: 24h)
// room:index             → Redis SET of active room codes (for enumeration on restore)
//
// TTL prevents orphaned keys from leaking memory if a server crashes without
// cleanup. The TTL is refreshed on every persist, so active rooms never expire.

const KEY_PREFIX = 'room:';
const INDEX_KEY = 'room:index';
const ROOM_TTL_SECONDS = 24 * 60 * 60; // 24 hours

/** Serializable snapshot of a Room (everything needed to restore it). */
export interface RoomSnapshot {
  roomCode: string;
  players: ServerPlayer[];
  hostId: PlayerId;
  gamePhase: GamePhase;
  settings: GameSettings;
  lastActivity: number;
  isBackgroundGame: boolean;
  /** Reconnect tokens keyed by player ID — needed to allow reconnection after restore. */
  reconnectTokens: Record<PlayerId, string>;
  /** Socket↔Player mappings are NOT persisted — sockets are ephemeral.
   *  After restore, players must reconnect via the normal reconnect flow. */
  gameSnapshot: GameEngineSnapshot | null;
  /** Maps in-game player IDs to authenticated user IDs. */
  playerUserIds?: Record<PlayerId, string>;
  /** Timestamp when the current game started. */
  gameStartedAt?: string | null;
  /** Elimination order for finish position calculation. */
  eliminationOrder?: PlayerId[];
  /** Series state for best-of matches. Null for single games. */
  seriesState?: SeriesState | null;
}

function roomKey(roomCode: string): string {
  return `${KEY_PREFIX}${roomCode}`;
}

/** Maximum retries for Redis write operations before giving up. */
const MAX_RETRIES = 3;
/** Base delay (ms) for exponential backoff between retries. */
const RETRY_BASE_DELAY_MS = 200;
/** Number of consecutive failures before logging a critical alert. */
const CONSECUTIVE_FAILURE_ALERT_THRESHOLD = 5;

/**
 * Redis-backed persistence layer for room and game state.
 *
 * Design principles:
 * - Fire-and-forget writes: persist() calls don't block game actions. Errors are
 *   logged but don't crash the server — the in-memory state is always authoritative.
 * - Reads only happen at startup (restoreAll) or explicit load — never on the hot path.
 * - All values are JSON strings with a 24h TTL to prevent key leaks.
 * - Write operations retry with exponential backoff on transient failures.
 * - Consecutive failure tracking triggers critical-level alerts for monitoring.
 */
export class RedisStore {
  private redis: Redis;
  /** Tracks consecutive write failures for alerting. Reset on any success. */
  private consecutiveFailures = 0;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /** Retry a Redis operation with exponential backoff. */
  private async withRetry<T>(operation: () => Promise<T>, context: string): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await operation();
        // Reset failure counter on success
        if (this.consecutiveFailures > 0) {
          logger.info({ previousFailures: this.consecutiveFailures }, 'Redis connection recovered');
          this.consecutiveFailures = 0;
        }
        return result;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    // All retries exhausted
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= CONSECUTIVE_FAILURE_ALERT_THRESHOLD) {
      logger.fatal(
        { err: lastError, consecutiveFailures: this.consecutiveFailures, context },
        'Redis persistent failure — room state may be lost on restart. Investigate immediately.',
      );
    } else {
      logger.error({ err: lastError, attempt: MAX_RETRIES + 1, context }, `Redis ${context} failed after ${MAX_RETRIES + 1} attempts`);
    }
    throw lastError;
  }

  /** Persist a room's current state to Redis. Fire-and-forget — errors are logged. */
  async persist(room: Room): Promise<void> {
    try {
      const snapshot = room.serialize();
      const key = roomKey(room.roomCode);
      const value = JSON.stringify(snapshot);
      await this.withRetry(async () => {
        // Pipeline: SET with TTL + add to index — single round-trip
        const pipeline = this.redis.pipeline();
        pipeline.set(key, value, 'EX', ROOM_TTL_SECONDS);
        pipeline.sadd(INDEX_KEY, room.roomCode);
        await pipeline.exec();
      }, `persist(${room.roomCode})`);
    } catch {
      // withRetry already logged the error — swallow to maintain fire-and-forget
    }
  }

  /** Remove a room from Redis. Called when a room is deleted. */
  async remove(roomCode: string): Promise<void> {
    try {
      await this.withRetry(async () => {
        const pipeline = this.redis.pipeline();
        pipeline.del(roomKey(roomCode));
        pipeline.srem(INDEX_KEY, roomCode);
        await pipeline.exec();
      }, `remove(${roomCode})`);
    } catch {
      // withRetry already logged the error — swallow to maintain fire-and-forget
    }
  }

  /** Load all persisted rooms from Redis. Called once at startup.
   *  Returns successfully restored rooms; skips and logs any corrupted entries. */
  async restoreAll(): Promise<Room[]> {
    const rooms: Room[] = [];
    try {
      const codes = await this.redis.smembers(INDEX_KEY);
      if (codes.length === 0) return rooms;

      // Batch-fetch all room snapshots in a single MGET
      const keys = codes.map(roomKey);
      const values = await this.redis.mget(...keys);

      for (let i = 0; i < codes.length; i++) {
        const code = codes[i]!;
        const raw = values[i];
        if (!raw) {
          // Key expired or was deleted — clean up the index entry
          await this.redis.srem(INDEX_KEY, code).catch(() => {});
          continue;
        }
        try {
          const snapshot: RoomSnapshot = JSON.parse(raw);
          const room = Room.restore(snapshot);
          rooms.push(room);
        } catch (err) {
          logger.error({ err, roomCode: code }, 'Failed to restore room from Redis — skipping');
          // Clean up corrupted entry
          await this.redis.del(roomKey(code)).catch(() => {});
          await this.redis.srem(INDEX_KEY, code).catch(() => {});
        }
      }
      logger.info({ count: rooms.length, total: codes.length }, 'Restored rooms from Redis');
    } catch (err) {
      logger.error({ err }, 'Failed to restore rooms from Redis');
    }
    return rooms;
  }
}
