import { describe, it, expect, beforeEach } from 'vitest';
import { SeriesManager } from './SeriesManager.js';
import type { BestOf, SeriesState } from '@bull-em/shared';

describe('SeriesManager', () => {
  let manager: SeriesManager;
  const p1 = 'player-1';
  const p2 = 'player-2';
  const room = 'ABCD';

  beforeEach(() => {
    manager = new SeriesManager();
  });

  // ── startSeries ─────────────────────────────────────────────────────

  describe('startSeries', () => {
    it('returns null for bestOf=1 (no series needed)', () => {
      const result = manager.startSeries(room, [p1, p2], 1 as BestOf);
      expect(result).toBeNull();
    });

    it('creates a Bo3 series with correct initial state', () => {
      const state = manager.startSeries(room, [p1, p2], 3);
      expect(state).not.toBeNull();
      expect(state!.bestOf).toBe(3);
      expect(state!.currentSet).toBe(1);
      expect(state!.wins[p1]).toBe(0);
      expect(state!.wins[p2]).toBe(0);
      expect(state!.winsNeeded).toBe(2);
      expect(state!.seriesWinnerId).toBeNull();
      expect(state!.playerIds).toEqual([p1, p2]);
    });

    it('creates a Bo5 series with winsNeeded=3', () => {
      const state = manager.startSeries(room, [p1, p2], 5);
      expect(state!.winsNeeded).toBe(3);
    });

    it('stores the series so getSeries can retrieve it', () => {
      manager.startSeries(room, [p1, p2], 3);
      const retrieved = manager.getSeries(room);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.bestOf).toBe(3);
    });
  });

  // ── getSeries / getSeriesInfo ───────────────────────────────────────

  describe('getSeries and getSeriesInfo', () => {
    it('returns null for unknown room', () => {
      expect(manager.getSeries('UNKNOWN')).toBeNull();
      expect(manager.getSeriesInfo('UNKNOWN')).toBeNull();
    });

    it('getSeriesInfo returns a copy of wins (not the internal reference)', () => {
      manager.startSeries(room, [p1, p2], 3);
      const info = manager.getSeriesInfo(room);
      info!.wins[p1] = 99;
      // Internal state should not be affected
      const fresh = manager.getSeriesInfo(room);
      expect(fresh!.wins[p1]).toBe(0);
    });

    it('getSeriesInfo includes all expected fields', () => {
      manager.startSeries(room, [p1, p2], 5);
      const info = manager.getSeriesInfo(room);
      expect(info).toEqual({
        bestOf: 5,
        currentSet: 1,
        wins: { [p1]: 0, [p2]: 0 },
        winsNeeded: 3,
        seriesWinnerId: null,
      });
    });
  });

  // ── recordSetWinner ─────────────────────────────────────────────────

  describe('recordSetWinner', () => {
    it('returns null for unknown room', () => {
      expect(manager.recordSetWinner('UNKNOWN', p1)).toBeNull();
    });

    it('returns next_set when series is not yet decided', () => {
      manager.startSeries(room, [p1, p2], 3);
      const result = manager.recordSetWinner(room, p1);
      expect(result).toBe('next_set');
    });

    it('increments currentSet after next_set', () => {
      manager.startSeries(room, [p1, p2], 3);
      manager.recordSetWinner(room, p1);
      const state = manager.getSeries(room);
      expect(state!.currentSet).toBe(2);
    });

    it('returns series_won when a player reaches winsNeeded (Bo3)', () => {
      manager.startSeries(room, [p1, p2], 3);
      manager.recordSetWinner(room, p1); // p1: 1 win
      const result = manager.recordSetWinner(room, p1); // p1: 2 wins
      expect(result).toBe('series_won');
      const state = manager.getSeries(room);
      expect(state!.seriesWinnerId).toBe(p1);
    });

    it('returns series_won when a player reaches winsNeeded (Bo5)', () => {
      manager.startSeries(room, [p1, p2], 5);
      manager.recordSetWinner(room, p2);
      manager.recordSetWinner(room, p2);
      const result = manager.recordSetWinner(room, p2);
      expect(result).toBe('series_won');
      expect(manager.getSeries(room)!.seriesWinnerId).toBe(p2);
    });

    it('tracks alternating wins correctly', () => {
      manager.startSeries(room, [p1, p2], 5);
      manager.recordSetWinner(room, p1); // p1: 1
      manager.recordSetWinner(room, p2); // p2: 1
      manager.recordSetWinner(room, p1); // p1: 2
      manager.recordSetWinner(room, p2); // p2: 2
      const result = manager.recordSetWinner(room, p1); // p1: 3 → wins
      expect(result).toBe('series_won');
      const state = manager.getSeries(room);
      expect(state!.wins[p1]).toBe(3);
      expect(state!.wins[p2]).toBe(2);
    });

    it('tracks win count accurately', () => {
      manager.startSeries(room, [p1, p2], 3);
      manager.recordSetWinner(room, p2);
      const state = manager.getSeries(room);
      expect(state!.wins[p2]).toBe(1);
      expect(state!.wins[p1]).toBe(0);
    });
  });

  // ── forfeitSeries ───────────────────────────────────────────────────

  describe('forfeitSeries', () => {
    it('returns null for unknown room', () => {
      expect(manager.forfeitSeries('UNKNOWN', p1)).toBeNull();
    });

    it('awards win to the other player when p1 forfeits', () => {
      manager.startSeries(room, [p1, p2], 3);
      const winnerId = manager.forfeitSeries(room, p1);
      expect(winnerId).toBe(p2);
      expect(manager.getSeries(room)!.seriesWinnerId).toBe(p2);
    });

    it('awards win to the other player when p2 forfeits', () => {
      manager.startSeries(room, [p1, p2], 3);
      const winnerId = manager.forfeitSeries(room, p2);
      expect(winnerId).toBe(p1);
      expect(manager.getSeries(room)!.seriesWinnerId).toBe(p1);
    });

    it('works even after some sets have been played', () => {
      manager.startSeries(room, [p1, p2], 5);
      manager.recordSetWinner(room, p2); // p2 ahead 1-0
      const winnerId = manager.forfeitSeries(room, p2); // p2 quits anyway
      expect(winnerId).toBe(p1);
    });
  });

  // ── isSeriesInProgress ──────────────────────────────────────────────

  describe('isSeriesInProgress', () => {
    it('returns false for unknown room', () => {
      expect(manager.isSeriesInProgress('UNKNOWN')).toBe(false);
    });

    it('returns true during an active series', () => {
      manager.startSeries(room, [p1, p2], 3);
      expect(manager.isSeriesInProgress(room)).toBe(true);
    });

    it('returns false after series is won', () => {
      manager.startSeries(room, [p1, p2], 3);
      manager.recordSetWinner(room, p1);
      manager.recordSetWinner(room, p1);
      expect(manager.isSeriesInProgress(room)).toBe(false);
    });

    it('returns false after forfeit', () => {
      manager.startSeries(room, [p1, p2], 3);
      manager.forfeitSeries(room, p1);
      expect(manager.isSeriesInProgress(room)).toBe(false);
    });
  });

  // ── deleteSeries ────────────────────────────────────────────────────

  describe('deleteSeries', () => {
    it('removes series state', () => {
      manager.startSeries(room, [p1, p2], 3);
      manager.deleteSeries(room);
      expect(manager.getSeries(room)).toBeNull();
      expect(manager.isSeriesInProgress(room)).toBe(false);
    });

    it('does not crash when deleting non-existent room', () => {
      expect(() => manager.deleteSeries('NOPE')).not.toThrow();
    });
  });

  // ── restoreSeries ───────────────────────────────────────────────────

  describe('restoreSeries', () => {
    it('restores serialized state and makes it retrievable', () => {
      const state: SeriesState = {
        bestOf: 5,
        currentSet: 3,
        wins: { [p1]: 2, [p2]: 1 },
        winsNeeded: 3,
        seriesWinnerId: null,
        playerIds: [p1, p2],
      };
      manager.restoreSeries(room, state);
      expect(manager.getSeries(room)).toEqual(state);
      expect(manager.isSeriesInProgress(room)).toBe(true);
    });

    it('restored series can continue recording wins', () => {
      const state: SeriesState = {
        bestOf: 3,
        currentSet: 2,
        wins: { [p1]: 1, [p2]: 0 },
        winsNeeded: 2,
        seriesWinnerId: null,
        playerIds: [p1, p2],
      };
      manager.restoreSeries(room, state);
      const result = manager.recordSetWinner(room, p1);
      expect(result).toBe('series_won');
    });
  });

  // ── Multiple rooms ──────────────────────────────────────────────────

  describe('multiple rooms', () => {
    it('tracks series independently per room', () => {
      manager.startSeries('ROOM1', [p1, p2], 3);
      manager.startSeries('ROOM2', [p1, p2], 5);

      manager.recordSetWinner('ROOM1', p1);
      expect(manager.getSeries('ROOM1')!.wins[p1]).toBe(1);
      expect(manager.getSeries('ROOM2')!.wins[p1]).toBe(0);
    });

    it('deleting one room does not affect others', () => {
      manager.startSeries('ROOM1', [p1, p2], 3);
      manager.startSeries('ROOM2', [p1, p2], 3);
      manager.deleteSeries('ROOM1');
      expect(manager.getSeries('ROOM1')).toBeNull();
      expect(manager.getSeries('ROOM2')).not.toBeNull();
    });
  });
});
