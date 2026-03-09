import pg from 'pg';
import logger from '../logger.js';

const { Pool } = pg;

// --- Retry configuration ---
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

export type DbStatus = 'ok' | 'degraded' | 'unavailable';

let pool: pg.Pool | null = null;
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
    // TODO(scale): When adding read replicas, create a separate read-only pool
    // pointing to the replica connection string. Route SELECT queries there to
    // reduce load on the primary (e.g. leaderboard queries, game history reads).
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
} else {
  logger.warn(
    'DATABASE_URL not set — PostgreSQL is unavailable. ' +
    'The app will run without persistence features.'
  );
}

/** Close the pool gracefully. Safe to call even if pool is null. */
async function closePool(): Promise<void> {
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
}

/** Get the current database connection status. */
function getDbStatus(): DbStatus {
  return dbStatus;
}

export { pool, closePool, connectWithRetry, getDbStatus };
