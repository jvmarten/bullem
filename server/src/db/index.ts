import type { QueryResult, QueryResultRow } from 'pg';
import { pool } from './pool.js';
import logger from '../logger.js';

export { pool, closePool } from './pool.js';
export { migrate } from './migrate.js';

const SLOW_QUERY_THRESHOLD_MS = 100;

/**
 * Execute a SQL query against the pool with automatic slow-query logging.
 *
 * Returns null if the pool is unavailable (DATABASE_URL not set).
 * Callers should check for null and handle the no-database case gracefully.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T> | null> {
  if (!pool) return null;

  const start = performance.now();
  const result = await pool.query<T>(text, params);
  const durationMs = Math.round(performance.now() - start);

  if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
    logger.warn(
      { durationMs, query: text, rows: result.rowCount },
      'Slow database query detected',
    );
  }

  return result;
}
