/**
 * Pure rating calculation functions for the dual-track rating system.
 * - Elo: heads-up (1v1) games
 * - OpenSkill: multiplayer (3-9 player) games
 *
 * No side effects — takes ratings in, returns ratings out.
 */

import { rate, ordinal } from 'openskill';
import type { GameSettings, LastChanceMode } from './types.js';

// ── Elo constants ───────────────────────────────────────────────────────

/** K-factor for provisional players (< 20 games). Higher = faster convergence. */
const ELO_K_PROVISIONAL = 32;
/** K-factor for established players (>= 20 games). Lower = more stable rating. */
const ELO_K_ESTABLISHED = 16;
/** Games threshold: below this, player is "provisional" with higher K-factor. */
const ELO_PROVISIONAL_THRESHOLD = 20;
/** Default starting Elo rating. */
export const ELO_DEFAULT = 1200;

// ── OpenSkill constants ─────────────────────────────────────────────────

/** Default mu (mean skill estimate) for new players. */
export const OPENSKILL_DEFAULT_MU = 25;
/** Default sigma (uncertainty) for new players. */
export const OPENSKILL_DEFAULT_SIGMA = 25 / 3; // ≈ 8.333

// ── Ranked settings ─────────────────────────────────────────────────────

/**
 * Locked settings for ranked games. These are enforced server-side and
 * cannot be overridden by players in ranked mode.
 */
export const RANKED_SETTINGS: Readonly<{
  maxCards: number;
  turnTimer: number;
  lastChanceMode: LastChanceMode;
  maxPlayers: number;
}> = {
  maxCards: 5,
  turnTimer: 30,
  lastChanceMode: 'classic',
  maxPlayers: 9,
} as const;

/**
 * Validate that the given settings match ranked requirements.
 * Returns true if the settings are compatible with ranked play.
 */
export function isValidRankedSettings(settings: GameSettings): boolean {
  return (
    settings.maxCards === RANKED_SETTINGS.maxCards &&
    settings.turnTimer === RANKED_SETTINGS.turnTimer &&
    (settings.lastChanceMode ?? 'classic') === RANKED_SETTINGS.lastChanceMode &&
    (settings.maxPlayers ?? 9) <= RANKED_SETTINGS.maxPlayers
  );
}

// ── Elo calculation ─────────────────────────────────────────────────────

/** Input for an Elo calculation: a player's current rating and game count. */
export interface EloPlayer {
  rating: number;
  gamesPlayed: number;
}

/** Result of an Elo calculation for one player. */
export interface EloResult {
  newRating: number;
  delta: number;
}

/**
 * Calculate Elo expected score for player A against player B.
 * Standard logistic curve: E_A = 1 / (1 + 10^((R_B - R_A) / 400))
 */
function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/** Get K-factor based on games played. */
function getKFactor(gamesPlayed: number): number {
  return gamesPlayed < ELO_PROVISIONAL_THRESHOLD ? ELO_K_PROVISIONAL : ELO_K_ESTABLISHED;
}

/**
 * Calculate new Elo ratings for a heads-up (1v1) game.
 *
 * @param winner - The winning player's current rating info
 * @param loser - The losing player's current rating info
 * @returns Tuple of [winnerResult, loserResult] with new ratings and deltas
 */
export function calculateElo(
  winner: EloPlayer,
  loser: EloPlayer,
): [EloResult, EloResult] {
  const expectedWin = expectedScore(winner.rating, loser.rating);
  const expectedLose = expectedScore(loser.rating, winner.rating);

  const kWinner = getKFactor(winner.gamesPlayed);
  const kLoser = getKFactor(loser.gamesPlayed);

  const winnerDelta = Math.round(kWinner * (1 - expectedWin));
  const loserDelta = Math.round(kLoser * (0 - expectedLose));

  return [
    { newRating: winner.rating + winnerDelta, delta: winnerDelta },
    { newRating: loser.rating + loserDelta, delta: loserDelta },
  ];
}

// ── OpenSkill calculation ───────────────────────────────────────────────

/** Input for an OpenSkill calculation: a player's current mu/sigma and finish position. */
export interface OpenSkillPlayer {
  userId: string;
  mu: number;
  sigma: number;
  finishPosition: number;
}

/** Result of an OpenSkill calculation for one player. */
export interface OpenSkillResult {
  userId: string;
  mu: number;
  sigma: number;
}

/**
 * Calculate updated OpenSkill ratings for a multiplayer game.
 * Players are ranked by finish position (1st place = best).
 *
 * @param players - Array of players with their current mu/sigma and finish position
 * @returns Array of updated ratings in the same order as input
 */
export function calculateOpenSkill(players: OpenSkillPlayer[]): OpenSkillResult[] {
  // Sort by finish position for the rate() function (expects best-to-worst ordering)
  const sorted = [...players].sort((a, b) => a.finishPosition - b.finishPosition);

  // openskill.rate() expects teams as [[player1], [player2], ...] for individual games
  const teams = sorted.map(p => [{ mu: p.mu, sigma: p.sigma }]);

  const result = rate(teams);

  // Map results back with userId
  return sorted.map((player, i) => ({
    userId: player.userId,
    mu: result[i]![0]!.mu,
    sigma: result[i]![0]!.sigma,
  }));
}

/**
 * Convert OpenSkill mu/sigma to a single display rating.
 * Uses ordinal = mu - 3*sigma (conservative estimate).
 */
export function openSkillOrdinal(mu: number, sigma: number): number {
  return ordinal({ mu, sigma });
}
