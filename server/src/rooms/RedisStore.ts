import type { Redis } from 'ioredis';
import type { GameEngineSnapshot, GamePhase, GameSettings, PlayerId, ServerPlayer } from '@bull-em/shared';
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
}

function roomKey(roomCode: string): string {
  return `${KEY_PREFIX}${roomCode}`;
}

/**
 * Redis-backed persistence layer for room and game state.
 *
 * Design principles:
 * - Fire-and-forget writes: persist() calls don't block game actions. Errors are
 *   logged but don't crash the server — the in-memory state is always authoritative.
 * - Reads only happen at startup (restoreAll) or explicit load — never on the hot path.
 * - All values are JSON strings with a 24h TTL to prevent key leaks.
 */
export class RedisStore {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /** Persist a room's current state to Redis. Fire-and-forget — errors are logged. */
  async persist(room: Room): Promise<void> {
    try {
      const snapshot = room.serialize();
      const key = roomKey(room.roomCode);
      const value = JSON.stringify(snapshot);
      // Pipeline: SET with TTL + add to index — single round-trip
      const pipeline = this.redis.pipeline();
      pipeline.set(key, value, 'EX', ROOM_TTL_SECONDS);
      pipeline.sadd(INDEX_KEY, room.roomCode);
      await pipeline.exec();
    } catch (err) {
      logger.error({ err, roomCode: room.roomCode }, 'Failed to persist room to Redis');
    }
  }

  /** Remove a room from Redis. Called when a room is deleted. */
  async remove(roomCode: string): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      pipeline.del(roomKey(roomCode));
      pipeline.srem(INDEX_KEY, roomCode);
      await pipeline.exec();
    } catch (err) {
      logger.error({ err, roomCode }, 'Failed to remove room from Redis');
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
