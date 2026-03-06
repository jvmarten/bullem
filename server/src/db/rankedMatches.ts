import { query } from './index.js';
import logger from '../logger.js';
import type { RankedMode, GameSettings } from '@bull-em/shared';

/** Data for persisting a ranked match. */
export interface RankedMatchData {
  gameId: string;
  mode: RankedMode;
  playerCount: number;
  humanPlayerCount: number;
  fromMatchmaking: boolean;
  settings: GameSettings;
  startedAt: Date;
  players: RankedMatchPlayerData[];
}

/** Per-player data in a ranked match. */
export interface RankedMatchPlayerData {
  userId: string;
  displayName: string;
  finishPosition: number;
  isBot: boolean;
  eloBefore?: number;
  eloAfter?: number;
  muBefore?: number;
  sigmaBefore?: number;
  muAfter?: number;
  sigmaAfter?: number;
}

/**
 * Persist a ranked match and its player records to the ranked_matches /
 * ranked_match_players tables. This stores the full rating snapshot before
 * and after the match, enabling future rating recalculation.
 *
 * Fire-and-forget — never blocks gameplay.
 */
export async function persistRankedMatch(data: RankedMatchData): Promise<void> {
  try {
    const matchResult = await query<{ id: string }>(
      `INSERT INTO ranked_matches (game_id, mode, player_count, human_player_count, from_matchmaking, settings, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        data.gameId,
        data.mode,
        data.playerCount,
        data.humanPlayerCount,
        data.fromMatchmaking,
        JSON.stringify(data.settings),
        data.startedAt.toISOString(),
      ],
    );

    if (!matchResult || matchResult.rows.length === 0) {
      logger.warn('Failed to persist ranked match — database unavailable');
      return;
    }

    const matchId = matchResult.rows[0]!.id;

    if (data.players.length > 0) {
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let idx = 1;

      for (const p of data.players) {
        placeholders.push(
          `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, $${idx + 8}, $${idx + 9}, $${idx + 10})`,
        );
        values.push(
          matchId, p.userId, p.displayName, p.finishPosition, p.isBot,
          p.eloBefore ?? null, p.eloAfter ?? null,
          p.muBefore ?? null, p.sigmaBefore ?? null,
          p.muAfter ?? null, p.sigmaAfter ?? null,
        );
        idx += 11;
      }

      await query(
        `INSERT INTO ranked_match_players
         (match_id, user_id, display_name, finish_position, is_bot,
          elo_before, elo_after, mu_before, sigma_before, mu_after, sigma_after)
         VALUES ${placeholders.join(', ')}`,
        values,
      );
    }

    logger.info(
      { matchId, gameId: data.gameId, mode: data.mode, playerCount: data.playerCount },
      'Ranked match persisted to database',
    );
  } catch (err) {
    logger.error({ err, gameId: data.gameId }, 'Failed to persist ranked match');
  }
}
