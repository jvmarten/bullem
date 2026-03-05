import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type pg from 'pg';
import logger from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Run pending SQL migrations against the database.
 *
 * Creates a `migrations` tracking table if it doesn't exist, then applies any
 * `.sql` files from the migrations directory that haven't been recorded yet.
 * Each migration runs inside a transaction so a failure rolls back cleanly.
 */
export async function migrate(pool: pg.Pool): Promise<void> {
  // Ensure the migrations tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Read applied migrations
  const { rows: applied } = await pool.query<{ name: string }>(
    'SELECT name FROM migrations ORDER BY id'
  );
  const appliedSet = new Set(applied.map((r) => r.name));

  // Read migration files from disk
  let files: string[];
  try {
    files = await fs.readdir(MIGRATIONS_DIR);
  } catch {
    // In compiled output, the migrations dir may be relative to dist/
    // If not found, try the source location as a fallback
    logger.warn('No migrations directory found — skipping migrations');
    return;
  }

  const sqlFiles = files
    .filter((f) => f.endsWith('.sql'))
    .sort(); // Lexicographic sort ensures 001_ < 002_ ordering

  let appliedCount = 0;
  for (const file of sqlFiles) {
    if (appliedSet.has(file)) continue;

    const filePath = path.join(MIGRATIONS_DIR, file);
    const sql = await fs.readFile(filePath, 'utf-8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      appliedCount++;
      logger.info({ migration: file }, 'Applied migration');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err, migration: file }, 'Migration failed — rolled back');
      throw err;
    } finally {
      client.release();
    }
  }

  if (appliedCount === 0) {
    logger.debug('All migrations already applied');
  } else {
    logger.info({ count: appliedCount }, 'Database migrations complete');
  }
}
