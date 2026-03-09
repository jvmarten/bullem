import { query } from './index.js';
import type { AvatarId } from '@bull-em/shared';
import { AVATAR_OPTIONS } from '@bull-em/shared';
import logger from '../logger.js';

/**
 * Look up a user's avatar from the database.
 * Returns the AvatarId if set, or null/undefined if not set or on error.
 */
export async function getUserAvatar(userId: string): Promise<AvatarId | null | undefined> {
  try {
    const result = await query<{ avatar: string | null }>(
      'SELECT avatar FROM users WHERE id = $1',
      [userId],
    );
    if (!result || result.rows.length === 0) return undefined;
    const raw = result.rows[0]!.avatar;
    if (raw === null) return null;
    if ((AVATAR_OPTIONS as readonly string[]).includes(raw)) return raw as AvatarId;
    return undefined;
  } catch (err) {
    logger.error({ err, userId }, 'Failed to fetch user avatar');
    return undefined;
  }
}
