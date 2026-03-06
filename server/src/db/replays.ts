import { query } from './index.js';
import logger from '../logger.js';
import type { GameReplay, RoundSnapshot, ReplayListEntry } from '@bull-em/shared';

/**
 * Persist replay round snapshots to the `rounds` table.
 * Each round is stored as a JSONB snapshot keyed by (game_id, round_number).
 * Runs async — must never block gameplay.
 */
export async function persistReplayRounds(
  gameId: string,
  snapshots: RoundSnapshot[],
): Promise<void> {
  if (snapshots.length === 0) return;

  try {
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let idx = 1;

    for (const snap of snapshots) {
      placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2})`);
      values.push(gameId, snap.roundNumber, JSON.stringify(snap));
      idx += 3;
    }

    await query(
      `INSERT INTO rounds (game_id, round_number, snapshot)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (game_id, round_number) DO NOTHING`,
      values,
    );

    logger.info({ gameId, rounds: snapshots.length }, 'Replay rounds persisted to database');
  } catch (err) {
    logger.error({ err, gameId }, 'Failed to persist replay rounds');
  }
}

/** Row shape for replay metadata query. */
interface ReplayMetadataRow {
  id: string;
  room_code: string;
  winner_name: string;
  player_count: string;
  settings: string;
  started_at: string;
  ended_at: string;
}

/** Row shape for game_players in a replay. */
interface ReplayPlayerRow {
  player_name: string;
  // game_players doesn't store playerId (the in-game ID) — we use player_name
}

/** Row shape for round snapshots. */
interface RoundRow {
  round_number: string;
  snapshot: RoundSnapshot;
}

/**
 * Fetch a full GameReplay by game ID from the database.
 * Reconstructs the replay from games + game_players + rounds tables.
 * Returns null if the game doesn't exist or has no rounds recorded.
 */
export async function getReplayByGameId(gameId: string): Promise<GameReplay | null> {
  // Fetch game metadata
  const gameResult = await query<ReplayMetadataRow>(
    `SELECT id, room_code, winner_name, player_count::text, settings, started_at, ended_at
     FROM games WHERE id = $1`,
    [gameId],
  );

  if (!gameResult || gameResult.rows.length === 0) return null;

  const game = gameResult.rows[0]!;

  // Fetch round snapshots
  const roundsResult = await query<RoundRow>(
    `SELECT round_number::text, snapshot
     FROM rounds WHERE game_id = $1
     ORDER BY round_number ASC`,
    [gameId],
  );

  if (!roundsResult || roundsResult.rows.length === 0) return null;

  const rounds: RoundSnapshot[] = roundsResult.rows.map(r => r.snapshot);

  // Reconstruct player list from the first round's playerCards
  // (round snapshots contain SpectatorPlayerCards with playerId, playerName, cards)
  const firstRound = rounds[0]!;
  const players = firstRound.playerCards.map(pc => ({
    id: pc.playerId,
    name: pc.playerName,
  }));

  // Find winnerId from round snapshots — the winner is the last player not eliminated
  // We can determine this from the result penalties across rounds
  const winnerName = game.winner_name;
  const winner = players.find(p => p.name === winnerName);
  const winnerId = winner?.id ?? players[0]!.id;

  const settings = typeof game.settings === 'string'
    ? JSON.parse(game.settings) as GameReplay['settings']
    : game.settings as unknown as GameReplay['settings'];

  const replay: GameReplay = {
    id: gameId,
    players,
    settings,
    rounds,
    winnerId,
    completedAt: game.ended_at,
  };

  return replay;
}

/** Row shape for replay list query. */
interface ReplayListRow {
  id: string;
  room_code: string;
  winner_name: string;
  player_count: string;
  ended_at: string;
  round_count: string;
}

/**
 * Fetch a paginated list of replays that have round data stored.
 * Returns only games that have at least one round in the rounds table.
 */
export async function getReplayList(
  limit = 20,
  offset = 0,
): Promise<{ replays: ReplayListEntry[]; total: number } | null> {
  const countResult = await query<{ total: string }>(
    `SELECT COUNT(DISTINCT g.id)::text AS total
     FROM games g
     INNER JOIN rounds r ON r.game_id = g.id`,
  );
  if (!countResult) return null;
  const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

  const result = await query<ReplayListRow>(
    `SELECT
       g.id,
       g.room_code,
       g.winner_name,
       g.player_count::text,
       g.ended_at,
       COUNT(r.id)::text AS round_count
     FROM games g
     INNER JOIN rounds r ON r.game_id = g.id
     GROUP BY g.id
     ORDER BY g.ended_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  if (!result) return null;

  const replays: ReplayListEntry[] = result.rows.map(row => ({
    id: row.id,
    roomCode: row.room_code,
    winnerName: row.winner_name,
    playerCount: parseInt(row.player_count, 10),
    roundCount: parseInt(row.round_count, 10),
    completedAt: row.ended_at,
  }));

  return { replays, total };
}

/**
 * Fetch replays for a specific authenticated user.
 * Returns games where the user was a participant and rounds are recorded.
 */
export async function getUserReplays(
  userId: string,
  limit = 20,
  offset = 0,
): Promise<{ replays: ReplayListEntry[]; total: number } | null> {
  const countResult = await query<{ total: string }>(
    `SELECT COUNT(DISTINCT g.id)::text AS total
     FROM games g
     INNER JOIN game_players gp ON gp.game_id = g.id
     INNER JOIN rounds r ON r.game_id = g.id
     WHERE gp.user_id = $1`,
    [userId],
  );
  if (!countResult) return null;
  const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

  const result = await query<ReplayListRow>(
    `SELECT
       g.id,
       g.room_code,
       g.winner_name,
       g.player_count::text,
       g.ended_at,
       COUNT(r.id)::text AS round_count
     FROM games g
     INNER JOIN game_players gp ON gp.game_id = g.id
     INNER JOIN rounds r ON r.game_id = g.id
     WHERE gp.user_id = $1
     GROUP BY g.id
     ORDER BY g.ended_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );

  if (!result) return null;

  const replays: ReplayListEntry[] = result.rows.map(row => ({
    id: row.id,
    roomCode: row.room_code,
    winnerName: row.winner_name,
    playerCount: parseInt(row.player_count, 10),
    roundCount: parseInt(row.round_count, 10),
    completedAt: row.ended_at,
  }));

  return { replays, total };
}
