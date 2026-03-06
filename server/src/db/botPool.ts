import { query } from './index.js';
import { BOT_PROFILE_MAP } from '@bull-em/shared';
import type { BotProfileConfig, BotProfileDefinition } from '@bull-em/shared';
import logger from '../logger.js';

/** A bot account row from the database with its associated rating. */
export interface RankedBotEntry {
  userId: string;
  username: string;
  displayName: string;
  botProfile: string;
  profileConfig: BotProfileConfig;
  profileDefinition: BotProfileDefinition;
  /** Elo rating for heads-up, or mu-based ordinal for multiplayer. */
  rating: number;
}

interface BotUserRow {
  id: string;
  username: string;
  display_name: string;
  bot_profile: string;
}

interface BotRatingRow {
  user_id: string;
  mode: string;
  elo: string;
  mu: string;
  sigma: string;
}

/**
 * Fetch all bot users from the database with their ratings for the given mode.
 * Returns an empty array if the DB is unavailable or no bots are seeded.
 */
export async function getRankedBotPool(
  mode: 'heads_up' | 'multiplayer',
): Promise<RankedBotEntry[]> {
  const usersResult = await query<BotUserRow>(
    `SELECT id, username, display_name, bot_profile
     FROM users
     WHERE is_bot = true AND bot_profile IS NOT NULL`,
  );
  if (!usersResult || usersResult.rows.length === 0) return [];

  const userIds = usersResult.rows.map(r => r.id);

  const ratingsResult = await query<BotRatingRow>(
    `SELECT user_id, mode, elo, mu, sigma
     FROM ratings
     WHERE user_id = ANY($1) AND mode = $2`,
    [userIds, mode],
  );

  const ratingMap = new Map<string, BotRatingRow>();
  if (ratingsResult) {
    for (const row of ratingsResult.rows) {
      ratingMap.set(row.user_id, row);
    }
  }

  const entries: RankedBotEntry[] = [];
  for (const user of usersResult.rows) {
    const profile = BOT_PROFILE_MAP.get(user.bot_profile);
    if (!profile) {
      logger.warn({ botProfile: user.bot_profile, userId: user.id }, 'Bot profile not found in BOT_PROFILE_MAP');
      continue;
    }

    const ratingRow = ratingMap.get(user.id);
    let rating: number;
    if (mode === 'heads_up') {
      rating = ratingRow ? parseFloat(ratingRow.elo) : 1200;
    } else {
      const mu = ratingRow ? parseFloat(ratingRow.mu) : 25;
      const sigma = ratingRow ? parseFloat(ratingRow.sigma) : 8.333;
      // Use ordinal (mu - 3*sigma) scaled to Elo-like range for comparison
      rating = (mu - 3 * sigma) * 48;
    }

    entries.push({
      userId: user.id,
      username: user.username,
      displayName: user.display_name,
      botProfile: user.bot_profile,
      profileConfig: profile.config,
      profileDefinition: profile,
      rating,
    });
  }

  return entries;
}

/**
 * Pick the best bot from the pool whose rating is closest to the target.
 * Optionally exclude bots already in use (by userId).
 */
export function pickClosestRatedBot(
  pool: RankedBotEntry[],
  targetRating: number,
  excludeUserIds?: Set<string>,
): RankedBotEntry | null {
  let best: RankedBotEntry | null = null;
  let bestDiff = Infinity;

  for (const bot of pool) {
    if (excludeUserIds?.has(bot.userId)) continue;
    const diff = Math.abs(bot.rating - targetRating);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = bot;
    }
  }

  return best;
}
