import { query, readQuery } from './index.js';
import type { FriendEntry, FriendshipStatus, AvatarId } from '@bull-em/shared';
import { AVATAR_OPTIONS } from '@bull-em/shared';
import logger from '../logger.js';

/** Sanitize a raw avatar string from the DB into a typed AvatarId or null. */
function toAvatarId(raw: string | null): AvatarId | null {
  if (raw === null) return null;
  if ((AVATAR_OPTIONS as readonly string[]).includes(raw)) return raw as AvatarId;
  return null;
}

interface FriendRow {
  id: string;
  user_id: string;
  friend_id: string;
  status: FriendshipStatus;
  created_at: string;
  updated_at: string;
  // Joined from users table
  other_user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  photo_url: string | null;
  is_incoming: boolean;
}

/**
 * Get all friends/requests for a user (both directions).
 * Returns accepted friends, incoming requests, and outgoing requests.
 * Does NOT return blocked entries to the requesting user's friend list.
 */
export async function getFriendsForUser(userId: string): Promise<FriendEntry[] | null> {
  // Query both directions: where user is the sender and where user is the target.
  // Excludes blocked relationships from the friend list.
  const result = await readQuery<FriendRow>(
    `SELECT
       f.id, f.user_id, f.friend_id, f.status, f.created_at, f.updated_at,
       u.id AS other_user_id, u.username, u.display_name, u.avatar, u.photo_url,
       (f.friend_id != $1) AS is_incoming
     FROM friends f
     JOIN users u ON u.id = CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
     WHERE (f.user_id = $1 OR f.friend_id = $1)
       AND f.status != 'blocked'
     ORDER BY f.status ASC, f.updated_at DESC`,
    [userId],
  );

  if (!result) return null;

  return result.rows.map((row) => ({
    userId: row.other_user_id,
    username: row.username,
    displayName: row.display_name,
    avatar: toAvatarId(row.avatar),
    photoUrl: row.photo_url,
    status: row.status,
    // is_incoming: true means the current user is the friend_id (they received the request)
    // The SQL returns (f.friend_id != $1) which is true when user_id = $1 (user sent it),
    // so we need to invert: incoming = user is NOT the sender
    isIncoming: !row.is_incoming,
    isOnline: false, // Populated by the caller with live socket data
    currentRoomCode: null,
    createdAt: row.created_at,
  }));
}

/**
 * Send a friend request from senderId to a user identified by username.
 * Returns the created FriendEntry or an error string.
 */
export async function sendFriendRequest(
  senderId: string,
  targetUsername: string,
): Promise<{ entry: FriendEntry } | { error: string }> {
  // Look up target by username (case-insensitive)
  const userResult = await query<{
    id: string; username: string; display_name: string;
    avatar: string | null; photo_url: string | null;
  }>(
    'SELECT id, username, display_name, avatar, photo_url FROM users WHERE LOWER(username) = LOWER($1)',
    [targetUsername],
  );

  if (!userResult || userResult.rows.length === 0) {
    return { error: 'User not found' };
  }

  const target = userResult.rows[0]!;

  if (target.id === senderId) {
    return { error: 'You cannot add yourself as a friend' };
  }

  // Check if a relationship already exists in either direction
  const existing = await query<{ user_id: string; friend_id: string; status: string }>(
    `SELECT user_id, friend_id, status FROM friends
     WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
    [senderId, target.id],
  );

  if (existing && existing.rows.length > 0) {
    const row = existing.rows[0]!;
    if (row.status === 'accepted') {
      return { error: 'Already friends' };
    }
    if (row.status === 'blocked') {
      return { error: 'Unable to send friend request' };
    }
    if (row.status === 'pending') {
      // If the other user sent us a request, auto-accept
      if (row.user_id === target.id) {
        const updated = await query(
          `UPDATE friends SET status = 'accepted', updated_at = NOW()
           WHERE user_id = $1 AND friend_id = $2`,
          [target.id, senderId],
        );
        if (!updated) return { error: 'Database unavailable' };

        return {
          entry: {
            userId: target.id,
            username: target.username,
            displayName: target.display_name,
            avatar: toAvatarId(target.avatar),
            photoUrl: target.photo_url,
            status: 'accepted',
            isIncoming: false,
            isOnline: false,
            currentRoomCode: null,
            createdAt: new Date().toISOString(),
          },
        };
      }
      // We already sent a request
      return { error: 'Friend request already sent' };
    }
  }

  // Insert new pending request
  const insertResult = await query<{ created_at: string }>(
    `INSERT INTO friends (user_id, friend_id, status)
     VALUES ($1, $2, 'pending')
     RETURNING created_at`,
    [senderId, target.id],
  );

  if (!insertResult || insertResult.rows.length === 0) {
    return { error: 'Database unavailable' };
  }

  return {
    entry: {
      userId: target.id,
      username: target.username,
      displayName: target.display_name,
      avatar: toAvatarId(target.avatar),
      photoUrl: target.photo_url,
      status: 'pending',
      isIncoming: false,
      isOnline: false,
      currentRoomCode: null,
      createdAt: insertResult.rows[0]!.created_at,
    },
  };
}

/**
 * Accept or reject a pending friend request.
 * The responderId must be the target of the original request (friend_id).
 */
export async function respondToFriendRequest(
  responderId: string,
  senderUserId: string,
  accept: boolean,
): Promise<{ ok: true } | { error: string }> {
  if (accept) {
    const result = await query(
      `UPDATE friends SET status = 'accepted', updated_at = NOW()
       WHERE user_id = $1 AND friend_id = $2 AND status = 'pending'`,
      [senderUserId, responderId],
    );
    if (!result) return { error: 'Database unavailable' };
    if (result.rowCount === 0) return { error: 'No pending request found' };
    return { ok: true };
  } else {
    // Reject = delete the pending row
    const result = await query(
      `DELETE FROM friends
       WHERE user_id = $1 AND friend_id = $2 AND status = 'pending'`,
      [senderUserId, responderId],
    );
    if (!result) return { error: 'Database unavailable' };
    if (result.rowCount === 0) return { error: 'No pending request found' };
    return { ok: true };
  }
}

/**
 * Remove an existing friendship (accepted or pending, in either direction).
 */
export async function removeFriend(
  userId: string,
  friendUserId: string,
): Promise<{ ok: true } | { error: string }> {
  const result = await query(
    `DELETE FROM friends
     WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
       AND status != 'blocked'`,
    [userId, friendUserId],
  );
  if (!result) return { error: 'Database unavailable' };
  if (result.rowCount === 0) return { error: 'Friend not found' };
  return { ok: true };
}

/**
 * Check if two users are accepted friends.
 */
export async function areFriends(userIdA: string, userIdB: string): Promise<boolean> {
  const result = await readQuery<{ status: string }>(
    `SELECT status FROM friends
     WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
       AND status = 'accepted'`,
    [userIdA, userIdB],
  );
  return result !== null && result.rows.length > 0;
}

/**
 * Get the user IDs of all accepted friends for a user.
 * Used for broadcasting online status changes.
 */
export async function getAcceptedFriendIds(userId: string): Promise<string[]> {
  const result = await readQuery<{ other_id: string }>(
    `SELECT CASE WHEN user_id = $1 THEN friend_id ELSE user_id END AS other_id
     FROM friends
     WHERE (user_id = $1 OR friend_id = $1) AND status = 'accepted'`,
    [userId],
  );
  if (!result) return [];
  return result.rows.map((r) => r.other_id);
}

/**
 * Get the count of incoming pending friend requests for a user.
 */
export async function getIncomingRequestCount(userId: string): Promise<number> {
  const result = await readQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM friends
     WHERE friend_id = $1 AND status = 'pending'`,
    [userId],
  );
  if (!result || result.rows.length === 0) return 0;
  return parseInt(result.rows[0]!.count, 10);
}

/**
 * Look up a user's basic info by their user ID. Used for building friend
 * notification payloads when we only have IDs.
 */
export async function getUserBasicInfo(userId: string): Promise<{
  id: string;
  username: string;
  displayName: string;
  avatar: AvatarId | null;
  photoUrl: string | null;
} | null> {
  try {
    const result = await readQuery<{
      id: string; username: string; display_name: string;
      avatar: string | null; photo_url: string | null;
    }>(
      'SELECT id, username, display_name, avatar, photo_url FROM users WHERE id = $1',
      [userId],
    );
    if (!result || result.rows.length === 0) return null;
    const row = result.rows[0]!;
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatar: toAvatarId(row.avatar),
      photoUrl: row.photo_url,
    };
  } catch (err) {
    logger.error({ err, userId }, 'Failed to fetch user basic info');
    return null;
  }
}
