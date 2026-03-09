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

/** Fetch a user's profile photo URL from the database. Returns null if not set or on error. */
export async function getUserPhotoUrl(userId: string): Promise<string | null> {
  try {
    const result = await query<{ photo_url: string | null }>(
      'SELECT photo_url FROM users WHERE id = $1',
      [userId],
    );
    if (!result || result.rows.length === 0) return null;
    return result.rows[0]!.photo_url ?? null;
  } catch (err) {
    logger.error({ err, userId }, 'Failed to fetch user photo URL');
    return null;
  }
}

/** Fetch both avatar and photo URL for a user in a single query. */
export async function getUserAvatarAndPhoto(userId: string): Promise<{ avatar: AvatarId | null | undefined; photoUrl: string | null }> {
  try {
    const result = await query<{ avatar: string | null; photo_url: string | null }>(
      'SELECT avatar, photo_url FROM users WHERE id = $1',
      [userId],
    );
    if (!result || result.rows.length === 0) return { avatar: undefined, photoUrl: null };
    const row = result.rows[0]!;
    const rawAvatar = row.avatar;
    let avatar: AvatarId | null | undefined;
    if (rawAvatar === null) {
      avatar = null;
    } else if ((AVATAR_OPTIONS as readonly string[]).includes(rawAvatar)) {
      avatar = rawAvatar as AvatarId;
    } else {
      avatar = undefined;
    }
    return { avatar, photoUrl: row.photo_url ?? null };
  } catch (err) {
    logger.error({ err, userId }, 'Failed to fetch user avatar and photo');
    return { avatar: undefined, photoUrl: null };
  }
}
