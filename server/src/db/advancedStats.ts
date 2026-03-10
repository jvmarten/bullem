import { readQuery } from './index.js';
import logger from '../logger.js';
import type {
  AdvancedStatsResponse,
  HandTypeBreakdown,
  HandTypeBreakdownEntry,
  RatingHistoryEntry,
  PerformanceByPlayerCount,
  TodaySession,
  OpponentRecord,
  BluffHeatMapEntry,
  WinProbabilityEntry,
  RivalryRecord,
  CareerTrajectoryPoint,
  AvatarId,
  PlayerId,
  ServerPlayer,
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
  opponent_username: string;
  opponent_avatar: string | null;
  opponent_photo_url: string | null;
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
    const [
      handBreakdown, ratingHistory, performance, todaySession, opponents,
      bluffHeatMap, winProbability, rivalries, careerTrajectory,
    ] = await Promise.all([
      getHandBreakdown(userId),
      getRatingHistory(userId),
      getPerformanceByPlayerCount(userId),
      getTodaySession(userId),
      getOpponentRecords(userId),
      getBluffHeatMap(userId),
      getWinProbabilityTimeline(userId),
      getRivalryRecords(userId),
      getCareerTrajectory(userId),
    ]);

    if (handBreakdown === null) return null; // DB unavailable

    return {
      userId,
      handBreakdown: handBreakdown ?? [],
      ratingHistory: ratingHistory ?? [],
      performanceByPlayerCount: performance ?? [],
      todaySession,
      opponentRecords: opponents ?? [],
      bluffHeatMap: bluffHeatMap ?? [],
      winProbabilityTimeline: winProbability ?? [],
      rivalries: rivalries ?? [],
      careerTrajectory: careerTrajectory ?? [],
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
  const result = await readQuery<HandBreakdownRow>(
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
  const result = await readQuery<RatingHistoryRow>(
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
  const result = await readQuery<PerformanceRow>(
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
  const result = await readQuery<TodayRow>(
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
  const ratingResult = await readQuery<TodayRatingRow>(
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
  const result = await readQuery<OpponentRow>(
    `SELECT
       opp.user_id AS opponent_id,
       MAX(opp.player_name) AS opponent_name,
       MAX(u.username) AS opponent_username,
       MAX(u.avatar) AS opponent_avatar,
       MAX(u.photo_url) AS opponent_photo_url,
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
      opponentUsername: row.opponent_username,
      opponentAvatar: row.opponent_avatar as AvatarId | null,
      opponentPhotoUrl: row.opponent_photo_url,
      gamesPlayed,
      wins,
      losses: gamesPlayed - wins,
    };
  });
}

// ── Bluff heat map ────────────────────────────────────────────────────

interface BluffEventRow {
  round_number: string;
  event_type: string;
  was_correct: string | null;
  was_caught: string | null;
}

/**
 * Aggregate bluff and bull events by round number to build a heat map
 * showing when during a game the player bluffs most.
 */
async function getBluffHeatMap(userId: string): Promise<BluffHeatMapEntry[] | null> {
  const result = await readQuery<BluffEventRow>(
    `SELECT
       (properties->>'roundNumber')::text AS round_number,
       event_type,
       properties->>'wasCorrect' AS was_correct,
       properties->>'wasCaught' AS was_caught
     FROM events
     WHERE user_id = $1
       AND event_type IN ('bull:called', 'bluff:attempted')
       AND properties->>'roundNumber' IS NOT NULL`,
    [userId],
  );

  if (!result) return null;

  const buckets = new Map<number, BluffHeatMapEntry>();

  for (const row of result.rows) {
    const roundNum = parseInt(row.round_number, 10);
    if (isNaN(roundNum) || roundNum < 1) continue;

    let bucket = buckets.get(roundNum);
    if (!bucket) {
      bucket = {
        roundNumber: roundNum,
        bluffsAttempted: 0,
        bluffsCaught: 0,
        totalCalls: 0,
        bullsCalled: 0,
        correctBulls: 0,
      };
      buckets.set(roundNum, bucket);
    }

    if (row.event_type === 'bluff:attempted') {
      bucket.bluffsAttempted++;
      bucket.totalCalls++;
      if (row.was_caught === 'true') bucket.bluffsCaught++;
    } else if (row.event_type === 'bull:called') {
      bucket.bullsCalled++;
      bucket.totalCalls++;
      if (row.was_correct === 'true') bucket.correctBulls++;
    }
  }

  return [...buckets.values()].sort((a, b) => a.roundNumber - b.roundNumber);
}

// ── Win probability timeline ──────────────────────────────────────────

interface RoundSnapshotRow {
  game_id: string;
  round_number: number;
  snapshot: {
    players?: ServerPlayer[];
  };
}

interface GameInfoRow {
  game_id: string;
  finish_position: number;
  ended_at: string;
}

/**
 * Build win probability timelines from round snapshots for the player's
 * most recent games. Each game produces card count progression data.
 */
async function getWinProbabilityTimeline(userId: string): Promise<WinProbabilityEntry[] | null> {
  // Get the player's 10 most recent games with round snapshots
  const gamesResult = await readQuery<GameInfoRow>(
    `SELECT gp.game_id, gp.finish_position, g.ended_at
     FROM game_players gp
     JOIN games g ON g.id = gp.game_id
     WHERE gp.user_id = $1
     ORDER BY g.ended_at DESC
     LIMIT 10`,
    [userId],
  );

  if (!gamesResult || gamesResult.rows.length === 0) return [];

  const gameIds = gamesResult.rows.map(r => r.game_id);
  const gameInfoMap = new Map(gamesResult.rows.map(r => [r.game_id, r]));

  // Fetch round snapshots for these games
  const roundsResult = await readQuery<RoundSnapshotRow>(
    `SELECT game_id, round_number, snapshot
     FROM rounds
     WHERE game_id = ANY($1)
     ORDER BY game_id, round_number`,
    [gameIds],
  );

  if (!roundsResult) return null;

  // We need to figure out which player ID this user was in each game.
  // Look at game_players to get the player_name, then match to snapshot players.
  interface PlayerIdRow { game_id: string; player_name: string }
  const playerIdResult = await readQuery<PlayerIdRow>(
    `SELECT game_id, player_name FROM game_players WHERE user_id = $1 AND game_id = ANY($2)`,
    [userId, gameIds],
  );

  if (!playerIdResult) return null;

  const playerNameByGame = new Map(playerIdResult.rows.map(r => [r.game_id, r.player_name]));

  // Group rounds by game
  const roundsByGame = new Map<string, RoundSnapshotRow[]>();
  for (const row of roundsResult.rows) {
    const arr = roundsByGame.get(row.game_id) ?? [];
    arr.push(row);
    roundsByGame.set(row.game_id, arr);
  }

  const entries: WinProbabilityEntry[] = [];

  for (const gameId of gameIds) {
    const gameInfo = gameInfoMap.get(gameId);
    const rounds = roundsByGame.get(gameId);
    const playerName = playerNameByGame.get(gameId);
    if (!gameInfo || !rounds || rounds.length === 0 || !playerName) continue;

    const snapshots: WinProbabilityEntry['snapshots'] = [];

    for (const round of rounds) {
      const players = round.snapshot?.players;
      if (!players || !Array.isArray(players)) continue;

      // Find the user's player by matching player name
      const alivePlayers = players.filter((p: ServerPlayer) => !p.isEliminated);
      const userPlayer = alivePlayers.find((p: ServerPlayer) => p.name === playerName);
      if (!userPlayer) continue;

      const opponents = alivePlayers.filter((p: ServerPlayer) => p.id !== userPlayer.id);
      const avgOpponentCards = opponents.length > 0
        ? opponents.reduce((sum: number, p: ServerPlayer) => sum + (p.cards?.length ?? 0), 0) / opponents.length
        : 0;

      snapshots.push({
        roundNumber: round.round_number,
        playerCards: userPlayer.cards?.length ?? 0,
        avgOpponentCards: Math.round(avgOpponentCards * 10) / 10,
        playersAlive: alivePlayers.length,
      });
    }

    if (snapshots.length > 0) {
      entries.push({
        gameId,
        playedAt: gameInfo.ended_at,
        won: gameInfo.finish_position === 1,
        snapshots,
      });
    }
  }

  return entries;
}

// ── Rivalry records ───────────────────────────────────────────────────

interface RivalryRow {
  opponent_id: string;
  opponent_name: string;
  opponent_username: string;
  opponent_avatar: string | null;
  opponent_photo_url: string | null;
  games_played: string;
  wins: string;
  avg_duration: string;
}

interface RivalryGameRow {
  game_id: string;
  opponent_id: string;
  my_position: number;
  ended_at: string;
}

/**
 * Get enriched rivalry data for the player's most-played opponents.
 * Includes recent form, streaks, and average game duration.
 */
async function getRivalryRecords(userId: string): Promise<RivalryRecord[] | null> {
  const result = await readQuery<RivalryRow>(
    `SELECT
       opp.user_id AS opponent_id,
       MAX(opp.player_name) AS opponent_name,
       MAX(u.username) AS opponent_username,
       MAX(u.avatar) AS opponent_avatar,
       MAX(u.photo_url) AS opponent_photo_url,
       COUNT(*)::text AS games_played,
       COUNT(*) FILTER (WHERE me.finish_position = 1)::text AS wins,
       AVG(g.duration_seconds)::text AS avg_duration
     FROM game_players me
     JOIN game_players opp ON opp.game_id = me.game_id AND opp.user_id != me.user_id
     JOIN users u ON u.id = opp.user_id
     JOIN games g ON g.id = me.game_id
     WHERE me.user_id = $1
       AND opp.user_id IS NOT NULL
     GROUP BY opp.user_id
     HAVING COUNT(*) >= 3
     ORDER BY COUNT(*) DESC
     LIMIT 5`,
    [userId],
  );

  if (!result || result.rows.length === 0) return [];

  const opponentIds = result.rows.map(r => r.opponent_id);

  // Get recent games against these opponents for form/streak calculation
  const recentResult = await readQuery<RivalryGameRow>(
    `SELECT
       me.game_id,
       opp.user_id AS opponent_id,
       me.finish_position AS my_position,
       g.ended_at
     FROM game_players me
     JOIN game_players opp ON opp.game_id = me.game_id AND opp.user_id != me.user_id
     JOIN games g ON g.id = me.game_id
     WHERE me.user_id = $1
       AND opp.user_id = ANY($2)
     ORDER BY g.ended_at DESC`,
    [userId, opponentIds],
  );

  // Group recent games by opponent
  const recentByOpponent = new Map<string, RivalryGameRow[]>();
  if (recentResult) {
    for (const row of recentResult.rows) {
      const arr = recentByOpponent.get(row.opponent_id) ?? [];
      arr.push(row);
      recentByOpponent.set(row.opponent_id, arr);
    }
  }

  return result.rows.map((row: RivalryRow) => {
    const gamesPlayed = parseInt(row.games_played, 10);
    const wins = parseInt(row.wins, 10);
    const recentGames = recentByOpponent.get(row.opponent_id) ?? [];

    // Recent form: last 10 games, W or L
    const recentForm = recentGames.slice(0, 10).map(
      g => (g.my_position === 1 ? 'W' : 'L') as 'W' | 'L',
    );

    // Current streak: count consecutive same results from most recent
    let currentStreak = 0;
    if (recentForm.length > 0) {
      const first = recentForm[0]!;
      for (const result of recentForm) {
        if (result === first) {
          currentStreak += first === 'W' ? 1 : -1;
        } else {
          break;
        }
      }
    }

    return {
      opponentId: row.opponent_id,
      opponentName: row.opponent_name,
      opponentUsername: row.opponent_username,
      opponentAvatar: row.opponent_avatar as AvatarId | null,
      opponentPhotoUrl: row.opponent_photo_url,
      gamesPlayed,
      wins,
      losses: gamesPlayed - wins,
      recentForm,
      avgDurationSeconds: Math.round(parseFloat(row.avg_duration) || 0),
      currentStreak,
    };
  });
}

// ── Career trajectory ─────────────────────────────────────────────────

interface CareerWeekRow {
  week_start: string;
  games_played: string;
  wins: string;
  total_bluffs: string;
  successful_bluffs: string;
  total_bulls: string;
  correct_bulls: string;
}

interface CareerRatingRow {
  week_start: string;
  last_rating: string;
}

/**
 * Build career trajectory data showing rating, win rate, and play style
 * evolution over time. Data is bucketed by week.
 */
async function getCareerTrajectory(userId: string): Promise<CareerTrajectoryPoint[] | null> {
  // Get weekly game stats
  const statsResult = await readQuery<CareerWeekRow>(
    `SELECT
       DATE_TRUNC('week', g.ended_at)::text AS week_start,
       COUNT(*)::text AS games_played,
       COUNT(*) FILTER (WHERE gp.finish_position = 1)::text AS wins,
       COALESCE(SUM((gp.stats->>'callsMade')::int), 0)::text AS total_bluffs,
       COALESCE(SUM((gp.stats->>'bluffsSuccessful')::int), 0)::text AS successful_bluffs,
       COALESCE(SUM((gp.stats->>'bullsCalled')::int), 0)::text AS total_bulls,
       COALESCE(SUM((gp.stats->>'correctBulls')::int), 0)::text AS correct_bulls
     FROM game_players gp
     JOIN games g ON g.id = gp.game_id
     WHERE gp.user_id = $1
     GROUP BY DATE_TRUNC('week', g.ended_at)
     ORDER BY week_start ASC`,
    [userId],
  );

  if (!statsResult) return null;

  // Get weekly ending rating (last rating_after per week)
  const ratingResult = await readQuery<CareerRatingRow>(
    `SELECT DISTINCT ON (DATE_TRUNC('week', created_at))
       DATE_TRUNC('week', created_at)::text AS week_start,
       rating_after::text AS last_rating
     FROM rating_history
     WHERE user_id = $1
     ORDER BY DATE_TRUNC('week', created_at), created_at DESC`,
    [userId],
  );

  const ratingByWeek = new Map<string, number>();
  if (ratingResult) {
    for (const row of ratingResult.rows) {
      ratingByWeek.set(row.week_start, parseFloat(row.last_rating));
    }
  }

  let lastKnownRating = 1200; // Default starting rating

  return statsResult.rows.map((row: CareerWeekRow) => {
    const gamesPlayed = parseInt(row.games_played, 10);
    const wins = parseInt(row.wins, 10);
    const totalBluffs = parseInt(row.total_bluffs, 10);
    const successfulBluffs = parseInt(row.successful_bluffs, 10);
    const totalBulls = parseInt(row.total_bulls, 10);
    const correctBulls = parseInt(row.correct_bulls, 10);

    const rating = ratingByWeek.get(row.week_start) ?? lastKnownRating;
    lastKnownRating = rating;

    return {
      periodStart: row.week_start,
      rating: Math.round(rating),
      winRate: gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0,
      gamesPlayed,
      bluffRate: totalBluffs > 0 ? Math.round((successfulBluffs / totalBluffs) * 100) : null,
      bullAccuracy: totalBulls > 0 ? Math.round((correctBulls / totalBulls) * 100) : null,
    };
  });
}
