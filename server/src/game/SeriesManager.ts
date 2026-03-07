import type { PlayerId, BestOf, SeriesState, SeriesInfo } from '@bull-em/shared';

/**
 * Manages best-of series state for 1v1 matches.
 *
 * A "match" wraps multiple "sets" (individual games). The match is the unit
 * that gets recorded for ratings, stats, and replays. Elo updates happen
 * once per match completion, not per set.
 */
export class SeriesManager {
  private series = new Map<string, SeriesState>();

  /**
   * Initialize a series for a room. Only applies to 1v1 games with bestOf > 1.
   * Returns the initial SeriesState, or null if no series is needed.
   */
  startSeries(roomCode: string, playerIds: [PlayerId, PlayerId], bestOf: BestOf): SeriesState | null {
    if (bestOf <= 1) return null;

    const state: SeriesState = {
      bestOf,
      currentSet: 1,
      wins: { [playerIds[0]]: 0, [playerIds[1]]: 0 },
      winsNeeded: Math.ceil(bestOf / 2),
      seriesWinnerId: null,
      playerIds,
    };

    this.series.set(roomCode, state);
    return state;
  }

  /** Get the current series state for a room, or null if no series. */
  getSeries(roomCode: string): SeriesState | null {
    return this.series.get(roomCode) ?? null;
  }

  /** Get series info suitable for sending to clients. */
  getSeriesInfo(roomCode: string): SeriesInfo | null {
    const state = this.series.get(roomCode);
    if (!state) return null;

    return {
      bestOf: state.bestOf,
      currentSet: state.currentSet,
      wins: { ...state.wins },
      winsNeeded: state.winsNeeded,
      seriesWinnerId: state.seriesWinnerId,
    };
  }

  /**
   * Record a set winner. Returns:
   * - 'series_won': The series is decided — the winner has enough wins.
   * - 'next_set': The series continues — advance to next set.
   * - null: No series for this room.
   */
  recordSetWinner(roomCode: string, winnerId: PlayerId): 'series_won' | 'next_set' | null {
    const state = this.series.get(roomCode);
    if (!state) return null;

    state.wins[winnerId] = (state.wins[winnerId] ?? 0) + 1;

    if (state.wins[winnerId]! >= state.winsNeeded) {
      state.seriesWinnerId = winnerId;
      return 'series_won';
    }

    state.currentSet++;
    return 'next_set';
  }

  /**
   * Handle a player forfeiting (disconnect/quit) during a series.
   * The other player wins the series.
   */
  forfeitSeries(roomCode: string, forfeitingPlayerId: PlayerId): PlayerId | null {
    const state = this.series.get(roomCode);
    if (!state) return null;

    const winnerId = state.playerIds[0] === forfeitingPlayerId
      ? state.playerIds[1]
      : state.playerIds[0];

    state.seriesWinnerId = winnerId;
    return winnerId;
  }

  /** Check if a series is still in progress (not decided yet). */
  isSeriesInProgress(roomCode: string): boolean {
    const state = this.series.get(roomCode);
    return state !== null && state !== undefined && state.seriesWinnerId === null;
  }

  /** Clean up series state when a room is destroyed. */
  deleteSeries(roomCode: string): void {
    this.series.delete(roomCode);
  }

  /** Restore a series from a serialized state (e.g., from Redis). */
  restoreSeries(roomCode: string, state: SeriesState): void {
    this.series.set(roomCode, state);
  }
}
