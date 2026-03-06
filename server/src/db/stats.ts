import { query } from './index.js';
import logger from '../logger.js';
import type { PlayerStatsResponse, GameHistoryEntry, PlayerGameStats, GameSettings } from '@bull-em/shared';

/** Row shape returned by the aggregation query. */
interface StatsAggRow {
  games_played: string;
  games_won: string;
  avg_finish: string | null;
  total_bulls_called: string;
  total_correct_bulls: string;
  total_trues_called: string;
  total_correct_trues: string;
  total_calls_made: string;
  total_bluffs_successful: string;
}

/** Row shape for games-by-player-count breakdown. */
interface PlayerCountRow {
  player_count: string;
  count: string;
}

/** Row shape for recent game history. */
interface RecentGameRow {
  id: string;
  room_code: string;
  winner_name: string;
  player_count: string;
  settings: GameSettings;
  started_at: string;
  ended_at: string;
  duration_seconds: string;
  finish_position: string;
  player_name: string;
  final_card_count: string;
  stats: PlayerGameStats;
}

/**
 * Fetch aggregated player statistics for a given user.
 * Returns null if the database is unavailable.
 */
export async function getPlayerStats(userId: string): Promise<PlayerStatsResponse | null> {
  // Aggregated stats
  const statsResult = await query<StatsAggRow>(
    `SELECT
      COUNT(*)::text AS games_played,
      COUNT(*) FILTER (WHERE gp.finish_position = 1)::text AS games_won,
      CASE WHEN COUNT(*) > 0
        THEN AVG(gp.finish_position)::text
        ELSE NULL
      END AS avg_finish,
      COALESCE(SUM((gp.stats->>'bullsCalled')::int), 0)::text AS total_bulls_called,
      COALESCE(SUM((gp.stats->>'correctBulls')::int), 0)::text AS total_correct_bulls,
      COALESCE(SUM((gp.stats->>'truesCalled')::int), 0)::text AS total_trues_called,
      COALESCE(SUM((gp.stats->>'correctTrues')::int), 0)::text AS total_correct_trues,
      COALESCE(SUM((gp.stats->>'callsMade')::int), 0)::text AS total_calls_made,
      COALESCE(SUM((gp.stats->>'bluffsSuccessful')::int), 0)::text AS total_bluffs_successful
    FROM game_players gp
    WHERE gp.user_id = $1`,
    [userId],
  );

  if (!statsResult) return null;

  const row = statsResult.rows[0];
  if (!row) return null;

  const gamesPlayed = parseInt(row.games_played, 10);
  const wins = parseInt(row.games_won, 10);
  const bullsCalled = parseInt(row.total_bulls_called, 10);
  const correctBulls = parseInt(row.total_correct_bulls, 10);
  const truesCalled = parseInt(row.total_trues_called, 10);
  const correctTrues = parseInt(row.total_correct_trues, 10);
  const callsMade = parseInt(row.total_calls_made, 10);
  const bluffsSuccessful = parseInt(row.total_bluffs_successful, 10);

  // Games by player count breakdown
  const playerCountResult = await query<PlayerCountRow>(
    `SELECT g.player_count::text, COUNT(*)::text AS count
     FROM game_players gp
     JOIN games g ON g.id = gp.game_id
     WHERE gp.user_id = $1
     GROUP BY g.player_count
     ORDER BY g.player_count`,
    [userId],
  );

  const gamesByPlayerCount: Record<string, number> = {};
  if (playerCountResult) {
    for (const pcRow of playerCountResult.rows) {
      gamesByPlayerCount[pcRow.player_count] = parseInt(pcRow.count, 10);
    }
  }

  // Recent game history (last 20)
  const recentResult = await query<RecentGameRow>(
    `SELECT
      g.id,
      g.room_code,
      g.winner_name,
      g.player_count::text,
      g.settings,
      g.started_at,
      g.ended_at,
      g.duration_seconds::text,
      gp.finish_position::text,
      gp.player_name,
      gp.final_card_count::text,
      gp.stats
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    WHERE gp.user_id = $1
    ORDER BY g.ended_at DESC
    LIMIT 20`,
    [userId],
  );

  const recentGames: GameHistoryEntry[] = recentResult
    ? recentResult.rows.map((r: RecentGameRow) => ({
        id: r.id,
        roomCode: r.room_code,
        winnerName: r.winner_name,
        playerCount: parseInt(r.player_count, 10),
        settings: r.settings,
        startedAt: r.started_at,
        endedAt: r.ended_at,
        durationSeconds: parseInt(r.duration_seconds, 10),
        finishPosition: parseInt(r.finish_position, 10),
        playerName: r.player_name,
        finalCardCount: parseInt(r.final_card_count, 10),
        stats: r.stats,
      }))
    : [];

  const avgFinish = row.avg_finish !== null ? parseFloat(parseFloat(row.avg_finish).toFixed(1)) : null;

  return {
    userId,
    gamesPlayed,
    wins,
    winRate: gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : null,
    avgFinishPosition: avgFinish,
    bullAccuracy: bullsCalled > 0 ? Math.round((correctBulls / bullsCalled) * 100) : null,
    trueAccuracy: truesCalled > 0 ? Math.round((correctTrues / truesCalled) * 100) : null,
    bluffSuccessRate: callsMade > 0 ? Math.round((bluffsSuccessful / callsMade) * 100) : null,
    gamesByPlayerCount,
    recentGames,
  };
}
