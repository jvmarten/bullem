import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import type { FriendEntry } from '@bull-em/shared';
import { socket } from '../socket.js';
import { useAuth } from './AuthContext.js';
import { useToast } from './ToastContext.js';

export interface FriendsContextValue {
  /** All friends (accepted + pending). */
  friends: FriendEntry[];
  /** Accepted friends only. */
  acceptedFriends: FriendEntry[];
  /** Incoming pending requests. */
  incomingRequests: FriendEntry[];
  /** Outgoing pending requests. */
  outgoingRequests: FriendEntry[];
  /** Count of incoming requests (for badge display). */
  incomingCount: number;
  /** Whether the friends list is being loaded. */
  loading: boolean;
  /** Send a friend request by username. */
  sendRequest: (username: string) => Promise<{ ok: true } | { error: string }>;
  /** Accept or reject a pending friend request. */
  respondToRequest: (friendUserId: string, accept: boolean) => Promise<{ ok: true } | { error: string }>;
  /** Remove a friend. */
  removeFriend: (friendUserId: string) => Promise<{ ok: true } | { error: string }>;
  /** Invite a friend to a room. */
  inviteFriend: (friendUserId: string, roomCode: string) => Promise<{ ok: true } | { error: string }>;
  /** Refresh the friends list from the server. */
  refresh: () => void;
}

const FriendsContext = createContext<FriendsContextValue | null>(null);

export function FriendsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [incomingCount, setIncomingCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchFriends = useCallback(() => {
    if (!user) {
      setFriends([]);
      setIncomingCount(0);
      return;
    }

    setLoading(true);
    socket.emit('friends:list', (response) => {
      setLoading(false);
      if ('error' in response) return;
      setFriends(response.friends);
      setIncomingCount(response.incomingCount);
    });
  }, [user]);

  // Fetch friends when user changes (login/logout)
  useEffect(() => {
    fetchFriends();
  }, [fetchFriends]);

  // Listen for real-time friend events
  useEffect(() => {
    if (!user) return;

    const handleRequestReceived = (from: FriendEntry) => {
      setFriends((prev) => {
        // Avoid duplicates
        if (prev.some((f) => f.userId === from.userId)) return prev;
        return [from, ...prev];
      });
      setIncomingCount((c) => c + 1);
      addToast(`${from.displayName} sent you a friend request`, 'info');
    };

    const handleRequestAccepted = (friend: FriendEntry) => {
      setFriends((prev) =>
        prev.map((f) => (f.userId === friend.userId ? { ...f, status: 'accepted' as const, isOnline: friend.isOnline } : f)),
      );
      addToast(`${friend.displayName} accepted your friend request`, 'success');
    };

    const handleStatusChanged = (data: { userId: string; isOnline: boolean; currentRoomCode?: string | null }) => {
      setFriends((prev) => {
        const idx = prev.findIndex((f) => f.userId === data.userId);
        // If the friend isn't in the list, return the same reference to avoid
        // re-rendering all consumers + recomputing derived memos.
        if (idx === -1) return prev;
        const existing = prev[idx]!;
        const newRoomCode = data.currentRoomCode ?? null;
        // Skip update if nothing actually changed — avoids allocating a new
        // array and triggering downstream re-renders for no-op status events.
        if (existing.isOnline === data.isOnline && existing.currentRoomCode === newRoomCode) {
          return prev;
        }
        const next = [...prev];
        next[idx] = { ...existing, isOnline: data.isOnline, currentRoomCode: newRoomCode };
        return next;
      });
    };

    const handleInvited = (data: { fromUserId: string; fromUsername: string; roomCode: string }) => {
      addToast(`${data.fromUsername} invited you to room ${data.roomCode}`, 'info');
    };

    const handleRoomCreated = (data: { userId: string; username: string; roomCode: string }) => {
      addToast(`${data.username} created a room (${data.roomCode})`, 'info');
    };

    socket.on('friends:requestReceived', handleRequestReceived);
    socket.on('friends:requestAccepted', handleRequestAccepted);
    socket.on('friends:statusChanged', handleStatusChanged);
    socket.on('friends:invited', handleInvited);
    socket.on('friends:roomCreated', handleRoomCreated);

    return () => {
      socket.off('friends:requestReceived', handleRequestReceived);
      socket.off('friends:requestAccepted', handleRequestAccepted);
      socket.off('friends:statusChanged', handleStatusChanged);
      socket.off('friends:invited', handleInvited);
      socket.off('friends:roomCreated', handleRoomCreated);
    };
  }, [user, addToast]);

  const sendRequest = useCallback((username: string): Promise<{ ok: true } | { error: string }> => {
    return new Promise((resolve) => {
      socket.emit('friends:request', { username }, (response) => {
        if ('ok' in response) {
          // Refresh to get the new entry
          fetchFriends();
        }
        resolve(response);
      });
    });
  }, [fetchFriends]);

  const respondToRequest = useCallback((friendUserId: string, accept: boolean): Promise<{ ok: true } | { error: string }> => {
    return new Promise((resolve) => {
      socket.emit('friends:respond', { friendUserId, accept }, (response) => {
        if ('ok' in response) {
          if (accept) {
            setFriends((prev) =>
              prev.map((f) => (f.userId === friendUserId ? { ...f, status: 'accepted' as const } : f)),
            );
          } else {
            setFriends((prev) => prev.filter((f) => f.userId !== friendUserId));
          }
          setIncomingCount((c) => Math.max(0, c - 1));
        }
        resolve(response);
      });
    });
  }, []);

  const removeFriendCb = useCallback((friendUserId: string): Promise<{ ok: true } | { error: string }> => {
    return new Promise((resolve) => {
      socket.emit('friends:remove', { friendUserId }, (response) => {
        if ('ok' in response) {
          setFriends((prev) => prev.filter((f) => f.userId !== friendUserId));
        }
        resolve(response);
      });
    });
  }, []);

  const inviteFriend = useCallback((friendUserId: string, roomCode: string): Promise<{ ok: true } | { error: string }> => {
    return new Promise((resolve) => {
      socket.emit('friends:invite', { friendUserId, roomCode }, resolve);
    });
  }, []);

  const acceptedFriends = useMemo(() => friends.filter((f) => f.status === 'accepted'), [friends]);
  const incomingRequests = useMemo(() => friends.filter((f) => f.status === 'pending' && f.isIncoming), [friends]);
  const outgoingRequests = useMemo(() => friends.filter((f) => f.status === 'pending' && !f.isIncoming), [friends]);

  const value = useMemo<FriendsContextValue>(() => ({
    friends,
    acceptedFriends,
    incomingRequests,
    outgoingRequests,
    incomingCount,
    loading,
    sendRequest,
    respondToRequest,
    removeFriend: removeFriendCb,
    inviteFriend,
    refresh: fetchFriends,
  }), [friends, acceptedFriends, incomingRequests, outgoingRequests, incomingCount, loading, sendRequest, respondToRequest, removeFriendCb, inviteFriend, fetchFriends]);

  return (
    <FriendsContext.Provider value={value}>
      {children}
    </FriendsContext.Provider>
  );
}

export function useFriends(): FriendsContextValue {
  const context = useContext(FriendsContext);
  if (!context) throw new Error('useFriends must be used within FriendsProvider');
  return context;
}
