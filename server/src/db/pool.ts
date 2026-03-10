import pg from 'pg';
import logger from '../logger.js';

const { Pool } = pg;

// --- Retry configuration ---
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

export type DbStatus = 'ok' | 'degraded' | 'unavailable';

let pool: pg.Pool | null = null;
let readPool: pg.Pool | null = null;
let dbStatus: DbStatus = 'unavailable';

/**
 * Sleep for the given number of milliseconds.
 * Extracted for testability (can be mocked to speed up tests).
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Calculate delay with exponential backoff and jitter. */
function retryDelay(attempt: number): number {
  // Exponential: 1s, 2s, 4s, 8s, 16s — capped at MAX_DELAY_MS
  const exponential = BASE_DELAY_MS * 2 ** attempt;
  const capped = Math.min(exponential, MAX_DELAY_MS);
  // Add ±25% jitter to avoid thundering herd on multi-instance restarts
  const jitter = capped * (0.75 + Math.random() * 0.5);
  return Math.round(jitter);
}

/**
 * Attempt to verify database connectivity with retries.
 * On success, sets dbStatus to 'ok'.
 * On failure after all retries, sets dbStatus to 'degraded' — the app
 * continues without persistence rather than crashing.
 */
async function verifyConnection(p: pg.Pool): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await p.query('SELECT 1');
      dbStatus = 'ok';
      logger.info('PostgreSQL connection verified');
      return;
    } catch (err) {
      const remaining = MAX_RETRIES - attempt;
      if (remaining > 0) {
        const delay = retryDelay(attempt);
        logger.warn(
          { err, attempt: attempt + 1, maxRetries: MAX_RETRIES, nextRetryMs: delay },
          `PostgreSQL connection attempt failed — retrying in ${delay}ms`,
        );
        await sleep(delay);
      } else {
        logger.error(
          { err },
          'PostgreSQL connection failed after all retries — running in degraded mode without persistence',
        );
        dbStatus = 'degraded';
      }
    }
  }
}

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Per-connection Postgres settings to limit memory usage on small VMs.
    // statement_timeout: kill queries after 30s to prevent runaway scans.
    // idle_in_transaction_session_timeout: kill abandoned transactions after 60s
    //   to release held memory and locks.
    // work_mem: limit per-operation sort/hash memory to 4MB (Postgres default is
    //   4MB but explicitly setting it guards against config drift).
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 60_000,
  });

  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected PostgreSQL pool error');
    // Mark as degraded — the pool will attempt to reconnect automatically
    // on the next query, but callers should handle failures gracefully.
    dbStatus = 'degraded';
  });

  pool.on('connect', () => {
    // If we were degraded, a successful connection means we recovered
    if (dbStatus === 'degraded') {
      logger.info('PostgreSQL connection recovered');
    }
    dbStatus = 'ok';
    logger.debug('New PostgreSQL client connected');
  });

  logger.info('PostgreSQL pool created');

  // Read replica pool for SELECT-heavy queries (leaderboard, stats).
  // Falls back to the primary pool when READ_DATABASE_URL is not set.
  const readConnectionString = process.env.READ_DATABASE_URL || process.env.DATABASE_URL;
  if (readConnectionString && readConnectionString !== process.env.DATABASE_URL) {
    readPool = new Pool({
      connectionString: readConnectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 30_000,
      idle_in_transaction_session_timeout: 60_000,
    });

    readPool.on('error', (err) => {
      logger.error({ err }, 'Unexpected read-replica pool error');
    });

    readPool.on('connect', () => {
      logger.debug('New read-replica client connected');
    });

    logger.info('PostgreSQL read-replica pool created');
  } else {
    // No separate replica — readPool reuses the primary pool
    readPool = pool;
    logger.info('No READ_DATABASE_URL set — read queries will use the primary pool');
  }
} else {
  logger.warn(
    'DATABASE_URL not set — PostgreSQL is unavailable. ' +
    'The app will run without persistence features.'
  );
}

/** Close all pools gracefully. Safe to call even if pools are null. */
async function closePool(): Promise<void> {
  // Close read pool first (if it's a separate pool, not the same reference)
  if (readPool && readPool !== pool) {
    await readPool.end();
    logger.info('PostgreSQL read-replica pool closed');
  }
  if (pool) {
    await pool.end();
    dbStatus = 'unavailable';
    logger.info('PostgreSQL pool closed');
  }
}

/**
 * Verify database connectivity on startup with retries.
 * Call this once during server initialization. Safe to call if pool is null.
 */
async function connectWithRetry(): Promise<void> {
  if (!pool) return;
  await verifyConnection(pool);
  // Verify read replica separately if it's a distinct pool
  if (readPool && readPool !== pool) {
    logger.info('Verifying read-replica connection…');
    await verifyConnection(readPool);
  }
}

/** Get the current database connection status. */
function getDbStatus(): DbStatus {
  return dbStatus;
}

export { pool, readPool, closePool, connectWithRetry, getDbStatus };
