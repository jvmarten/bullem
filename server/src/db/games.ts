import { query } from './index.js';
import logger from '../logger.js';
import type { GameSettings, PlayerGameStats, PlayerId } from '@bull-em/shared';

/** Data for a single player in a completed game. */
interface GamePlayerRecord {
  playerId: PlayerId;
  userId: string | null;
  playerName: string;
  finishPosition: number;
  finalCardCount: number;
  stats: PlayerGameStats;
}

/** All data needed to persist a completed game. */
export interface GameRecord {
  roomCode: string;
  winnerId: PlayerId;
  winnerUserId: string | null;
  winnerName: string;
  playerCount: number;
  settings: GameSettings;
  startedAt: Date;
  players: GamePlayerRecord[];
}

/**
 * Persist a completed game and its player records to PostgreSQL.
 * Fails silently (logs error) — game persistence should never block gameplay.
 *
 * If the initial INSERT fails (e.g. winner_id FK violation because a bot's
 * user row doesn't exist yet), retries once with winner_id = NULL so the
 * game and all player rows are still recorded.
 */
export async function persistGameResult(record: GameRecord, preGeneratedId?: string): Promise<string | null> {
  try {
    // Insert the game row. When a pre-generated ID is provided, use it so the
    // database row has the same ID as the broadcast replay (enabling localStorage
    // replays to be found by the same ID used in profile game history links).
    let gameResult = preGeneratedId
      ? await query<{ id: string }>(
          `INSERT INTO games (id, room_code, winner_id, winner_name, player_count, settings, started_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [preGeneratedId, record.roomCode, record.winnerUserId, record.winnerName, record.playerCount, JSON.stringify(record.settings), record.startedAt.toISOString()],
        )
      : await query<{ id: string }>(
          `INSERT INTO games (room_code, winner_id, winner_name, player_count, settings, started_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [record.roomCode, record.winnerUserId, record.winnerName, record.playerCount, JSON.stringify(record.settings), record.startedAt.toISOString()],
        );

    // If the INSERT failed (likely FK violation on winner_id), retry without
    // winner_id so the game row is still created. winner_name is denormalized
    // so no display info is lost.
    if (!gameResult || gameResult.rows.length === 0) {
      if (record.winnerUserId) {
        logger.warn(
          { roomCode: record.roomCode, winnerUserId: record.winnerUserId },
          'Game INSERT failed — retrying with winner_id = NULL (possible FK violation)',
        );
        gameResult = preGeneratedId
          ? await query<{ id: string }>(
              `INSERT INTO games (id, room_code, winner_name, player_count, settings, started_at)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING id`,
              [preGeneratedId, record.roomCode, record.winnerName, record.playerCount, JSON.stringify(record.settings), record.startedAt.toISOString()],
            )
          : await query<{ id: string }>(
              `INSERT INTO games (room_code, winner_name, player_count, settings, started_at)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING id`,
              [record.roomCode, record.winnerName, record.playerCount, JSON.stringify(record.settings), record.startedAt.toISOString()],
            );
      }

      if (!gameResult || gameResult.rows.length === 0) {
        logger.error(
          { roomCode: record.roomCode, playerCount: record.playerCount },
          'Failed to persist game — database unavailable or INSERT rejected',
        );
        return null;
      }
    }

    const gameId = gameResult.rows[0]!.id;

    // Insert player records individually so one FK failure (e.g. invalid bot
    // user_id) doesn't prevent other players' records from being created.
    for (const p of record.players) {
      let playerResult = await query(
        `INSERT INTO game_players (game_id, user_id, player_name, finish_position, final_card_count, stats)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [gameId, p.userId, p.playerName, p.finishPosition, p.finalCardCount, JSON.stringify(p.stats)],
      );

      // If INSERT failed (likely FK violation on user_id), retry with user_id = NULL
      // so the player record still exists for game history and replay queries.
      if (!playerResult && p.userId) {
        logger.warn(
          { gameId, playerName: p.playerName, userId: p.userId },
          'game_players INSERT failed — retrying with user_id = NULL (possible FK violation)',
        );
        playerResult = await query(
          `INSERT INTO game_players (game_id, user_id, player_name, finish_position, final_card_count, stats)
           VALUES ($1, NULL, $2, $3, $4, $5)`,
          [gameId, p.playerName, p.finishPosition, p.finalCardCount, JSON.stringify(p.stats)],
        );
        if (!playerResult) {
          logger.error(
            { gameId, playerName: p.playerName },
            'game_players INSERT failed even with NULL user_id',
          );
        }
      }
    }

    logger.info({ gameId, roomCode: record.roomCode, playerCount: record.playerCount }, 'Game persisted to database');
    return gameId;
  } catch (err) {
    logger.error({ err, roomCode: record.roomCode, playerCount: record.playerCount }, 'Failed to persist game result');
    return null;
  }
}

/** Row shape returned by game history queries. */
interface GameHistoryRow {
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

/** A single game in a user's history. */
export interface GameHistoryEntry {
  id: string;
  roomCode: string;
  winnerName: string;
  playerCount: number;
  settings: GameSettings;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  finishPosition: number;
  playerName: string;
  finalCardCount: number;
  stats: PlayerGameStats;
}

/**
 * Fetch recent game history for a user, ordered by most recent first.
 * Returns null if the database is unavailable.
 */
export async function getGameHistory(
  userId: string,
  limit = 20,
  offset = 0,
): Promise<{ games: GameHistoryEntry[]; total: number } | null> {
  // Get total count
  const countResult = await query<{ total: string }>(
    'SELECT COUNT(*)::text AS total FROM game_players WHERE user_id = $1',
    [userId],
  );
  if (!countResult) return null;
  const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

  // Get paginated game entries
  const result = await query<GameHistoryRow>(
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
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );

  if (!result) return null;

  const games: GameHistoryEntry[] = result.rows.map(row => ({
    id: row.id,
    roomCode: row.room_code,
    winnerName: row.winner_name,
    playerCount: parseInt(row.player_count, 10),
    settings: row.settings,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: parseInt(row.duration_seconds, 10),
    finishPosition: parseInt(row.finish_position, 10),
    playerName: row.player_name,
    finalCardCount: parseInt(row.final_card_count, 10),
    stats: row.stats,
  }));

  return { games, total };
}
