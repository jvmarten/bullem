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

  // Self-heal: if CFR bots are entirely missing from the DB (e.g. migration 018
  // didn't run), inject them into the result and seed both users + ratings.
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
  } else if (hasCFR) {
    // Self-heal: CFR bot user rows exist but may be missing rating entries
    // (e.g. migration 018 step 3 succeeded but step 4 failed). Without ratings,
    // CFR bots won't appear on the leaderboard (INNER JOIN ratings).
    const cfrEntries = entries.filter(e => e.botProfile.startsWith('cfr_'));
    const cfrMissingRatings = cfrEntries.filter(e => !ratingMap.has(e.userId));
    if (cfrMissingRatings.length > 0) {
      logger.warn(
        { count: cfrMissingRatings.length },
        'CFR bots found in users table but missing ratings — seeding default ratings',
      );
      void seedMissingCFRBotRatings(cfrMissingRatings.map(e => e.userId)).catch(() => {/* logged inside */});
    }
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
 *
 * Uses RETURNING id to get the actual UUID (which may differ from the hardcoded
 * one if ON CONFLICT kept an existing row), then seeds ratings with that UUID.
 */
async function seedMissingCFRBots(): Promise<void> {
  for (const bot of CFR_BOTS) {
    const uuid = CFR_BOT_UUIDS[bot.key];
    if (!uuid) continue;

    try {
      // Use ON CONFLICT (id) to handle UUID collisions (e.g., evolved bots
      // that occupied these UUIDs before CFR bots were introduced). This
      // converts ANY existing row at this UUID into the correct CFR bot,
      // preserving accumulated ratings and game history.
      const userResult = await query<{ id: string }>(
        `INSERT INTO users (id, username, display_name, auth_provider, is_bot, bot_profile)
         VALUES ($1, $2, $3, 'bot', true, $4)
         ON CONFLICT (id) DO UPDATE
           SET username = EXCLUDED.username,
               display_name = EXCLUDED.display_name,
               is_bot = true,
               bot_profile = EXCLUDED.bot_profile
         RETURNING id`,
        [uuid, bot.key, bot.name, bot.key],
      );

      const actualId = userResult?.rows[0]?.id ?? uuid;

      // Seed default ratings using the ACTUAL user id
      for (const m of ['heads_up', 'multiplayer'] as const) {
        await query(
          `INSERT INTO ratings (user_id, mode, elo, mu, sigma, games_played, peak_rating)
           VALUES ($1, $2, 1200, 25, 8.333, 0, 1200)
           ON CONFLICT (user_id, mode) DO NOTHING`,
          [actualId, m],
        );
      }

      logger.info({ botKey: bot.key, userId: actualId }, 'Seeded CFR bot account');
    } catch (err) {
      logger.error({ err, botKey: bot.key }, 'Failed to seed CFR bot account');
    }
  }
}

/**
 * Seed default rating entries for CFR bots that exist in the users table
 * but are missing from the ratings table. This fixes the leaderboard
 * (which uses INNER JOIN ratings) not showing CFR bots.
 */
async function seedMissingCFRBotRatings(userIds: string[]): Promise<void> {
  for (const userId of userIds) {
    try {
      for (const m of ['heads_up', 'multiplayer'] as const) {
        await query(
          `INSERT INTO ratings (user_id, mode, elo, mu, sigma, games_played, peak_rating)
           VALUES ($1, $2, 1200, 25, 8.333, 0, 1200)
           ON CONFLICT (user_id, mode) DO NOTHING`,
          [userId, m],
        );
      }
      logger.info({ userId }, 'Seeded missing CFR bot ratings');
    } catch (err) {
      logger.error({ err, userId }, 'Failed to seed CFR bot ratings');
    }
  }
}

/**
 * Verify all CFR bot accounts and ratings exist at server startup.
 * Unlike the reactive self-heal in getRankedBotPool (which only runs during
 * matchmaking), this runs once at boot to ensure CFR bots are visible on the
 * leaderboard and their profiles are resolvable from the very first request.
 *
 * Key design: always queries the ACTUAL user UUID from the database when
 * seeding ratings, rather than relying on hardcoded UUIDs. This handles the
 * edge case where ON CONFLICT (username) kept an existing row with a different
 * UUID than the hardcoded one.
 */
export async function ensureCFRBotAccounts(): Promise<void> {
  try {
    let seededUsers = 0;
    let seededRatings = 0;

    // Step 1: Ensure all CFR bot user rows exist.
    // Uses ON CONFLICT (id) to handle UUID collisions where a different bot
    // (e.g., old "Evolved" personality) occupies the target UUID. This converts
    // the existing row in-place, preserving accumulated ratings and game history.
    for (const bot of CFR_BOTS) {
      const uuid = CFR_BOT_UUIDS[bot.key];
      if (!uuid) continue;

      // First, delete any stale rows with this CFR username at a DIFFERENT UUID.
      // This handles the edge case where a partial previous fix created CFR bot
      // user rows at random UUIDs (not the deterministic b10x ones).
      await query(
        `DELETE FROM users WHERE username = $1 AND id != $2`,
        [bot.key, uuid],
      );

      const result = await query<{ id: string }>(
        `INSERT INTO users (id, username, display_name, auth_provider, is_bot, bot_profile)
         VALUES ($1, $2, $3, 'bot', true, $4)
         ON CONFLICT (id) DO UPDATE
           SET username = EXCLUDED.username,
               display_name = EXCLUDED.display_name,
               is_bot = true,
               bot_profile = EXCLUDED.bot_profile
         RETURNING id`,
        [uuid, bot.key, bot.name, bot.key],
      );
      if (!result) {
        logger.error({ botKey: bot.key }, 'CFR bot user upsert returned null — DB may be unavailable');
        continue;
      }
      if (result.rows.length > 0) {
        seededUsers++;
      }
    }

    // Step 2: Query actual UUIDs for all CFR bots and seed missing ratings.
    // Always use the REAL user_id from the database — never the hardcoded UUID
    // for ratings, since the actual UUID may differ if ON CONFLICT fired.
    const cfrUsersResult = await query<{ id: string; username: string }>(
      `SELECT id, username FROM users WHERE is_bot = true AND bot_profile LIKE 'cfr_%'`,
    );

    if (!cfrUsersResult || cfrUsersResult.rows.length === 0) {
      logger.error('No CFR bot users found in DB after upsert — seeding failed silently');
      return;
    }

    for (const row of cfrUsersResult.rows) {
      for (const m of ['heads_up', 'multiplayer'] as const) {
        const inserted = await query<{ user_id: string }>(
          `INSERT INTO ratings (user_id, mode, elo, mu, sigma, games_played, peak_rating)
           VALUES ($1, $2, 1200, 25, 8.333, 0, 1200)
           ON CONFLICT (user_id, mode) DO NOTHING
           RETURNING user_id`,
          [row.id, m],
        );
        if (!inserted) {
          logger.error({ botUsername: row.username, userId: row.id, mode: m }, 'CFR bot ratings insert returned null');
        }
        if (inserted && inserted.rows.length > 0) seededRatings++;
      }
    }

    // Step 3: Verify the final state — CFR bots must have BOTH user AND rating rows
    // for them to appear on the leaderboard (which uses INNER JOIN ratings).
    const verifyResult = await query<{ username: string; modes: string }>(
      `SELECT u.username, COUNT(r.mode)::text AS modes
       FROM users u
       LEFT JOIN ratings r ON r.user_id = u.id
       WHERE u.is_bot = true AND u.bot_profile LIKE 'cfr_%'
       GROUP BY u.id, u.username`,
    );

    if (verifyResult) {
      const missing: string[] = [];
      for (const row of verifyResult.rows) {
        const modeCount = parseInt(row.modes, 10);
        if (modeCount < 2) {
          missing.push(`${row.username} (${modeCount}/2 rating modes)`);
        }
      }
      if (missing.length > 0) {
        logger.error(
          { missingRatings: missing },
          'CFR bots still missing ratings after seeding — leaderboard will not show them',
        );
      }
      if (verifyResult.rows.length < CFR_BOTS.length) {
        logger.error(
          { found: verifyResult.rows.length, expected: CFR_BOTS.length },
          'Not all CFR bot users exist in DB after seeding',
        );
      }
    }

    if (seededUsers > 0 || seededRatings > 0) {
      logger.info({ seededUsers, seededRatings }, 'Startup: seeded CFR bot accounts/ratings');
      // Clear the leaderboard cache so freshly-seeded bots appear immediately
      try {
        const { clearLeaderboardCache } = await import('./leaderboard.js');
        clearLeaderboardCache();
      } catch { /* leaderboard module may not be loaded yet */ }
    } else {
      logger.debug('Startup: all CFR bot accounts and ratings verified');
    }
  } catch (err) {
    logger.error({ err }, 'Startup: failed to verify CFR bot accounts — leaderboard may be incomplete');
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
