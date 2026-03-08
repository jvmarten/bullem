import type { QueryResult, QueryResultRow } from 'pg';
import { pool } from './pool.js';
import logger from '../logger.js';

export { pool, closePool, connectWithRetry, getDbStatus } from './pool.js';
export type { DbStatus } from './pool.js';
export { migrate } from './migrate.js';

const SLOW_QUERY_THRESHOLD_MS = 100;

/** Connection-level error codes that are worth retrying (transient failures). */
const RETRYABLE_PG_CODES = new Set([
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '57P01', // admin_shutdown
  '57P03', // cannot_connect_now
]);

/** Check whether a query error is a transient connection issue worth retrying. */
function isRetryable(err: unknown): boolean {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    return RETRYABLE_PG_CODES.has(String((err as { code: string }).code));
  }
  return false;
}

/**
 * Execute a SQL query against the pool with automatic slow-query logging.
 *
 * Returns null if the pool is unavailable (DATABASE_URL not set).
 * Retries once on transient connection errors (pool recovery, DB restart)
 * before falling back to null.
 * Callers should check for null and handle the no-database case gracefully.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T> | null> {
  if (!pool) return null;

  const start = performance.now();
  try {
    const result = await pool.query<T>(text, params);
    const durationMs = Math.round(performance.now() - start);

    if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
      logger.warn(
        { durationMs, query: text, rows: result.rowCount },
        'Slow database query detected',
      );
    }

    return result;
  } catch (err) {
    // Retry once for transient connection errors (pool recovery, DB restart).
    if (isRetryable(err)) {
      logger.warn(
        { err, query: text },
        'Transient database error — retrying once',
      );
      try {
        const result = await pool.query<T>(text, params);
        const durationMs = Math.round(performance.now() - start);
        if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
          logger.warn(
            { durationMs, query: text, rows: result.rowCount },
            'Slow database query detected (after retry)',
          );
        }
        return result;
      } catch (retryErr) {
        const durationMs = Math.round(performance.now() - start);
        logger.error(
          { err: retryErr, durationMs, query: text },
          'Database query failed after retry — returning null to degrade gracefully',
        );
        return null;
      }
    }

    const durationMs = Math.round(performance.now() - start);
    logger.error(
      { err, durationMs, query: text },
      'Database query failed — returning null to degrade gracefully',
    );
    return null;
  }
}
