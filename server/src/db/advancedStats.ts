import { query } from './index.js';
import logger from '../logger.js';
import type {
  AdvancedStatsResponse,
  HandTypeBreakdown,
  HandTypeBreakdownEntry,
  RatingHistoryEntry,
  PerformanceByPlayerCount,
  TodaySession,
  OpponentRecord,
  AvatarId,
} from '@bull-em/shared';

// ── Row types ───────────────────────────────────────────────────────────

interface HandBreakdownRow {
  stats: { handBreakdown?: HandTypeBreakdownEntry[] } | null;
}

interface RatingHistoryRow {
  game_id: string;
  mode: string;
  rating_before: string;
  rating_after: string;
  created_at: string;
}

interface PerformanceRow {
  player_count: string;
  games_played: string;
  wins: string;
  avg_finish: string;
}

interface TodayRow {
  games_played: string;
  wins: string;
  total_bulls_called: string;
  total_correct_bulls: string;
}

interface TodayRatingRow {
  net_change: string;
}

interface OpponentRow {
  opponent_id: string;
  opponent_name: string;
  opponent_avatar: string | null;
  games_played: string;
  wins: string;
}

// ── Main query ──────────────────────────────────────────────────────────

/**
 * Fetch advanced statistics for a user. Returns null if the database
 * is unavailable. All sub-queries handle empty results gracefully.
 */
export async function getAdvancedStats(userId: string): Promise<AdvancedStatsResponse | null> {
  try {
    const [handBreakdown, ratingHistory, performance, todaySession, opponents] = await Promise.all([
      getHandBreakdown(userId),
      getRatingHistory(userId),
      getPerformanceByPlayerCount(userId),
      getTodaySession(userId),
      getOpponentRecords(userId),
    ]);

    if (handBreakdown === null) return null; // DB unavailable

    return {
      userId,
      handBreakdown: handBreakdown ?? [],
      ratingHistory: ratingHistory ?? [],
      performanceByPlayerCount: performance ?? [],
      todaySession,
      opponentRecords: opponents ?? [],
    };
  } catch (err) {
    logger.error({ err, userId }, 'Failed to fetch advanced stats');
    return null;
  }
}

// ── Hand type breakdown ─────────────────────────────────────────────────

/**
 * Aggregate per-hand-type breakdown from the JSONB handBreakdown array
 * stored in game_players.stats. Old rows missing this field are skipped
 * gracefully (the COALESCE + jsonb_array_elements pattern returns nothing
 * for NULL or missing arrays).
 */
async function getHandBreakdown(userId: string): Promise<HandTypeBreakdown[] | null> {
  // Read all game_players rows and aggregate handBreakdown in JS.
  // This is more reliable than complex JSONB queries for optional nested arrays.
  const result = await query<HandBreakdownRow>(
    `SELECT stats FROM game_players WHERE user_id = $1`,
    [userId],
  );

  if (!result) return null;

  const breakdown = new Map<number, HandTypeBreakdown>();

  for (const row of result.rows) {
    const entries = row.stats?.handBreakdown;
    if (!entries || !Array.isArray(entries)) continue;

    for (const entry of entries) {
      const existing = breakdown.get(entry.handType);
      if (existing) {
        existing.timesCalled += entry.called ?? 0;
        existing.timesExisted += entry.existed ?? 0;
      } else {
        breakdown.set(entry.handType, {
          handType: entry.handType,
          timesCalled: entry.called ?? 0,
          timesExisted: entry.existed ?? 0,
          bullsAgainstCorrect: 0,
          bullsAgainstTotal: 0,
        });
      }
    }
  }

  return [...breakdown.values()].sort((a, b) => a.handType - b.handType);
}

// ── Rating history ──────────────────────────────────────────────────────

async function getRatingHistory(userId: string): Promise<RatingHistoryEntry[] | null> {
  const result = await query<RatingHistoryRow>(
    `SELECT game_id, mode, rating_before::text, rating_after::text, created_at
     FROM rating_history
     WHERE user_id = $1
     ORDER BY created_at ASC
     LIMIT 50`,
    [userId],
  );

  if (!result) return null;

  return result.rows.map((row: RatingHistoryRow) => ({
    gameId: row.game_id,
    mode: row.mode as 'heads_up' | 'multiplayer',
    ratingBefore: parseFloat(row.rating_before),
    ratingAfter: parseFloat(row.rating_after),
    delta: parseFloat(row.rating_after) - parseFloat(row.rating_before),
    createdAt: row.created_at,
  }));
}

// ── Performance by player count ─────────────────────────────────────────

async function getPerformanceByPlayerCount(userId: string): Promise<PerformanceByPlayerCount[] | null> {
  const result = await query<PerformanceRow>(
    `SELECT
       g.player_count::text,
       COUNT(*)::text AS games_played,
       COUNT(*) FILTER (WHERE gp.finish_position = 1)::text AS wins,
       AVG(gp.finish_position)::text AS avg_finish
     FROM game_players gp
     JOIN games g ON g.id = gp.game_id
     WHERE gp.user_id = $1
     GROUP BY g.player_count
     ORDER BY g.player_count`,
    [userId],
  );

  if (!result) return null;

  return result.rows.map((row: PerformanceRow) => {
    const gamesPlayed = parseInt(row.games_played, 10);
    const wins = parseInt(row.wins, 10);
    return {
      playerCount: parseInt(row.player_count, 10),
      gamesPlayed,
      wins,
      winRate: gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0,
      avgFinish: parseFloat(parseFloat(row.avg_finish).toFixed(1)),
    };
  });
}

// ── Today's session ─────────────────────────────────────────────────────

async function getTodaySession(userId: string): Promise<TodaySession | null> {
  const result = await query<TodayRow>(
    `SELECT
       COUNT(*)::text AS games_played,
       COUNT(*) FILTER (WHERE gp.finish_position = 1)::text AS wins,
       COALESCE(SUM((gp.stats->>'bullsCalled')::int), 0)::text AS total_bulls_called,
       COALESCE(SUM((gp.stats->>'correctBulls')::int), 0)::text AS total_correct_bulls
     FROM game_players gp
     JOIN games g ON g.id = gp.game_id
     WHERE gp.user_id = $1
       AND g.ended_at >= CURRENT_DATE`,
    [userId],
  );

  if (!result || result.rows.length === 0) return null;

  const row = result.rows[0]!;
  const gamesPlayed = parseInt(row.games_played, 10);
  if (gamesPlayed === 0) return null;

  const bullsCalled = parseInt(row.total_bulls_called, 10);
  const correctBulls = parseInt(row.total_correct_bulls, 10);

  // Net rating change for today
  const ratingResult = await query<TodayRatingRow>(
    `SELECT COALESCE(SUM(rating_after - rating_before), 0)::text AS net_change
     FROM rating_history
     WHERE user_id = $1
       AND created_at >= CURRENT_DATE`,
    [userId],
  );

  const netRatingChange = ratingResult?.rows[0]
    ? parseFloat(ratingResult.rows[0].net_change)
    : 0;

  return {
    gamesPlayed,
    wins: parseInt(row.wins, 10),
    netRatingChange: Math.round(netRatingChange),
    bullAccuracy: bullsCalled > 0 ? Math.round((correctBulls / bullsCalled) * 100) : null,
  };
}

// ── Opponent records ────────────────────────────────────────────────────

async function getOpponentRecords(userId: string): Promise<OpponentRecord[] | null> {
  // Find top 10 most-played opponents with W-L records.
  // A "game together" is when both the user and the opponent are in game_players
  // for the same game_id. A "win" is when the user finished in position 1.
  const result = await query<OpponentRow>(
    `SELECT
       opp.user_id AS opponent_id,
       MAX(opp.player_name) AS opponent_name,
       MAX(u.avatar) AS opponent_avatar,
       COUNT(*)::text AS games_played,
       COUNT(*) FILTER (WHERE me.finish_position = 1)::text AS wins
     FROM game_players me
     JOIN game_players opp ON opp.game_id = me.game_id AND opp.user_id != me.user_id
     JOIN users u ON u.id = opp.user_id
     WHERE me.user_id = $1
       AND opp.user_id IS NOT NULL
     GROUP BY opp.user_id
     ORDER BY COUNT(*) DESC, COUNT(*) FILTER (WHERE me.finish_position = 1) DESC
     LIMIT 10`,
    [userId],
  );

  if (!result) return null;

  return result.rows.map((row: OpponentRow) => {
    const gamesPlayed = parseInt(row.games_played, 10);
    const wins = parseInt(row.wins, 10);
    return {
      opponentId: row.opponent_id,
      opponentName: row.opponent_name,
      opponentAvatar: row.opponent_avatar as AvatarId | null,
      gamesPlayed,
      wins,
      losses: gamesPlayed - wins,
    };
  });
}
