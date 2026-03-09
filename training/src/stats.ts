import type { PlayerId } from '@bull-em/shared';
import type { GameResult, BatchStats } from './types.js';

/** Collect results from multiple games into aggregate statistics. */
export function computeBatchStats(
  results: GameResult[],
  playerIds: PlayerId[],
  durationMs: number,
): BatchStats {
  const wins: Record<PlayerId, number> = {};
  const winRates: Record<PlayerId, number> = {};

  for (const id of playerIds) {
    wins[id] = 0;
  }

  let totalRounds = 0;
  let totalTurns = 0;

  for (const result of results) {
    const current = wins[result.winnerId];
    if (current !== undefined) {
      wins[result.winnerId] = current + 1;
    }
    totalRounds += result.rounds;
    totalTurns += result.turns;
  }

  const totalGames = results.length;
  for (const id of playerIds) {
    winRates[id] = totalGames > 0 ? wins[id]! / totalGames : 0;
  }

  return {
    totalGames,
    wins,
    winRates,
    avgRounds: totalGames > 0 ? totalRounds / totalGames : 0,
    avgTurns: totalGames > 0 ? totalTurns / totalGames : 0,
    durationMs,
    gamesPerSecond: durationMs > 0 ? (totalGames / durationMs) * 1000 : 0,
  };
}

/** Format batch stats into a human-readable report string. */
export function formatReport(stats: BatchStats, playerNames: Record<PlayerId, string>): string {
  const lines: string[] = [
    '',
    '═══════════════════════════════════════════════',
    '  Bull \'Em Simulation Results',
    '═══════════════════════════════════════════════',
    '',
    `  Games played:      ${stats.totalGames}`,
    `  Avg rounds/game:   ${stats.avgRounds.toFixed(1)}`,
    `  Avg turns/game:    ${stats.avgTurns.toFixed(1)}`,
    `  Duration:          ${(stats.durationMs / 1000).toFixed(2)}s`,
    `  Throughput:        ${stats.gamesPerSecond.toFixed(1)} games/sec`,
    '',
    '  ── Win Rates ──',
    '',
  ];

  // Sort by win rate descending
  const sorted = Object.entries(stats.winRates)
    .sort(([, a], [, b]) => b - a);

  for (const [id, rate] of sorted) {
    const name = playerNames[id] ?? id;
    const wins = stats.wins[id] ?? 0;
    const pct = (rate * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(rate * 30));
    lines.push(`  ${name.padEnd(16)} ${pct.padStart(5)}%  (${String(wins).padStart(5)} wins)  ${bar}`);
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════════');
  lines.push('');

  return lines.join('\n');
}
