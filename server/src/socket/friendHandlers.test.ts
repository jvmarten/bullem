import { describe, it, expect, vi, beforeEach } from 'vitest';
import { broadcastStatusChange } from './friendHandlers.js';
import { getAcceptedFriendIds } from '../db/friends.js';

vi.mock('../db/friends.js', () => ({
  getFriendsForUser: vi.fn(),
  sendFriendRequest: vi.fn(),
  respondToFriendRequest: vi.fn(),
  removeFriend: vi.fn(),
  areFriends: vi.fn(),
  getAcceptedFriendIds: vi.fn(),
  getUserBasicInfo: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  getCorrelatedLogger: vi.fn(),
}));

const roomManager = { getRoomForSocket: vi.fn(() => undefined) };

describe('broadcastStatusChange', () => {
  beforeEach(() => {
    vi.mocked(getAcceptedFriendIds).mockReset();
  });

  it('notifies online friends', async () => {
    vi.mocked(getAcceptedFriendIds).mockResolvedValue(['friend-1']);
    const friendSocket = { id: 's1', data: { userId: 'friend-1' }, emit: vi.fn() };
    const strangerSocket = { id: 's2', data: { userId: 'stranger' }, emit: vi.fn() };
    const io = { fetchSockets: vi.fn().mockResolvedValue([friendSocket, strangerSocket]) };

    await broadcastStatusChange(io as never, roomManager as never, 'user-1', false);

    expect(friendSocket.emit).toHaveBeenCalledWith('friends:statusChanged', {
      userId: 'user-1',
      isOnline: false,
      currentRoomCode: null,
    });
    expect(strangerSocket.emit).not.toHaveBeenCalled();
  });

  // Regression: fired without awaiting on connect/disconnect, so a Redis
  // outage rejecting fetchSockets() became an unhandled rejection.
  it('resolves when fetchSockets rejects during a Redis outage', async () => {
    vi.mocked(getAcceptedFriendIds).mockResolvedValue(['friend-1']);
    const io = { fetchSockets: vi.fn().mockRejectedValue(new Error('Reached the max retries per request limit')) };

    await expect(broadcastStatusChange(io as never, roomManager as never, 'user-1', true)).resolves.toBeUndefined();
  });

  it('resolves when the friends query fails', async () => {
    vi.mocked(getAcceptedFriendIds).mockRejectedValue(new Error('connection terminated'));
    const io = { fetchSockets: vi.fn() };

    await expect(broadcastStatusChange(io as never, roomManager as never, 'user-1', true)).resolves.toBeUndefined();
    expect(io.fetchSockets).not.toHaveBeenCalled();
  });
});
