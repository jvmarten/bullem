import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryResult } from 'pg';

// Mock the query function and logger before importing
vi.mock('./index.js', () => ({
  readQuery: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getLeaderboard, getLeaderboardNearby, clearLeaderboardCache } from './leaderboard.js';
import { readQuery } from './index.js';

const mockQuery = vi.mocked(readQuery);

/** Helper to build a pg-like QueryResult. */
function makeResult<T>(rows: T[]): QueryResult<T> {
  return {
    rows,
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
  } as unknown as QueryResult<T>;
}

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const USER_C = '33333333-3333-3333-3333-333333333333';

describe('getLeaderboard', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    clearLeaderboardCache();
  });

  it('returns null when database is unavailable', async () => {
    mockQuery.mockResolvedValue(null);
    const result = await getLeaderboard('heads_up', 'all_time', 50, 0);
    expect(result).toBeNull();
  });

  it('returns correct response shape with ranked entries', async () => {
    // Entries query
    mockQuery.mockResolvedValueOnce(makeResult([
      {
        user_id: USER_A,
        username: 'alice',
        display_name: 'Alice',
        avatar: 'crown',
        rating: '1500',
        games_played: '20',
        rank: '1',
      },
      {
        user_id: USER_B,
        username: 'bob',
        display_name: 'Bob',
        avatar: null,
        rating: '1350',
        games_played: '15',
        rank: '2',
      },
    ]));

    // Count query
    mockQuery.mockResolvedValueOnce(makeResult([{ total: '2' }]));

    const result = await getLeaderboard('heads_up', 'all_time', 50, 0);
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('heads_up');
    expect(result!.period).toBe('all_time');
    expect(result!.totalCount).toBe(2);
    expect(result!.entries).toHaveLength(2);
    expect(result!.currentUser).toBeNull();

    // Verify entry shape
    const first = result!.entries[0]!;
    expect(first.rank).toBe(1);
    expect(first.userId).toBe(USER_A);
    expect(first.username).toBe('alice');
    expect(first.displayName).toBe('Alice');
    expect(first.avatar).toBe('crown');
    expect(first.rating).toBe(1500);
    expect(first.gamesPlayed).toBe(20);
    expect(first.tier).toBe('platinum');
  });

  it('uses ROW_NUMBER rank directly without adding offset (pagination fix)', async () => {
    // ROW_NUMBER() is computed over the full result set before LIMIT/OFFSET,
    // so page 2 (offset=50) should return ranks 51-100, NOT 101-150.
    // Regression test: previously the code added offset to rank, double-counting it.
    mockQuery.mockResolvedValueOnce(makeResult([
      { user_id: USER_A, username: 'a', display_name: 'A', avatar: null, rating: '1400', games_played: '20', rank: '51', is_bot: false },
      { user_id: USER_B, username: 'b', display_name: 'B', avatar: null, rating: '1350', games_played: '15', rank: '52', is_bot: false },
      { user_id: USER_C, username: 'c', display_name: 'C', avatar: null, rating: '1300', games_played: '10', rank: '53', is_bot: false },
    ]));
    mockQuery.mockResolvedValueOnce(makeResult([{ total: '100' }]));

    const result = await getLeaderboard('heads_up', 'all_time', 50, 50);
    expect(result!.entries[0]!.rank).toBe(51);
    expect(result!.entries[1]!.rank).toBe(52);
    expect(result!.entries[2]!.rank).toBe(53);
    // Ranks must NOT be offset+rank (e.g., 101, 102, 103)
    expect(result!.entries[0]!.rank).not.toBe(101);
  });

  it('returns entries in descending rank order', async () => {
    mockQuery.mockResolvedValueOnce(makeResult([
      { user_id: USER_A, username: 'a', display_name: 'A', avatar: null, rating: '1600', games_played: '30', rank: '1' },
      { user_id: USER_B, username: 'b', display_name: 'B', avatar: null, rating: '1400', games_played: '25', rank: '2' },
      { user_id: USER_C, username: 'c', display_name: 'C', avatar: null, rating: '1200', games_played: '10', rank: '3' },
    ]));
    mockQuery.mockResolvedValueOnce(makeResult([{ total: '3' }]));

    const result = await getLeaderboard('heads_up', 'all_time', 50, 0);
    expect(result!.entries[0]!.rating).toBeGreaterThan(result!.entries[1]!.rating);
    expect(result!.entries[1]!.rating).toBeGreaterThan(result!.entries[2]!.rating);
  });

  it('assigns correct rank tiers based on rating', async () => {
    mockQuery.mockResolvedValueOnce(makeResult([
      { user_id: USER_A, username: 'a', display_name: 'A', avatar: null, rating: '1600', games_played: '30', rank: '1' },
      { user_id: USER_B, username: 'b', display_name: 'B', avatar: null, rating: '900', games_played: '25', rank: '2' },
    ]));
    mockQuery.mockResolvedValueOnce(makeResult([{ total: '2' }]));

    const result = await getLeaderboard('heads_up', 'all_time', 50, 0);
    expect(result!.entries[0]!.tier).toBe('diamond');
    expect(result!.entries[1]!.tier).toBe('bronze');
  });

  it('returns empty entries when no players qualify', async () => {
    mockQuery.mockResolvedValueOnce(makeResult([]));
    mockQuery.mockResolvedValueOnce(makeResult([{ total: '0' }]));

    const result = await getLeaderboard('heads_up', 'all_time', 50, 0);
    expect(result!.entries).toHaveLength(0);
    expect(result!.totalCount).toBe(0);
  });

  it('fetches current user rank when userId is provided', async () => {
    // Main entries query
    mockQuery.mockResolvedValueOnce(makeResult([
      { user_id: USER_A, username: 'a', display_name: 'A', avatar: null, rating: '1500', games_played: '20', rank: '1' },
    ]));
    // Count query
    mockQuery.mockResolvedValueOnce(makeResult([{ total: '5' }]));
    // User rank query
    mockQuery.mockResolvedValueOnce(makeResult([
      { user_id: USER_B, username: 'bob', display_name: 'Bob', avatar: null, rating: '1200', games_played: '10', rank: '3' },
    ]));

    const result = await getLeaderboard('heads_up', 'all_time', 50, 0, USER_B);
    expect(result!.currentUser).not.toBeNull();
    expect(result!.currentUser!.userId).toBe(USER_B);
    expect(result!.currentUser!.rank).toBe(3);
    expect(result!.currentUser!.rating).toBe(1200);
  });

  it('uses cached data within TTL window', async () => {
    // First call — cache miss
    mockQuery.mockResolvedValueOnce(makeResult([
      { user_id: USER_A, username: 'a', display_name: 'A', avatar: null, rating: '1500', games_played: '20', rank: '1' },
    ]));
    mockQuery.mockResolvedValueOnce(makeResult([{ total: '1' }]));

    const first = await getLeaderboard('heads_up', 'all_time', 50, 0);
    expect(first).not.toBeNull();

    // Reset mock — second call should use cache
    mockQuery.mockReset();

    const second = await getLeaderboard('heads_up', 'all_time', 50, 0);
    expect(second).not.toBeNull();
    expect(second!.entries).toHaveLength(1);
    // mockQuery should NOT have been called again
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('supports multiplayer mode', async () => {
    mockQuery.mockResolvedValueOnce(makeResult([
      { user_id: USER_A, username: 'a', display_name: 'A', avatar: null, rating: '1200', games_played: '20', rank: '1' },
    ]));
    mockQuery.mockResolvedValueOnce(makeResult([{ total: '1' }]));

    const result = await getLeaderboard('multiplayer', 'all_time', 50, 0);
    expect(result!.mode).toBe('multiplayer');
  });
});

describe('getLeaderboardNearby', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns null when database is unavailable', async () => {
    mockQuery.mockResolvedValue(null);
    const result = await getLeaderboardNearby('heads_up', USER_A);
    expect(result).toBeNull();
  });

  it('returns null when user has no rating', async () => {
    // getUserRank query returns no rows
    mockQuery.mockResolvedValueOnce(makeResult([]));
    const result = await getLeaderboardNearby('heads_up', USER_A);
    expect(result).toBeNull();
  });

  it('returns nearby entries centered on the user', async () => {
    // getUserRank query
    mockQuery.mockResolvedValueOnce(makeResult([
      { user_id: USER_A, username: 'a', display_name: 'A', avatar: null, rating: '1300', games_played: '10', rank: '5' },
    ]));
    // Nearby entries query
    mockQuery.mockResolvedValueOnce(makeResult([
      { user_id: USER_B, username: 'b', display_name: 'B', avatar: null, rating: '1400', games_played: '12', rank: '1' },
      { user_id: USER_A, username: 'a', display_name: 'A', avatar: null, rating: '1300', games_played: '10', rank: '2' },
      { user_id: USER_C, username: 'c', display_name: 'C', avatar: null, rating: '1200', games_played: '8', rank: '3' },
    ]));

    const result = await getLeaderboardNearby('heads_up', USER_A);
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('heads_up');
    expect(result!.currentUser.userId).toBe(USER_A);
    expect(result!.entries.length).toBeGreaterThan(0);
  });
});
