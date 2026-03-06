import { query } from '../db/index.js';
import logger from '../logger.js';

/**
 * Record an analytics event. Fire-and-forget — never awaited in the request
 * path, never throws, never affects gameplay. Errors are logged and swallowed.
 *
 * Tracked events:
 *   game:started       — room code, player count, settings, ranked
 *   game:completed     — room code, player count, winner, duration, ranked
 *   bull:called        — player, was it correct, round number, current hand type
 *   bluff:attempted    — player, hand type called, was it caught
 *   player:registered  — auth method (email, google, apple)
 *   player:login       — auth method (email, google, apple)
 *
 * TODO(scale): matchmaking:queued  — track(mode, rating) when matchmaking queue is implemented
 * TODO(scale): matchmaking:matched — track(mode, ratingSpread, waitTimeMs) when matchmaking queue is implemented
 *
 * @param eventType - Colon-namespaced event name (e.g. "game:started")
 * @param properties - Arbitrary JSONB payload for this event
 * @param userId - Authenticated user ID, if available (null for guests)
 */
export function track(
  eventType: string,
  properties?: Record<string, unknown>,
  userId?: string | null,
): void {
  try {
    // Fire-and-forget: we intentionally do not await this promise.
    // The query() wrapper already handles DB-unavailable (returns null)
    // and logs errors internally.
    void query(
      `INSERT INTO events (event_type, user_id, properties) VALUES ($1, $2, $3)`,
      [eventType, userId ?? null, JSON.stringify(properties ?? {})],
    ).catch((err: unknown) => {
      logger.warn({ err, eventType }, 'Analytics track() insert failed — swallowed');
    });
  } catch (err: unknown) {
    // Synchronous errors (e.g. JSON.stringify failure) — swallow
    logger.warn({ err, eventType }, 'Analytics track() threw synchronously — swallowed');
  }
}
