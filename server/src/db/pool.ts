import pg from 'pg';
import logger from '../logger.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // TODO(scale): When adding read replicas, create a separate read-only pool
    // pointing to the replica connection string. Route SELECT queries there to
    // reduce load on the primary (e.g. leaderboard queries, game history reads).
  });

  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected PostgreSQL pool error');
  });

  pool.on('connect', () => {
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
    logger.info('PostgreSQL pool closed');
  }
}

export { pool, closePool };
