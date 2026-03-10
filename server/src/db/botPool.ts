import { query } from './index.js';
import { BOT_PROFILE_MAP, IMPOSSIBLE_BOT, CFR_BOTS } from '@bull-em/shared';
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
    // Exclude lvl10 (The Oracle) from ranked play — too strong for matchmaking
    if (user.bot_profile === IMPOSSIBLE_BOT.key) continue;

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

  // Self-heal: if CFR bots are missing from the DB (e.g. migration 018 partially
  // failed), inject them into the result immediately from code definitions AND
  // seed them in the DB for future fetches.
  const hasCFR = entries.some(e => e.botProfile.startsWith('cfr_'));
  if (!hasCFR && usersResult.rows.length > 0) {
    logger.warn('No CFR bots found in database — injecting from code definitions and seeding DB');
    for (const bot of CFR_BOTS) {
      const uuid = CFR_BOT_UUIDS[bot.key];
      if (!uuid) continue;
      entries.push({
        userId: uuid,
        username: bot.key,
        displayName: bot.name,
        botProfile: bot.key,
        profileConfig: bot.config,
        profileDefinition: bot,
        rating: 1200,
      });
    }
    // Seed in background so future fetches find them in the DB
    void seedMissingCFRBots().catch(() => {/* logged inside */});
  }

  return entries;
}

/** Deterministic UUIDs for CFR bots (same as migration 018). */
const CFR_BOT_UUIDS: Record<string, string> = {
  cfr_viper:    '00000000-0000-4000-b101-000000000000',
  cfr_ghost:    '00000000-0000-4000-b102-000000000000',
  cfr_reaper:   '00000000-0000-4000-b103-000000000000',
  cfr_specter:  '00000000-0000-4000-b104-000000000000',
  cfr_raptor:   '00000000-0000-4000-b105-000000000000',
  cfr_havoc:    '00000000-0000-4000-b106-000000000000',
  cfr_phantom:  '00000000-0000-4000-b107-000000000000',
  cfr_sentinel: '00000000-0000-4000-b108-000000000000',
  cfr_vanguard: '00000000-0000-4000-b109-000000000000',
};

/**
 * Seed missing CFR bot accounts and their default ratings.
 * Mirrors migration 018 steps 3-4 so the pool is correct on next fetch.
 */
async function seedMissingCFRBots(): Promise<void> {
  for (const bot of CFR_BOTS) {
    const uuid = CFR_BOT_UUIDS[bot.key];
    if (!uuid) continue;

    try {
      await query(
        `INSERT INTO users (id, username, display_name, auth_provider, is_bot, bot_profile)
         VALUES ($1, $2, $3, 'bot', true, $4)
         ON CONFLICT (username) DO UPDATE
           SET is_bot = true, bot_profile = EXCLUDED.bot_profile, display_name = EXCLUDED.display_name`,
        [uuid, bot.key, bot.name, bot.key],
      );

      // Seed default ratings for both modes
      for (const m of ['heads_up', 'multiplayer'] as const) {
        await query(
          `INSERT INTO ratings (user_id, mode, elo, mu, sigma, games_played, peak_rating)
           VALUES ($1, $2, 1200, 25, 8.333, 0, 1200)
           ON CONFLICT (user_id, mode) DO NOTHING`,
          [uuid, m],
        );
      }

      logger.info({ botKey: bot.key, userId: uuid }, 'Seeded CFR bot account');
    } catch (err) {
      logger.error({ err, botKey: bot.key }, 'Failed to seed CFR bot account');
    }
  }
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
