import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryResult } from 'pg';

// Mock the query function before importing stats module
vi.mock('./index.js', () => ({
  query: vi.fn(),
}));

// Must import after mocking
import { getPlayerStats } from './stats.js';
import { query } from './index.js';

const mockQuery = vi.mocked(query);

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

describe('getPlayerStats', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns null when database is unavailable', async () => {
    mockQuery.mockResolvedValue(null);
    const result = await getPlayerStats(TEST_USER_ID);
    expect(result).toBeNull();
  });

  it('returns zeroed stats for a player with no games', async () => {
    // Aggregation query returns zeros
    mockQuery.mockResolvedValueOnce(makeResult([{
      games_played: '0',
      games_won: '0',
      avg_finish: null,
      total_bulls_called: '0',
      total_correct_bulls: '0',
      total_trues_called: '0',
      total_correct_trues: '0',
      total_calls_made: '0',
      total_bluffs_successful: '0',
    }]));
    // Player count breakdown: empty
    mockQuery.mockResolvedValueOnce(makeResult([]));
    // Recent games: empty
    mockQuery.mockResolvedValueOnce(makeResult([]));

    const result = await getPlayerStats(TEST_USER_ID);
    expect(result).not.toBeNull();
    expect(result!.gamesPlayed).toBe(0);
    expect(result!.wins).toBe(0);
    expect(result!.winRate).toBeNull();
    expect(result!.avgFinishPosition).toBeNull();
    expect(result!.bullAccuracy).toBeNull();
    expect(result!.trueAccuracy).toBeNull();
    expect(result!.bluffSuccessRate).toBeNull();
    expect(result!.gamesByPlayerCount).toEqual({});
    expect(result!.recentGames).toEqual([]);
  });

  it('calculates win rate correctly', async () => {
    mockQuery.mockResolvedValueOnce(makeResult([{
      games_played: '10',
      games_won: '3',
      avg_finish: '2.5',
      total_bulls_called: '0',
      total_correct_bulls: '0',
      total_trues_called: '0',
      total_correct_trues: '0',
      total_calls_made: '0',
      total_bluffs_successful: '0',
    }]));
    mockQuery.mockResolvedValueOnce(makeResult([]));
    mockQuery.mockResolvedValueOnce(makeResult([]));

    const result = await getPlayerStats(TEST_USER_ID);
    expect(result!.winRate).toBe(30); // 3/10 = 30%
    expect(result!.avgFinishPosition).toBe(2.5);
  });

  it('calculates bull accuracy correctly', async () => {
    mockQuery.mockResolvedValueOnce(makeResult([{
      games_played: '5',
      games_won: '2',
      avg_finish: '1.8',
      total_bulls_called: '12',
      total_correct_bulls: '9',
      total_trues_called: '8',
      total_correct_trues: '5',
      total_calls_made: '20',
      total_bluffs_successful: '6',
    }]));
    mockQuery.mockResolvedValueOnce(makeResult([]));
    mockQuery.mockResolvedValueOnce(makeResult([]));

    const result = await getPlayerStats(TEST_USER_ID);
    expect(result!.bullAccuracy).toBe(75);   // 9/12 = 75%
    expect(result!.trueAccuracy).toBe(63);   // 5/8 = 62.5 → rounds to 63%
    expect(result!.bluffSuccessRate).toBe(30); // 6/20 = 30%
  });

  it('returns null accuracy when no bulls/trues called', async () => {
    mockQuery.mockResolvedValueOnce(makeResult([{
      games_played: '2',
      games_won: '1',
      avg_finish: '1.5',
      total_bulls_called: '0',
      total_correct_bulls: '0',
      total_trues_called: '0',
      total_correct_trues: '0',
      total_calls_made: '0',
      total_bluffs_successful: '0',
    }]));
    mockQuery.mockResolvedValueOnce(makeResult([]));
    mockQuery.mockResolvedValueOnce(makeResult([]));

    const result = await getPlayerStats(TEST_USER_ID);
    expect(result!.bullAccuracy).toBeNull();
    expect(result!.trueAccuracy).toBeNull();
    expect(result!.bluffSuccessRate).toBeNull();
  });

  it('returns games-by-player-count breakdown', async () => {
    mockQuery.mockResolvedValueOnce(makeResult([{
      games_played: '6',
      games_won: '2',
      avg_finish: '2.0',
      total_bulls_called: '0',
      total_correct_bulls: '0',
      total_trues_called: '0',
      total_correct_trues: '0',
      total_calls_made: '0',
      total_bluffs_successful: '0',
    }]));
    mockQuery.mockResolvedValueOnce(makeResult([
      { player_count: '2', count: '3' },
      { player_count: '3', count: '2' },
      { player_count: '5', count: '1' },
    ]));
    mockQuery.mockResolvedValueOnce(makeResult([]));

    const result = await getPlayerStats(TEST_USER_ID);
    expect(result!.gamesByPlayerCount).toEqual({
      '2': 3,
      '3': 2,
      '5': 1,
    });
  });

  it('returns recent games in order with correct fields', async () => {
    mockQuery.mockResolvedValueOnce(makeResult([{
      games_played: '2',
      games_won: '1',
      avg_finish: '1.5',
      total_bulls_called: '0',
      total_correct_bulls: '0',
      total_trues_called: '0',
      total_correct_trues: '0',
      total_calls_made: '0',
      total_bluffs_successful: '0',
    }]));
    mockQuery.mockResolvedValueOnce(makeResult([]));
    mockQuery.mockResolvedValueOnce(makeResult([
      {
        id: 'game-1',
        room_code: 'ABC123',
        winner_name: 'Alice',
        player_count: '3',
        settings: { maxCards: 5, turnTimer: 30 },
        started_at: '2026-03-01T10:00:00Z',
        ended_at: '2026-03-01T10:15:00Z',
        duration_seconds: '900',
        finish_position: '1',
        player_name: 'TestPlayer',
        final_card_count: '2',
        stats: {
          bullsCalled: 2,
          truesCalled: 1,
          callsMade: 5,
          correctBulls: 1,
          correctTrues: 1,
          bluffsSuccessful: 3,
          roundsSurvived: 4,
        },
      },
      {
        id: 'game-2',
        room_code: 'DEF456',
        winner_name: 'Bob',
        player_count: '2',
        settings: { maxCards: 5, turnTimer: 30 },
        started_at: '2026-02-28T10:00:00Z',
        ended_at: '2026-02-28T10:05:00Z',
        duration_seconds: '300',
        finish_position: '2',
        player_name: 'TestPlayer',
        final_card_count: '6',
        stats: {
          bullsCalled: 1,
          truesCalled: 0,
          callsMade: 3,
          correctBulls: 0,
          correctTrues: 0,
          bluffsSuccessful: 1,
          roundsSurvived: 2,
        },
      },
    ]));

    const result = await getPlayerStats(TEST_USER_ID);
    expect(result!.recentGames).toHaveLength(2);

    // First game (most recent) is the win
    const first = result!.recentGames[0]!;
    expect(first.id).toBe('game-1');
    expect(first.finishPosition).toBe(1);
    expect(first.playerCount).toBe(3);
    expect(first.durationSeconds).toBe(900);
    expect(first.winnerName).toBe('Alice');

    // Second game is the loss
    const second = result!.recentGames[1]!;
    expect(second.id).toBe('game-2');
    expect(second.finishPosition).toBe(2);
    expect(second.playerCount).toBe(2);
  });

  it('rounds win rate to nearest integer', async () => {
    // 1 win out of 3 games = 33.33...% → should be 33
    mockQuery.mockResolvedValueOnce(makeResult([{
      games_played: '3',
      games_won: '1',
      avg_finish: '2.0',
      total_bulls_called: '3',
      total_correct_bulls: '1',
      total_trues_called: '0',
      total_correct_trues: '0',
      total_calls_made: '0',
      total_bluffs_successful: '0',
    }]));
    mockQuery.mockResolvedValueOnce(makeResult([]));
    mockQuery.mockResolvedValueOnce(makeResult([]));

    const result = await getPlayerStats(TEST_USER_ID);
    expect(result!.winRate).toBe(33);
    expect(result!.bullAccuracy).toBe(33); // 1/3 = 33.33 → 33
  });
});
