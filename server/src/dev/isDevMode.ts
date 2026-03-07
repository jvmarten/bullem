/**
 * Dev mode detection. Active when running outside production AND no database
 * is configured. Must NEVER activate in production.
 */

/** True when dev auth and seed data should be active. */
export function isDevAuthActive(): boolean {
  return process.env.NODE_ENV !== 'production' && !process.env.DATABASE_URL;
}

/** True when in-memory matchmaking should be used (no Redis). */
export function isDevMatchmakingActive(): boolean {
  return process.env.NODE_ENV !== 'production' && !process.env.REDIS_URL;
}
