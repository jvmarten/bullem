import { query } from './index.js';
import logger from '../logger.js';
import type {
  RankedMode,
  LeaderboardPeriod,
  LeaderboardPlayerFilter,
  LeaderboardEntry,
  LeaderboardResponse,
  LeaderboardNearbyResponse,
} from '@bull-em/shared';
import { getRankTier, openSkillDisplayRating } from '@bull-em/shared';

// ── In-memory cache (TTL-based) ─────────────────────────────────────────
// TODO(scale): Replace with Redis cache when Redis is the primary cache layer.

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Clear all cached leaderboard data. Exported for testing. */
export function clearLeaderboardCache(): void {
  cache.clear();
}

/** Minimum number of ranked games required to appear on the leaderboard. */
const MIN_GAMES = 5;

// ── Leaderboard queries ─────────────────────────────────────────────────

interface LeaderboardRow {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  rating: string;
  games_played: string;
  rank: string;
  is_bot: boolean;
}

interface CountRow {
  total: string;
}

/**
 * Valid bot_profile pattern: {personality}_lvl{1-8} or cfr_{name}.
 * Covers 72 heuristic bots (9 personalities × 8 levels) + 9 CFR bots = 81 total.
 * Filters out orphaned/duplicate bot rows that may exist in the database.
 */
const VALID_BOT_PROFILE_PATTERN = "'^((rock|bluffer|grinder|wildcard|professor|shark|cannon|frost|hustler)_lvl[1-8]|cfr_(viper|ghost|reaper|specter|raptor|havoc|phantom|sentinel|vanguard))$'";

/**
 * Build a WHERE clause fragment that filters by player type (all/players/bots).
 */
function playerTypeFilter(filter: LeaderboardPlayerFilter): string {
  switch (filter) {
    case 'players':
      return 'AND u.is_bot = false';
    case 'bots':
      return `AND u.is_bot = true AND u.bot_profile ~ ${VALID_BOT_PROFILE_PATTERN}`;
    case 'all':
    default:
      // Exclude orphaned/invalid bot rows (e.g., old heuristic bots at lvl9)
      // while still showing all valid bots and all human players.
      return `AND (u.is_bot = false OR u.bot_profile ~ ${VALID_BOT_PROFILE_PATTERN})`;
  }
}

/**
 * Build a WHERE clause fragment that filters by time period.
 * For 'all_time', no filter is applied. For 'month'/'week', only ratings
 * updated within the period are included.
 */
function periodFilter(period: LeaderboardPeriod): string {
  switch (period) {
    case 'month':
      return "AND r.last_updated >= NOW() - INTERVAL '30 days'";
    case 'week':
      return "AND r.last_updated >= NOW() - INTERVAL '7 days'";
    case 'all_time':
    default:
      return '';
  }
}

/**
 * The rating expression used for ranking. For heads_up, it's Elo.
 * For multiplayer, we use the display rating (mu * 48) so that rankings
 * are on the same scale.
 */
function ratingExpr(mode: RankedMode): string {
  return mode === 'heads_up' ? 'r.elo' : '(r.mu * 48)';
}

/**
 * Fetch a page of leaderboard entries for the given mode and period.
 * Returns null if the DB is unavailable.
 */
export async function getLeaderboard(
  mode: RankedMode,
  period: LeaderboardPeriod,
  limit: number,
  offset: number,
  currentUserId?: string,
  playerFilter: LeaderboardPlayerFilter = 'all',
): Promise<LeaderboardResponse | null> {
  const cacheKey = `lb:${mode}:${period}:${limit}:${offset}:${playerFilter}`;
  const cached = getCached<LeaderboardResponse>(cacheKey);
  if (cached) {
    // Cache stores entries without currentUser — if the caller is logged in,
    // fetch only their rank (1 query) instead of re-fetching the full board.
    if (!currentUserId) return cached;
    const currentUser = await getUserRank(mode, period, currentUserId);
    return { ...cached, currentUser };
  }

  const rating = ratingExpr(mode);
  const periodWhere = periodFilter(period);
  const playerTypeWhere = playerTypeFilter(playerFilter);

  // Fetch ranked entries with ROW_NUMBER()
  const entriesResult = await query<LeaderboardRow>(
    `SELECT
       u.id AS user_id,
       u.username,
       COALESCE(u.display_name, u.username) AS display_name,
       u.avatar,
       u.is_bot,
       ${rating} AS rating,
       r.games_played,
       ROW_NUMBER() OVER (ORDER BY ${rating} DESC, r.games_played DESC) AS rank
     FROM ratings r
     JOIN users u ON u.id = r.user_id
     WHERE r.mode = $1
       AND r.games_played >= ${MIN_GAMES}
       ${periodWhere}
       ${playerTypeWhere}
     ORDER BY ${rating} DESC, r.games_played DESC
     LIMIT $2 OFFSET $3`,
    [mode, limit, offset],
  );

  if (!entriesResult) return null;

  // Total count of qualifying players
  const countResult = await query<CountRow>(
    `SELECT COUNT(*) AS total
     FROM ratings r
     JOIN users u ON u.id = r.user_id
     WHERE r.mode = $1
       AND r.games_played >= ${MIN_GAMES}
       ${periodWhere}
       ${playerTypeWhere}`,
    [mode],
  );

  const totalCount = countResult ? parseInt(countResult.rows[0]?.total ?? '0', 10) : 0;

  const entries: LeaderboardEntry[] = entriesResult.rows.map(row => {
    const ratingNum = Math.round(parseFloat(row.rating));
    return {
      // ROW_NUMBER() is computed over the full result set before LIMIT/OFFSET,
      // so it already reflects the global rank — no offset adjustment needed.
      rank: parseInt(row.rank, 10),
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatar: row.avatar as LeaderboardEntry['avatar'],
      rating: ratingNum,
      gamesPlayed: parseInt(row.games_played, 10),
      tier: getRankTier(ratingNum),
      isBot: row.is_bot,
    };
  });

  // Fetch current user's rank if logged in
  let currentUser: LeaderboardEntry | null = null;
  if (currentUserId) {
    currentUser = await getUserRank(mode, period, currentUserId);
  }

  const response: LeaderboardResponse = {
    mode,
    period,
    entries,
    totalCount,
    currentUser,
  };

  // Cache the response (without currentUser for reuse)
  const cacheResponse = { ...response, currentUser: null };
  setCache(cacheKey, cacheResponse);

  return response;
}

/**
 * Get a specific user's rank on the leaderboard. Returns null if the user
 * doesn't qualify (not enough games) or DB is unavailable.
 */
async function getUserRank(
  mode: RankedMode,
  period: LeaderboardPeriod,
  userId: string,
): Promise<LeaderboardEntry | null> {
  const rating = ratingExpr(mode);
  const periodWhere = periodFilter(period);

  // Exclude orphaned/invalid bot rows from rank calculation
  const botFilter = `AND (u.is_bot = false OR u.bot_profile ~ ${VALID_BOT_PROFILE_PATTERN})`;

  // First check if the user qualifies
  const userResult = await query<LeaderboardRow>(
    `SELECT
       u.id AS user_id,
       u.username,
       COALESCE(u.display_name, u.username) AS display_name,
       u.avatar,
       ${rating} AS rating,
       r.games_played,
       (SELECT COUNT(*) + 1
        FROM ratings r2
        JOIN users u2 ON u2.id = r2.user_id
        WHERE r2.mode = $1
          AND r2.games_played >= ${MIN_GAMES}
          ${periodWhere}
          AND (u2.is_bot = false OR u2.bot_profile ~ ${VALID_BOT_PROFILE_PATTERN})
          AND (${rating.replace(/r\./g, 'r2.')} > ${rating}
               OR (${rating.replace(/r\./g, 'r2.')} = ${rating} AND r2.games_played > r.games_played))
       ) AS rank
     FROM ratings r
     JOIN users u ON u.id = r.user_id
     WHERE r.user_id = $2
       AND r.mode = $1
       AND r.games_played >= ${MIN_GAMES}
       ${botFilter}
       ${periodWhere}`,
    [mode, userId],
  );

  if (!userResult || userResult.rows.length === 0) return null;

  const row = userResult.rows[0]!;
  const ratingNum = Math.round(parseFloat(row.rating));

  return {
    rank: parseInt(row.rank, 10),
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar as LeaderboardEntry['avatar'],
    rating: ratingNum,
    gamesPlayed: parseInt(row.games_played, 10),
    tier: getRankTier(ratingNum),
  };
}

/**
 * Fetch ±5 players around the current user on the leaderboard.
 * Returns null if the user doesn't qualify or DB is unavailable.
 */
export async function getLeaderboardNearby(
  mode: RankedMode,
  userId: string,
): Promise<LeaderboardNearbyResponse | null> {
  const cacheKey = `lb-nearby:${mode}:${userId}`;
  const cached = getCached<LeaderboardNearbyResponse>(cacheKey);
  if (cached) return cached;

  // First, get the user's rank
  const currentUser = await getUserRank(mode, 'all_time', userId);
  if (!currentUser) return null;

  const rating = ratingExpr(mode);

  // Fetch players around the user's rating (±5 positions)
  const userRank = currentUser.rank;
  const offset = Math.max(0, userRank - 6); // 5 above + user = offset at rank-6
  const limit = 11; // 5 above + user + 5 below

  // Exclude orphaned/invalid bot rows (same filter as 'all' mode in main leaderboard)
  const botFilter = `AND (u.is_bot = false OR u.bot_profile ~ ${VALID_BOT_PROFILE_PATTERN})`;

  const result = await query<LeaderboardRow>(
    `SELECT
       u.id AS user_id,
       u.username,
       COALESCE(u.display_name, u.username) AS display_name,
       u.avatar,
       ${rating} AS rating,
       r.games_played,
       ROW_NUMBER() OVER (ORDER BY ${rating} DESC, r.games_played DESC) AS rank
     FROM ratings r
     JOIN users u ON u.id = r.user_id
     WHERE r.mode = $1
       AND r.games_played >= ${MIN_GAMES}
       ${botFilter}
     ORDER BY ${rating} DESC, r.games_played DESC
     LIMIT $2 OFFSET $3`,
    [mode, limit, offset],
  );

  if (!result) return null;

  const entries: LeaderboardEntry[] = result.rows.map(row => {
    const ratingNum = Math.round(parseFloat(row.rating));
    return {
      rank: parseInt(row.rank, 10),
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatar: row.avatar as LeaderboardEntry['avatar'],
      rating: ratingNum,
      gamesPlayed: parseInt(row.games_played, 10),
      tier: getRankTier(ratingNum),
    };
  });

  const response: LeaderboardNearbyResponse = {
    mode,
    entries,
    currentUser,
  };

  setCache(cacheKey, response);
  return response;
}
