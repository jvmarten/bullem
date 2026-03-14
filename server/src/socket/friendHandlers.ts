import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, FriendEntry, PlayerId } from '@bull-em/shared';
import type { RoomManager } from '../rooms/RoomManager.js';
import type { PushManager } from '../push/PushManager.js';
import { getCorrelatedLogger } from '../logger.js';
import {
  getFriendsForUser,
  sendFriendRequest,
  respondToFriendRequest,
  removeFriend,
  areFriends,
  getAcceptedFriendIds,
  getUserBasicInfo,
} from '../db/friends.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/**
 * Find the socket for a given userId. Returns the first connected socket
 * for that user, or undefined if the user is not connected.
 *
 * TODO(scale): With many instances, io.fetchSockets() queries all instances
 * via the Redis adapter. At very high scale, consider a Redis-backed userId→socketId
 * index instead of scanning all sockets.
 */
async function findSocketByUserId(
  io: TypedServer,
  userId: string,
): Promise<Socket<ClientToServerEvents, ServerToClientEvents> | undefined> {
  const sockets = await io.fetchSockets();
  return sockets.find((s) => s.data.userId === userId) as
    Socket<ClientToServerEvents, ServerToClientEvents> | undefined;
}

/**
 * Enrich friend entries with live online status from connected sockets.
 */
async function enrichWithOnlineStatus(
  io: TypedServer,
  roomManager: RoomManager,
  friends: FriendEntry[],
): Promise<FriendEntry[]> {
  const sockets = await io.fetchSockets();
  const onlineUserIds = new Set<string>();
  const userSocketMap = new Map<string, string>(); // userId → socketId

  for (const s of sockets) {
    if (s.data.userId) {
      onlineUserIds.add(s.data.userId);
      userSocketMap.set(s.data.userId, s.id);
    }
  }

  return friends.map((f) => {
    const isOnline = onlineUserIds.has(f.userId);
    let currentRoomCode: string | null = null;

    // Only show room code for accepted friends who are online
    if (isOnline && f.status === 'accepted') {
      const socketId = userSocketMap.get(f.userId);
      if (socketId) {
        const room = roomManager.getRoomForSocket(socketId);
        if (room) {
          currentRoomCode = room.roomCode;
        }
      }
    }

    return { ...f, isOnline, currentRoomCode };
  });
}

/**
 * Notify a user's accepted friends that their online status changed.
 *
 * Uses a single io.fetchSockets() call (instead of the previous two) and
 * converts friendIds to a Set for O(1) lookup instead of O(m) Array.includes.
 */
async function broadcastStatusChange(
  io: TypedServer,
  roomManager: RoomManager,
  userId: string,
  isOnline: boolean,
): Promise<void> {
  const friendIds = await getAcceptedFriendIds(userId);
  if (friendIds.length === 0) return;

  // Single fetchSockets call — previously called twice (once in
  // findSocketByUserId, once here), doubling network cost with Redis adapter.
  const sockets = await io.fetchSockets();
  const friendIdSet = new Set(friendIds);

  // Determine current room code (if online) from the fetched sockets
  let currentRoomCode: string | null = null;
  if (isOnline) {
    const userSocket = sockets.find(s => s.data.userId === userId);
    if (userSocket) {
      const room = roomManager.getRoomForSocket(userSocket.id);
      if (room) currentRoomCode = room.roomCode;
    }
  }

  // Emit to each online friend — O(1) Set lookup instead of O(m) Array.includes
  for (const s of sockets) {
    if (s.data.userId && friendIdSet.has(s.data.userId)) {
      s.emit('friends:statusChanged', { userId, isOnline, currentRoomCode });
    }
  }
}

export function registerFriendHandlers(
  io: TypedServer,
  socket: TypedSocket,
  roomManager: RoomManager,
  pushManager: PushManager,
): void {
  // ── friends:list ────────────────────────────────────────────────────
  socket.on('friends:list', async (callback) => {
    if (typeof callback !== 'function') return;
    const log = getCorrelatedLogger();
    const userId = socket.data.userId;
    if (!userId) {
      callback({ error: 'Not authenticated' });
      return;
    }

    try {
      const friends = await getFriendsForUser(userId);
      if (!friends) {
        callback({ error: 'Database unavailable' });
        return;
      }

      const enriched = await enrichWithOnlineStatus(io, roomManager, friends);
      const incomingCount = enriched.filter((f) => f.status === 'pending' && f.isIncoming).length;

      callback({ friends: enriched, incomingCount });
    } catch (err) {
      log.error({ err }, 'Failed to fetch friends list');
      callback({ error: 'Failed to fetch friends' });
    }
  });

  // ── friends:request ─────────────────────────────────────────────────
  socket.on('friends:request', async (data, callback) => {
    if (typeof callback !== 'function') return;
    const log = getCorrelatedLogger();
    const userId = socket.data.userId;
    if (!userId) {
      callback({ error: 'Not authenticated' });
      return;
    }

    const username = typeof data?.username === 'string' ? data.username.trim() : '';
    if (!username || username.length > 30) {
      callback({ error: 'Invalid username' });
      return;
    }

    try {
      const result = await sendFriendRequest(userId, username);
      if ('error' in result) {
        callback({ error: result.error });
        return;
      }

      callback({ ok: true });

      // If the request was auto-accepted (because they had a pending request to us),
      // notify the other user that their request was accepted.
      if (result.entry.status === 'accepted') {
        const senderInfo = await getUserBasicInfo(userId);
        if (senderInfo) {
          const friendSocket = await findSocketByUserId(io, result.entry.userId);
          if (friendSocket) {
            friendSocket.emit('friends:requestAccepted', {
              userId: senderInfo.id,
              username: senderInfo.username,
              displayName: senderInfo.displayName,
              avatar: senderInfo.avatar,
              photoUrl: senderInfo.photoUrl,
              status: 'accepted',
              isIncoming: false,
              isOnline: true,
              currentRoomCode: null,
              createdAt: result.entry.createdAt,
            });
          }
        }
      } else {
        // Notify the target user of the incoming request
        const senderInfo = await getUserBasicInfo(userId);
        if (senderInfo) {
          const targetSocket = await findSocketByUserId(io, result.entry.userId);
          if (targetSocket) {
            targetSocket.emit('friends:requestReceived', {
              userId: senderInfo.id,
              username: senderInfo.username,
              displayName: senderInfo.displayName,
              avatar: senderInfo.avatar,
              photoUrl: senderInfo.photoUrl,
              status: 'pending',
              isIncoming: true,
              isOnline: true,
              currentRoomCode: null,
              createdAt: result.entry.createdAt,
            });
          } else {
            // Target is offline — send push notification
            void pushManager.notify(
              result.entry.userId as PlayerId,
              `${senderInfo.displayName || senderInfo.username} sent you a friend request`,
            );
          }
        }
      }
    } catch (err) {
      log.error({ err }, 'Failed to send friend request');
      callback({ error: 'Failed to send friend request' });
    }
  });

  // ── friends:respond ─────────────────────────────────────────────────
  socket.on('friends:respond', async (data, callback) => {
    if (typeof callback !== 'function') return;
    const log = getCorrelatedLogger();
    const userId = socket.data.userId;
    if (!userId) {
      callback({ error: 'Not authenticated' });
      return;
    }

    const friendUserId = typeof data?.friendUserId === 'string' ? data.friendUserId : '';
    if (!friendUserId) {
      callback({ error: 'Invalid friend user ID' });
      return;
    }

    try {
      const result = await respondToFriendRequest(userId, friendUserId, data.accept);
      if ('error' in result) {
        callback({ error: result.error });
        return;
      }

      callback({ ok: true });

      // If accepted, notify the original sender
      if (data.accept) {
        const responderInfo = await getUserBasicInfo(userId);
        if (responderInfo) {
          const senderSocket = await findSocketByUserId(io, friendUserId);
          if (senderSocket) {
            senderSocket.emit('friends:requestAccepted', {
              userId: responderInfo.id,
              username: responderInfo.username,
              displayName: responderInfo.displayName,
              avatar: responderInfo.avatar,
              photoUrl: responderInfo.photoUrl,
              status: 'accepted',
              isIncoming: false,
              isOnline: true,
              currentRoomCode: null,
              createdAt: new Date().toISOString(),
            });
          }
        }
      }
    } catch (err) {
      log.error({ err }, 'Failed to respond to friend request');
      callback({ error: 'Failed to respond to request' });
    }
  });

  // ── friends:remove ──────────────────────────────────────────────────
  socket.on('friends:remove', async (data, callback) => {
    if (typeof callback !== 'function') return;
    const log = getCorrelatedLogger();
    const userId = socket.data.userId;
    if (!userId) {
      callback({ error: 'Not authenticated' });
      return;
    }

    const friendUserId = typeof data?.friendUserId === 'string' ? data.friendUserId : '';
    if (!friendUserId) {
      callback({ error: 'Invalid friend user ID' });
      return;
    }

    try {
      const result = await removeFriend(userId, friendUserId);
      if ('error' in result) {
        callback({ error: result.error });
        return;
      }

      callback({ ok: true });
    } catch (err) {
      log.error({ err }, 'Failed to remove friend');
      callback({ error: 'Failed to remove friend' });
    }
  });

  // ── friends:invite ──────────────────────────────────────────────────
  socket.on('friends:invite', async (data, callback) => {
    if (typeof callback !== 'function') return;
    const log = getCorrelatedLogger();
    const userId = socket.data.userId;
    if (!userId) {
      callback({ error: 'Not authenticated' });
      return;
    }

    const friendUserId = typeof data?.friendUserId === 'string' ? data.friendUserId : '';
    const roomCode = typeof data?.roomCode === 'string' ? data.roomCode : '';
    if (!friendUserId || !roomCode) {
      callback({ error: 'Missing friend user ID or room code' });
      return;
    }

    // Verify friendship exists
    const friends = await areFriends(userId, friendUserId);
    if (!friends) {
      callback({ error: 'Not friends with this user' });
      return;
    }

    // Verify room exists
    const room = roomManager.getRoom(roomCode);
    if (!room) {
      callback({ error: 'Room not found' });
      return;
    }

    try {
      const username = socket.data.username ?? 'Someone';
      const friendSocket = await findSocketByUserId(io, friendUserId);
      if (friendSocket) {
        friendSocket.emit('friends:invited', {
          fromUserId: userId,
          fromUsername: username,
          roomCode,
        });
      } else {
        // Friend is offline — send push notification with room link
        void pushManager.notify(
          friendUserId as PlayerId,
          `${username} invited you to a game!`,
          { roomCode },
        );
      }

      callback({ ok: true });
    } catch (err) {
      log.error({ err }, 'Failed to invite friend');
      callback({ error: 'Failed to send invite' });
    }
  });
}

export { broadcastStatusChange };
