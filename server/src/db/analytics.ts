import { query } from './index.js';
import logger from '../logger.js';

// ── Row types ───────────────────────────────────────────────────────────

interface StartingPositionRow {
  player_count: string;
  starting_index: string;
  games_played: string;
  wins: string;
}

interface HandFrequencyRow {
  hand_type: string;
  player_count: string;
  times_called: string;
  times_existed: string;
  times_bluffed: string;
  bluffs_caught: string;
}

interface GameDurationRow {
  player_count: string;
  games_played: string;
  avg_seconds: string;
  min_seconds: string;
  max_seconds: string;
}

interface BotPerformanceRow {
  bot_level: string;
  player_count: string;
  games_played: string;
  wins: string;
  avg_finish: string | null;
}

interface BalanceSnapshotRow {
  id: string;
  computed_at: string;
  total_games: string;
  total_rounds: string;
  avg_rounds_per_game: string | null;
  avg_game_duration_s: string | null;
  bull_accuracy_pct: string | null;
  bluff_success_pct: string | null;
  properties: Record<string, unknown>;
}

// ── Response types ──────────────────────────────────────────────────────

export interface StartingPositionStats {
  playerCount: number;
  startingIndex: number;
  gamesPlayed: number;
  wins: number;
  winRate: number;
}

export interface HandFrequencyStats {
  handType: number;
  playerCount: number;
  timesCalled: number;
  timesExisted: number;
  timesBluffed: number;
  bluffsCaught: number;
  /** Bluff success rate: bluffs that weren't caught / total bluffs. */
  bluffSuccessRate: number | null;
}

export interface GameDurationStats {
  playerCount: number;
  gamesPlayed: number;
  avgSeconds: number;
  minSeconds: number | null;
  maxSeconds: number | null;
}

export interface BotPerformanceStats {
  botLevel: string;
  playerCount: number;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  avgFinish: number | null;
}

export interface BalanceSnapshot {
  id: string;
  computedAt: string;
  totalGames: number;
  totalRounds: number;
  avgRoundsPerGame: number | null;
  avgGameDurationS: number | null;
  bullAccuracyPct: number | null;
  bluffSuccessPct: number | null;
  properties: Record<string, unknown>;
}

export interface AnalyticsDashboard {
  startingPosition: StartingPositionStats[];
  handFrequency: HandFrequencyStats[];
  gameDuration: GameDurationStats[];
  botPerformance: BotPerformanceStats[];
  latestSnapshot: BalanceSnapshot | null;
}

// ── Queries ─────────────────────────────────────────────────────────────

/** Fetch win rate by starting position from the aggregation table. */
export async function getStartingPositionStats(): Promise<StartingPositionStats[] | null> {
  const result = await query<StartingPositionRow>(
    `SELECT player_count::text, starting_index::text, games_played::text, wins::text
     FROM analytics_starting_position
     ORDER BY player_count, starting_index`,
  );

  if (!result) return null;

  return result.rows.map(row => {
    const gamesPlayed = parseInt(row.games_played, 10);
    const wins = parseInt(row.wins, 10);
    return {
      playerCount: parseInt(row.player_count, 10),
      startingIndex: parseInt(row.starting_index, 10),
      gamesPlayed,
      wins,
      winRate: gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0,
    };
  });
}

/** Fetch hand type call frequency vs actual occurrence. */
export async function getHandFrequencyStats(): Promise<HandFrequencyStats[] | null> {
  const result = await query<HandFrequencyRow>(
    `SELECT hand_type::text, player_count::text, times_called::text,
            times_existed::text, times_bluffed::text, bluffs_caught::text
     FROM analytics_hand_frequency
     ORDER BY player_count, hand_type`,
  );

  if (!result) return null;

  return result.rows.map(row => {
    const timesBluffed = parseInt(row.times_bluffed, 10);
    const bluffsCaught = parseInt(row.bluffs_caught, 10);
    return {
      handType: parseInt(row.hand_type, 10),
      playerCount: parseInt(row.player_count, 10),
      timesCalled: parseInt(row.times_called, 10),
      timesExisted: parseInt(row.times_existed, 10),
      timesBluffed,
      bluffsCaught,
      bluffSuccessRate: timesBluffed > 0
        ? Math.round(((timesBluffed - bluffsCaught) / timesBluffed) * 100)
        : null,
    };
  });
}

/** Fetch average game duration grouped by player count. */
export async function getGameDurationStats(): Promise<GameDurationStats[] | null> {
  const result = await query<GameDurationRow>(
    `SELECT player_count::text, games_played::text,
            CASE WHEN games_played > 0
              THEN (total_seconds::float / games_played)::text
              ELSE '0'
            END AS avg_seconds,
            min_seconds::text, max_seconds::text
     FROM analytics_game_duration
     ORDER BY player_count`,
  );

  if (!result) return null;

  return result.rows.map(row => ({
    playerCount: parseInt(row.player_count, 10),
    gamesPlayed: parseInt(row.games_played, 10),
    avgSeconds: Math.round(parseFloat(row.avg_seconds)),
    minSeconds: row.min_seconds ? parseInt(row.min_seconds, 10) : null,
    maxSeconds: row.max_seconds ? parseInt(row.max_seconds, 10) : null,
  }));
}

/** Fetch bot difficulty win rates. */
export async function getBotPerformanceStats(): Promise<BotPerformanceStats[] | null> {
  const result = await query<BotPerformanceRow>(
    `SELECT bot_level, player_count::text, games_played::text, wins::text,
            avg_finish::text
     FROM analytics_bot_performance
     ORDER BY bot_level, player_count`,
  );

  if (!result) return null;

  return result.rows.map(row => {
    const gamesPlayed = parseInt(row.games_played, 10);
    const wins = parseInt(row.wins, 10);
    return {
      botLevel: row.bot_level,
      playerCount: parseInt(row.player_count, 10),
      gamesPlayed,
      wins,
      winRate: gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0,
      avgFinish: row.avg_finish ? parseFloat(parseFloat(row.avg_finish).toFixed(1)) : null,
    };
  });
}

/** Fetch the most recent balance snapshot. */
export async function getLatestBalanceSnapshot(): Promise<BalanceSnapshot | null> {
  const result = await query<BalanceSnapshotRow>(
    `SELECT id, computed_at, total_games::text, total_rounds::text,
            avg_rounds_per_game::text, avg_game_duration_s::text,
            bull_accuracy_pct::text, bluff_success_pct::text, properties
     FROM analytics_balance_snapshot
     ORDER BY computed_at DESC
     LIMIT 1`,
  );

  if (!result || result.rows.length === 0) return null;

  const row = result.rows[0]!;
  return {
    id: row.id,
    computedAt: row.computed_at,
    totalGames: parseInt(row.total_games, 10),
    totalRounds: parseInt(row.total_rounds, 10),
    avgRoundsPerGame: row.avg_rounds_per_game ? parseFloat(row.avg_rounds_per_game) : null,
    avgGameDurationS: row.avg_game_duration_s ? parseFloat(row.avg_game_duration_s) : null,
    bullAccuracyPct: row.bull_accuracy_pct ? parseFloat(row.bull_accuracy_pct) : null,
    bluffSuccessPct: row.bluff_success_pct ? parseFloat(row.bluff_success_pct) : null,
    properties: row.properties,
  };
}

/** Fetch all analytics data for the admin dashboard. */
export async function getAnalyticsDashboard(): Promise<AnalyticsDashboard | null> {
  try {
    const [startingPosition, handFrequency, gameDuration, botPerformance, latestSnapshot] =
      await Promise.all([
        getStartingPositionStats(),
        getHandFrequencyStats(),
        getGameDurationStats(),
        getBotPerformanceStats(),
        getLatestBalanceSnapshot(),
      ]);

    // If any critical query returns null, DB is unavailable
    if (startingPosition === null) return null;

    return {
      startingPosition: startingPosition ?? [],
      handFrequency: handFrequency ?? [],
      gameDuration: gameDuration ?? [],
      botPerformance: botPerformance ?? [],
      latestSnapshot,
    };
  } catch (err) {
    logger.error({ err }, 'Failed to fetch analytics dashboard');
    return null;
  }
}

// ── Aggregation (refresh) ───────────────────────────────────────────────

/**
 * Refresh all analytics aggregation tables from the source data.
 * This re-computes everything from games, game_players, and events tables.
 * Designed to be called on-demand from the admin panel.
 *
 * Uses UPSERT (INSERT ... ON CONFLICT UPDATE) so it's safe to call repeatedly.
 */
export async function refreshAnalytics(): Promise<{ success: boolean; error?: string }> {
  try {
    // ── 1. Starting position win rates ──────────────────────────────────
    // We track starting position via the game:started_position events.
    // Fallback: derive from game_players + round snapshots if events are sparse.
    await query(
      `INSERT INTO analytics_starting_position (player_count, starting_index, games_played, wins, updated_at)
       SELECT
         e.properties->>'playerCount' AS player_count,
         (e.properties->>'startingIndex')::int AS starting_index,
         COUNT(*)::int AS games_played,
         COUNT(*) FILTER (WHERE (e.properties->>'won')::boolean = true)::int AS wins,
         NOW() AS updated_at
       FROM events e
       WHERE e.event_type = 'game:player_starting_position'
         AND e.properties->>'playerCount' IS NOT NULL
         AND e.properties->>'startingIndex' IS NOT NULL
       GROUP BY e.properties->>'playerCount', (e.properties->>'startingIndex')::int
       ON CONFLICT (player_count, starting_index)
       DO UPDATE SET
         games_played = EXCLUDED.games_played,
         wins = EXCLUDED.wins,
         updated_at = NOW()`,
    );

    // ── 2. Hand frequency stats ─────────────────────────────────────────
    // Aggregate from bull:called and bluff:attempted events
    await query(
      `WITH call_stats AS (
         SELECT
           (e.properties->>'currentHandType')::int AS hand_type,
           (e.properties->>'playerCount')::int AS player_count,
           COUNT(*) AS times_called,
           COUNT(*) FILTER (WHERE (e.properties->>'wasCorrect')::boolean = false) AS times_existed
         FROM events e
         WHERE e.event_type = 'bull:called'
           AND e.properties->>'currentHandType' IS NOT NULL
           AND e.properties->>'playerCount' IS NOT NULL
         GROUP BY (e.properties->>'currentHandType')::int, (e.properties->>'playerCount')::int
       ),
       bluff_stats AS (
         SELECT
           (e.properties->>'handType')::int AS hand_type,
           (e.properties->>'playerCount')::int AS player_count,
           COUNT(*) AS times_bluffed,
           COUNT(*) FILTER (WHERE (e.properties->>'wasCaught')::boolean = true) AS bluffs_caught
         FROM events e
         WHERE e.event_type = 'bluff:attempted'
           AND e.properties->>'handType' IS NOT NULL
           AND e.properties->>'playerCount' IS NOT NULL
         GROUP BY (e.properties->>'handType')::int, (e.properties->>'playerCount')::int
       )
       INSERT INTO analytics_hand_frequency
         (hand_type, player_count, times_called, times_existed, times_bluffed, bluffs_caught, updated_at)
       SELECT
         COALESCE(c.hand_type, b.hand_type) AS hand_type,
         COALESCE(c.player_count, b.player_count) AS player_count,
         COALESCE(c.times_called, 0)::int,
         COALESCE(c.times_existed, 0)::int,
         COALESCE(b.times_bluffed, 0)::int,
         COALESCE(b.bluffs_caught, 0)::int,
         NOW()
       FROM call_stats c
       FULL OUTER JOIN bluff_stats b ON c.hand_type = b.hand_type AND c.player_count = b.player_count
       ON CONFLICT (hand_type, player_count)
       DO UPDATE SET
         times_called = EXCLUDED.times_called,
         times_existed = EXCLUDED.times_existed,
         times_bluffed = EXCLUDED.times_bluffed,
         bluffs_caught = EXCLUDED.bluffs_caught,
         updated_at = NOW()`,
    );

    // ── 3. Game duration stats ──────────────────────────────────────────
    await query(
      `INSERT INTO analytics_game_duration
         (player_count, games_played, total_seconds, min_seconds, max_seconds, updated_at)
       SELECT
         player_count,
         COUNT(*)::int,
         COALESCE(SUM(duration_seconds), 0)::bigint,
         MIN(duration_seconds)::int,
         MAX(duration_seconds)::int,
         NOW()
       FROM games
       WHERE duration_seconds IS NOT NULL
       GROUP BY player_count
       ON CONFLICT (player_count)
       DO UPDATE SET
         games_played = EXCLUDED.games_played,
         total_seconds = EXCLUDED.total_seconds,
         min_seconds = EXCLUDED.min_seconds,
         max_seconds = EXCLUDED.max_seconds,
         updated_at = NOW()`,
    );

    // ── 4. Bot performance stats ────────────────────────────────────────
    // Bot users have is_bot = true. Join game_players → users to find bots.
    // Bot level is stored in settings JSONB on the games table.
    await query(
      `INSERT INTO analytics_bot_performance
         (bot_level, player_count, games_played, wins, avg_finish, updated_at)
       SELECT
         COALESCE(g.settings->>'botLevelCategory', 'normal') AS bot_level,
         g.player_count,
         COUNT(*)::int AS games_played,
         COUNT(*) FILTER (WHERE gp.finish_position = 1)::int AS wins,
         AVG(gp.finish_position) AS avg_finish,
         NOW()
       FROM game_players gp
       JOIN games g ON g.id = gp.game_id
       JOIN users u ON u.id = gp.user_id AND u.is_bot = true
       GROUP BY COALESCE(g.settings->>'botLevelCategory', 'normal'), g.player_count
       ON CONFLICT (bot_level, player_count)
       DO UPDATE SET
         games_played = EXCLUDED.games_played,
         wins = EXCLUDED.wins,
         avg_finish = EXCLUDED.avg_finish,
         updated_at = NOW()`,
    );

    // ── 5. Balance snapshot ─────────────────────────────────────────────
    await query(
      `INSERT INTO analytics_balance_snapshot
         (total_games, total_rounds, avg_rounds_per_game, avg_game_duration_s,
          bull_accuracy_pct, bluff_success_pct, properties)
       SELECT
         game_counts.total_games,
         COALESCE(round_counts.total_rounds, 0),
         CASE WHEN game_counts.total_games > 0
           THEN round_counts.total_rounds::float / game_counts.total_games
           ELSE NULL
         END,
         game_counts.avg_duration,
         bull_stats.accuracy,
         bluff_stats.success_rate,
         '{}'::jsonb
       FROM
         (SELECT COUNT(*)::int AS total_games,
                 AVG(duration_seconds)::float AS avg_duration
          FROM games) game_counts,
         (SELECT COUNT(*)::int AS total_rounds
          FROM rounds) round_counts,
         (SELECT CASE WHEN COUNT(*) > 0
            THEN (COUNT(*) FILTER (WHERE (properties->>'wasCorrect')::boolean = true)::float
                  / COUNT(*)::float * 100)
            ELSE NULL
          END AS accuracy
          FROM events WHERE event_type = 'bull:called') bull_stats,
         (SELECT CASE WHEN COUNT(*) > 0
            THEN (COUNT(*) FILTER (WHERE (properties->>'wasCaught')::boolean = false)::float
                  / COUNT(*)::float * 100)
            ELSE NULL
          END AS success_rate
          FROM events WHERE event_type = 'bluff:attempted') bluff_stats`,
    );

    logger.info('Analytics aggregation tables refreshed');
    return { success: true };
  } catch (err) {
    logger.error({ err }, 'Failed to refresh analytics aggregation tables');
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
}
