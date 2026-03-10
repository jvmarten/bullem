import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryResult } from 'pg';

// Mock dependencies before importing
vi.mock('./index.js', () => ({
  readQuery: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { getAdvancedStats } from './advancedStats.js';
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

const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';

describe('getAdvancedStats', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns null when database is unavailable', async () => {
    // First query (handBreakdown) returns null → DB unavailable
    mockQuery.mockResolvedValue(null);
    const result = await getAdvancedStats(TEST_USER_ID);
    expect(result).toBeNull();
  });

  it('returns empty data for a new user with no games', async () => {
    // handBreakdown query: empty
    mockQuery.mockResolvedValueOnce(makeResult([]));
    // ratingHistory query: empty
    mockQuery.mockResolvedValueOnce(makeResult([]));
    // performanceByPlayerCount query: empty
    mockQuery.mockResolvedValueOnce(makeResult([]));
    // todaySession query: 0 games
    mockQuery.mockResolvedValueOnce(makeResult([{
      games_played: '0',
      wins: '0',
      total_bulls_called: '0',
      total_correct_bulls: '0',
    }]));
    // opponentRecords query: empty
    mockQuery.mockResolvedValueOnce(makeResult([]));

    const result = await getAdvancedStats(TEST_USER_ID);
    expect(result).not.toBeNull();
    expect(result!.handBreakdown).toEqual([]);
    expect(result!.ratingHistory).toEqual([]);
    expect(result!.performanceByPlayerCount).toEqual([]);
    expect(result!.todaySession).toBeNull();
    expect(result!.opponentRecords).toEqual([]);
  });

  it('handles old JSONB rows missing handBreakdown field gracefully', async () => {
    // Old game records without handBreakdown
    mockQuery.mockResolvedValueOnce(makeResult([
      { stats: { bullsCalled: 5, truesCalled: 2, callsMade: 10, correctBulls: 3, correctTrues: 1, bluffsSuccessful: 4, roundsSurvived: 8 } },
      { stats: null },
      { stats: { bullsCalled: 1, handBreakdown: undefined } },
    ]));
    // ratingHistory: empty
    mockQuery.mockResolvedValueOnce(makeResult([]));
    // performance: empty
    mockQuery.mockResolvedValueOnce(makeResult([]));
    // today: no games
    mockQuery.mockResolvedValueOnce(makeResult([{
      games_played: '0', wins: '0', total_bulls_called: '0', total_correct_bulls: '0',
    }]));
    // opponents: empty
    mockQuery.mockResolvedValueOnce(makeResult([]));

    const result = await getAdvancedStats(TEST_USER_ID);
    expect(result).not.toBeNull();
    // No handBreakdown data in any of the rows → empty array
    expect(result!.handBreakdown).toEqual([]);
  });

  it('aggregates handBreakdown across multiple games', async () => {
    mockQuery.mockResolvedValueOnce(makeResult([
      {
        stats: {
          bullsCalled: 2, truesCalled: 1, callsMade: 5,
          correctBulls: 1, correctTrues: 1, bluffsSuccessful: 3, roundsSurvived: 4,
          handBreakdown: [
            { handType: 1, called: 3, existed: 2 },
            { handType: 4, called: 1, existed: 0 },
          ],
        },
      },
      {
        stats: {
          bullsCalled: 1, truesCalled: 0, callsMade: 3,
          correctBulls: 0, correctTrues: 0, bluffsSuccessful: 1, roundsSurvived: 2,
          handBreakdown: [
            { handType: 1, called: 2, existed: 1 },
            { handType: 5, called: 1, existed: 1 },
          ],
        },
      },
    ]));
    // ratingHistory: empty
    mockQuery.mockResolvedValueOnce(makeResult([]));
    // performance: empty
    mockQuery.mockResolvedValueOnce(makeResult([]));
    // today: no games
    mockQuery.mockResolvedValueOnce(makeResult([{
      games_played: '0', wins: '0', total_bulls_called: '0', total_correct_bulls: '0',
    }]));
    // opponents: empty
    mockQuery.mockResolvedValueOnce(makeResult([]));

    const result = await getAdvancedStats(TEST_USER_ID);
    expect(result).not.toBeNull();

    // HandType 1 (Pair): 3+2=5 called, 2+1=3 existed
    const pair = result!.handBreakdown.find(b => b.handType === 1);
    expect(pair).toBeDefined();
    expect(pair!.timesCalled).toBe(5);
    expect(pair!.timesExisted).toBe(3);

    // HandType 4 (Three of a Kind): 1 called, 0 existed
    const threeKind = result!.handBreakdown.find(b => b.handType === 4);
    expect(threeKind).toBeDefined();
    expect(threeKind!.timesCalled).toBe(1);
    expect(threeKind!.timesExisted).toBe(0);

    // HandType 5 (Straight): 1 called, 1 existed
    const straight = result!.handBreakdown.find(b => b.handType === 5);
    expect(straight).toBeDefined();
    expect(straight!.timesCalled).toBe(1);
    expect(straight!.timesExisted).toBe(1);
  });

  it('returns rating history in chronological order', async () => {
    // handBreakdown: empty
    mockQuery.mockResolvedValueOnce(makeResult([]));
    // ratingHistory: 3 entries
    mockQuery.mockResolvedValueOnce(makeResult([
      { game_id: 'g1', mode: 'heads_up', rating_before: '1200', rating_after: '1216', created_at: '2026-03-01T10:00:00Z' },
      { game_id: 'g2', mode: 'heads_up', rating_before: '1216', rating_after: '1230', created_at: '2026-03-02T10:00:00Z' },
      { game_id: 'g3', mode: 'heads_up', rating_before: '1230', rating_after: '1215', created_at: '2026-03-03T10:00:00Z' },
    ]));
    // performance: empty
    mockQuery.mockResolvedValueOnce(makeResult([]));
    // today: no games
    mockQuery.mockResolvedValueOnce(makeResult([{
      games_played: '0', wins: '0', total_bulls_called: '0', total_correct_bulls: '0',
    }]));
    // opponents: empty
    mockQuery.mockResolvedValueOnce(makeResult([]));

    const result = await getAdvancedStats(TEST_USER_ID);
    expect(result).not.toBeNull();
    expect(result!.ratingHistory).toHaveLength(3);

    // Should be in chronological order (ASC by created_at)
    expect(result!.ratingHistory[0]!.gameId).toBe('g1');
    expect(result!.ratingHistory[1]!.gameId).toBe('g2');
    expect(result!.ratingHistory[2]!.gameId).toBe('g3');

    // Check delta calculation
    expect(result!.ratingHistory[0]!.delta).toBe(16);
    expect(result!.ratingHistory[2]!.delta).toBe(-15);
  });
});
