import { query } from './index.js';
import logger from '../logger.js';
import type { DeckDrawStats } from '@bull-em/shared';
import { DECK_DRAW_STARTING_BALANCE } from '@bull-em/shared';

interface DeckDrawStatsRow {
  user_id: string;
  total_draws: string;
  total_wagered: string;
  total_won: string;
  biggest_win: string;
  best_hand_type: number | null;
  balance: string;
  last_free_draw_at: string | null;
  hand_counts: Record<string, number>;
}

function rowToStats(row: DeckDrawStatsRow): DeckDrawStats {
  return {
    totalDraws: parseInt(row.total_draws, 10),
    totalWagered: parseInt(row.total_wagered, 10),
    totalWon: parseInt(row.total_won, 10),
    biggestWin: parseInt(row.biggest_win, 10),
    bestHandType: row.best_hand_type,
    balance: parseInt(row.balance, 10),
    lastFreeDrawAt: row.last_free_draw_at,
    handCounts: row.hand_counts,
  };
}

/** Fetch deck draw stats for a user. Creates a default row if none exists. */
export async function getDeckDrawStats(userId: string): Promise<DeckDrawStats | null> {
  const result = await query<DeckDrawStatsRow>(
    `INSERT INTO deck_draw_stats (user_id, balance)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING *`,
    [userId, DECK_DRAW_STARTING_BALANCE],
  );

  if (result && result.rows.length > 0) {
    return rowToStats(result.rows[0]!);
  }

  // Row already existed — fetch it
  const existing = await query<DeckDrawStatsRow>(
    'SELECT * FROM deck_draw_stats WHERE user_id = $1',
    [userId],
  );

  if (!existing || existing.rows.length === 0) return null;
  return rowToStats(existing.rows[0]!);
}

/** Update deck draw stats after a draw. */
export async function updateDeckDrawStats(
  userId: string,
  stats: DeckDrawStats,
): Promise<boolean> {
  const result = await query(
    `UPDATE deck_draw_stats SET
       total_draws = $2,
       total_wagered = $3,
       total_won = $4,
       biggest_win = $5,
       best_hand_type = $6,
       balance = $7,
       last_free_draw_at = $8,
       hand_counts = $9,
       updated_at = NOW()
     WHERE user_id = $1`,
    [
      userId,
      stats.totalDraws,
      stats.totalWagered,
      stats.totalWon,
      stats.biggestWin,
      stats.bestHandType,
      stats.balance,
      stats.lastFreeDrawAt,
      JSON.stringify(stats.handCounts),
    ],
  );

  return result !== null;
}

/** Atomically deduct wager from balance. Returns the new balance, or null if
 *  insufficient funds (prevents TOCTOU race where concurrent requests both
 *  pass the balance check before either deducts). */
export async function atomicDeductBalance(
  userId: string,
  wager: number,
): Promise<number | null> {
  const result = await query<{ balance: string }>(
    `UPDATE deck_draw_stats
     SET balance = balance - $2, updated_at = NOW()
     WHERE user_id = $1 AND balance >= $2
     RETURNING balance`,
    [userId, wager],
  );

  if (!result || result.rows.length === 0) return null;
  return parseInt(result.rows[0]!.balance, 10);
}

/** Atomically add winnings to balance. Returns the new balance, or null if
 *  the row doesn't exist. Prevents TOCTOU race conditions when concurrent
 *  requests both try to add winnings after a wagered draw. */
export async function atomicAddBalance(
  userId: string,
  amount: number,
): Promise<number | null> {
  const result = await query<{ balance: string }>(
    `UPDATE deck_draw_stats
     SET balance = balance + $2, updated_at = NOW()
     WHERE user_id = $1
     RETURNING balance`,
    [userId, amount],
  );

  if (!result || result.rows.length === 0) return null;
  return parseInt(result.rows[0]!.balance, 10);
}

/** Sync guest localStorage stats into a user's DB record.
 *  Merges by taking the maximum of each stat and summing hand counts. */
export async function syncGuestStats(
  userId: string,
  guestStats: DeckDrawStats,
): Promise<DeckDrawStats | null> {
  const current = await getDeckDrawStats(userId);
  if (!current) return null;

  // Merge: take the greater values, sum hand counts
  const mergedHandCounts: Record<number, number> = { ...current.handCounts };
  for (const [key, val] of Object.entries(guestStats.handCounts)) {
    const k = parseInt(key, 10);
    mergedHandCounts[k] = (mergedHandCounts[k] ?? 0) + (val as number);
  }

  const merged: DeckDrawStats = {
    totalDraws: current.totalDraws + guestStats.totalDraws,
    totalWagered: current.totalWagered + guestStats.totalWagered,
    totalWon: current.totalWon + guestStats.totalWon,
    biggestWin: Math.max(current.biggestWin, guestStats.biggestWin),
    bestHandType: current.bestHandType === null ? guestStats.bestHandType
      : guestStats.bestHandType === null ? current.bestHandType
      : Math.max(current.bestHandType, guestStats.bestHandType),
    balance: current.balance + guestStats.balance - DECK_DRAW_STARTING_BALANCE,
    lastFreeDrawAt: current.lastFreeDrawAt && guestStats.lastFreeDrawAt
      ? (new Date(current.lastFreeDrawAt) > new Date(guestStats.lastFreeDrawAt)
        ? current.lastFreeDrawAt : guestStats.lastFreeDrawAt)
      : current.lastFreeDrawAt ?? guestStats.lastFreeDrawAt,
    handCounts: mergedHandCounts,
  };

  const success = await updateDeckDrawStats(userId, merged);
  if (!success) return null;
  return merged;
}
