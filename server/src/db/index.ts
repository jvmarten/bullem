import type { QueryResult, QueryResultRow } from 'pg';
import { pool, readPool } from './pool.js';
import logger from '../logger.js';

export { pool, readPool, closePool, connectWithRetry, getDbStatus } from './pool.js';
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

/**
 * Schema/programming error codes (class 42) that indicate missing tables,
 * columns, or other DDL issues. These are NOT transient — retrying won't help.
 * Log at warn level since they typically mean a migration hasn't been applied yet.
 */
const SCHEMA_ERROR_PG_CODES = new Set([
  '42P01', // undefined_table (relation does not exist)
  '42703', // undefined_column
  '42P02', // undefined_parameter
  '42883', // undefined_function
]);

/** Check whether a query error is a transient connection issue worth retrying. */
function isRetryable(err: unknown): boolean {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    return RETRYABLE_PG_CODES.has(String((err as { code: string }).code));
  }
  return false;
}

/** Check whether a query error is a schema/DDL issue (missing table, column, etc.). */
function isSchemaError(err: unknown): boolean {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    return SCHEMA_ERROR_PG_CODES.has(String((err as { code: string }).code));
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
    // Schema errors (missing table/column) are not transient — don't retry,
    // log at warn to reduce noise. Typically means a migration hasn't run yet.
    if (isSchemaError(err)) {
      const durationMs = Math.round(performance.now() - start);
      logger.warn(
        { err, durationMs, query: text },
        'Database query hit schema error (missing table/column) — returning null',
      );
      return null;
    }

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

/**
 * Execute a read-only SQL query against the read-replica pool.
 *
 * Uses the same retry/slow-query logic as `query()` but routes to the
 * read pool (which may be a separate replica or the primary, depending
 * on whether READ_DATABASE_URL is configured).
 *
 * Use this for SELECT-heavy workloads (leaderboards, stats) to reduce
 * load on the primary database.
 */
export async function readQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T> | null> {
  if (!readPool) return null;

  const start = performance.now();
  try {
    const result = await readPool.query<T>(text, params);
    const durationMs = Math.round(performance.now() - start);

    if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
      logger.warn(
        { durationMs, query: text, rows: result.rowCount },
        'Slow read-replica query detected',
      );
    }

    return result;
  } catch (err) {
    // Schema errors (missing table/column) are not transient — don't retry,
    // log at warn to reduce noise. Typically means a migration hasn't run yet.
    if (isSchemaError(err)) {
      const durationMs = Math.round(performance.now() - start);
      logger.warn(
        { err, durationMs, query: text },
        'Read-replica query hit schema error (missing table/column) — returning null',
      );
      return null;
    }

    if (isRetryable(err)) {
      logger.warn(
        { err, query: text },
        'Transient read-replica error — retrying once',
      );
      try {
        const result = await readPool.query<T>(text, params);
        const durationMs = Math.round(performance.now() - start);
        if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
          logger.warn(
            { durationMs, query: text, rows: result.rowCount },
            'Slow read-replica query detected (after retry)',
          );
        }
        return result;
      } catch (retryErr) {
        const durationMs = Math.round(performance.now() - start);
        logger.error(
          { err: retryErr, durationMs, query: text },
          'Read-replica query failed after retry — returning null',
        );
        return null;
      }
    }

    const durationMs = Math.round(performance.now() - start);
    logger.error(
      { err, durationMs, query: text },
      'Read-replica query failed — returning null',
    );
    return null;
  }
}
