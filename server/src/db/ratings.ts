import { query } from './index.js';
import logger from '../logger.js';
import type { RankedMode, EloRating, OpenSkillRating, UserRatings } from '@bull-em/shared';
import {
  ELO_DEFAULT,
  OPENSKILL_DEFAULT_MU,
  OPENSKILL_DEFAULT_SIGMA,
  calculateElo,
  calculateOpenSkill,
  openSkillDisplayRating,
} from '@bull-em/shared';

// ── Query helpers ───────────────────────────────────────────────────────

interface RatingRow {
  user_id: string;
  mode: RankedMode;
  elo: string;
  mu: string;
  sigma: string;
  games_played: string;
  peak_rating: string;
  last_updated: string;
}

/**
 * Get a user's rating for a specific mode. Returns null if no rating exists
 * (the user hasn't played ranked in that mode yet) or if the DB is unavailable.
 */
export async function getRating(
  userId: string,
  mode: RankedMode,
): Promise<EloRating | OpenSkillRating | null> {
  const result = await query<RatingRow>(
    'SELECT * FROM ratings WHERE user_id = $1 AND mode = $2',
    [userId, mode],
  );
  if (!result || result.rows.length === 0) return null;
  return rowToRating(result.rows[0]!);
}

/**
 * Get both ratings for a user (heads_up and multiplayer).
 * Returns null if the DB is unavailable.
 */
export async function getUserRatings(userId: string): Promise<UserRatings | null> {
  const result = await query<RatingRow>(
    'SELECT * FROM ratings WHERE user_id = $1',
    [userId],
  );
  if (!result) return null;

  let headsUp: EloRating | null = null;
  let multiplayer: OpenSkillRating | null = null;

  for (const row of result.rows) {
    const rating = rowToRating(row);
    if (rating.mode === 'heads_up') {
      headsUp = rating;
    } else {
      multiplayer = rating;
    }
  }

  return { userId, headsUp, multiplayer };
}

/** Convert a database row to the appropriate rating type. */
function rowToRating(row: RatingRow): EloRating | OpenSkillRating {
  if (row.mode === 'heads_up') {
    return {
      mode: 'heads_up',
      elo: parseFloat(row.elo),
      gamesPlayed: parseInt(row.games_played, 10),
      peakRating: parseFloat(row.peak_rating),
      lastUpdated: row.last_updated,
    };
  }
  return {
    mode: 'multiplayer',
    mu: parseFloat(row.mu),
    sigma: parseFloat(row.sigma),
    gamesPlayed: parseInt(row.games_played, 10),
    peakRating: parseFloat(row.peak_rating),
    lastUpdated: row.last_updated,
  };
}

// ── Rating update after game ────────────────────────────────────────────

/** Player finish data needed for rating updates. */
interface RankedPlayerResult {
  userId: string;
  finishPosition: number;
}

/** Weight applied to rating changes when the match is entirely against bots.
 *  A value of 0.5 means the rating change is halved — bot matches still count
 *  but are less impactful than human-vs-human games. */
const BOT_MATCH_WEIGHT = 0.5;

/**
 * Update ratings after a ranked game completes. Handles both Elo (heads-up)
 * and OpenSkill (multiplayer) based on the game's ranked mode.
 *
 * Ensures rating rows exist (upserts defaults), calculates new ratings,
 * and persists the results. Also inserts rating_history rows when gameId
 * is provided. Fire-and-forget — never blocks gameplay.
 *
 * @param botFraction — fraction of opponents that are bots (0 = all human, 1 = all bots).
 *                      When > 0, rating changes are scaled down proportionally.
 */
export async function updateRatingsAfterGame(
  rankedMode: RankedMode,
  players: RankedPlayerResult[],
  gameId?: string,
  botFraction?: number,
): Promise<void> {
  if (players.length < 2) return;

  // Scale factor: 1.0 for all-human games, BOT_MATCH_WEIGHT for all-bot games,
  // linearly interpolated for mixed lobbies.
  const weight = botFraction != null && botFraction > 0
    ? 1 - botFraction * (1 - BOT_MATCH_WEIGHT)
    : 1;

  try {
    if (rankedMode === 'heads_up') {
      await updateHeadsUpRatings(players, gameId, weight);
    } else {
      await updateMultiplayerRatings(players, gameId, weight);
    }
  } catch (err) {
    logger.error({ err, rankedMode, playerCount: players.length }, 'Failed to update ratings');
  }
}

async function updateHeadsUpRatings(players: RankedPlayerResult[], gameId?: string, weight = 1): Promise<void> {
  // Heads-up: exactly 2 players. Position 1 = winner, position 2 = loser.
  const winner = players.find(p => p.finishPosition === 1);
  const loser = players.find(p => p.finishPosition === 2);
  if (!winner || !loser) return;

  // Ensure rating rows exist
  await ensureRatingExists(winner.userId, 'heads_up');
  await ensureRatingExists(loser.userId, 'heads_up');

  // Fetch current ratings
  const winnerRating = await getRating(winner.userId, 'heads_up');
  const loserRating = await getRating(loser.userId, 'heads_up');
  if (!winnerRating || !loserRating || winnerRating.mode !== 'heads_up' || loserRating.mode !== 'heads_up') return;

  const [winnerResult, loserResult] = calculateElo(
    { rating: winnerRating.elo, gamesPlayed: winnerRating.gamesPlayed },
    { rating: loserRating.elo, gamesPlayed: loserRating.gamesPlayed },
  );

  // Apply bot weight — scale the deltas so bot matches count less
  const weightedWinnerDelta = Math.round(winnerResult.delta * weight);
  const weightedLoserDelta = Math.round(loserResult.delta * weight);
  const weightedWinnerRating = winnerRating.elo + weightedWinnerDelta;
  const weightedLoserRating = loserRating.elo + weightedLoserDelta;

  // Persist new ratings
  await updateEloRating(winner.userId, weightedWinnerRating, winnerRating.gamesPlayed + 1);
  await updateEloRating(loser.userId, weightedLoserRating, loserRating.gamesPlayed + 1);

  // Persist rating history
  if (gameId) {
    await persistRatingHistory(winner.userId, gameId, 'heads_up', winnerRating.elo, weightedWinnerRating);
    await persistRatingHistory(loser.userId, gameId, 'heads_up', loserRating.elo, weightedLoserRating);
  }
}

async function updateMultiplayerRatings(players: RankedPlayerResult[], gameId?: string, weight = 1): Promise<void> {
  // Ensure all rating rows exist
  await Promise.all(players.map(p => ensureRatingExists(p.userId, 'multiplayer')));

  // Fetch current ratings
  const ratings = await Promise.all(
    players.map(async (p) => {
      const rating = await getRating(p.userId, 'multiplayer');
      return { ...p, rating };
    }),
  );

  // Build input for OpenSkill calculation
  const openSkillInput = ratings.map(p => ({
    userId: p.userId,
    mu: p.rating?.mode === 'multiplayer' ? p.rating.mu : OPENSKILL_DEFAULT_MU,
    sigma: p.rating?.mode === 'multiplayer' ? p.rating.sigma : OPENSKILL_DEFAULT_SIGMA,
    finishPosition: p.finishPosition,
  }));

  const results = calculateOpenSkill(openSkillInput);

  // Persist updated ratings and rating history
  await Promise.all(
    results.map(async (r) => {
      const existing = ratings.find(p => p.userId === r.userId);
      const gamesPlayed = (existing?.rating?.gamesPlayed ?? 0) + 1;
      const beforeMu = existing?.rating?.mode === 'multiplayer' ? existing.rating.mu : OPENSKILL_DEFAULT_MU;

      // Apply bot weight — scale the mu delta so bot matches count less
      const rawDelta = r.mu - beforeMu;
      const weightedMu = beforeMu + rawDelta * weight;

      await updateOpenSkillRating(r.userId, weightedMu, r.sigma, gamesPlayed);
      if (gameId) {
        // Store display ratings (mu * 48) for consistent chart data
        await persistRatingHistory(
          r.userId, gameId, 'multiplayer',
          openSkillDisplayRating(beforeMu),
          openSkillDisplayRating(weightedMu),
        );
      }
    }),
  );
}

// ── Database write helpers ──────────────────────────────────────────────

/** Ensure a rating row exists for the user/mode. No-ops if it already exists. */
async function ensureRatingExists(userId: string, mode: RankedMode): Promise<void> {
  await query(
    `INSERT INTO ratings (user_id, mode)
     VALUES ($1, $2)
     ON CONFLICT (user_id, mode) DO NOTHING`,
    [userId, mode],
  );
}

/** Update Elo rating for a heads-up player. */
async function updateEloRating(
  userId: string,
  newElo: number,
  gamesPlayed: number,
): Promise<void> {
  await query(
    `UPDATE ratings
     SET elo = $1,
         games_played = $2,
         peak_rating = GREATEST(peak_rating, $1),
         last_updated = NOW()
     WHERE user_id = $3 AND mode = 'heads_up'`,
    [newElo, gamesPlayed, userId],
  );
}

/** Update OpenSkill rating for a multiplayer player. */
async function updateOpenSkillRating(
  userId: string,
  mu: number,
  sigma: number,
  gamesPlayed: number,
): Promise<void> {
  // Use mu - 3*sigma as the display rating for peak tracking
  const displayRating = mu - 3 * sigma;
  await query(
    `UPDATE ratings
     SET mu = $1,
         sigma = $2,
         games_played = $3,
         peak_rating = GREATEST(peak_rating, $4),
         last_updated = NOW()
     WHERE user_id = $5 AND mode = 'multiplayer'`,
    [mu, sigma, gamesPlayed, displayRating, userId],
  );
}

// ── Rating history persistence ──────────────────────────────────────────

/** Insert a rating_history row for a single player in a ranked game. */
async function persistRatingHistory(
  userId: string,
  gameId: string,
  mode: RankedMode,
  ratingBefore: number,
  ratingAfter: number,
): Promise<void> {
  try {
    await query(
      `INSERT INTO rating_history (user_id, game_id, mode, rating_before, rating_after)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (game_id, user_id, mode) DO NOTHING`,
      [userId, gameId, mode, ratingBefore, ratingAfter],
    );
  } catch (err) {
    logger.error({ err, userId, gameId, mode }, 'Failed to persist rating history');
  }
}
