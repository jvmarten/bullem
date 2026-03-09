import { BotDifficulty } from '@bull-em/shared';
import type { GameSettings } from '@bull-em/shared';
import { createBotPlayers, runGame } from './gameLoop.js';
import { computeBatchStats, formatReport } from './stats.js';
import type { SimulationConfig, GameResult, BatchStats, BotConfig } from './types.js';

/** Run a batch of headless games and return aggregated statistics.
 *  This is the main entry point for programmatic use. */
export function simulate(config: SimulationConfig): BatchStats {
  const {
    games,
    players: playerCount,
    maxCards,
    difficulty,
    botConfigs: explicitConfigs,
    strategy,
    progressInterval,
  } = config;

  // Build bot configs — use explicit configs or generate defaults
  const botConfigs: BotConfig[] = explicitConfigs ?? Array.from(
    { length: playerCount },
    (_, i) => ({
      id: `bot-${i}`,
      name: `Bot ${i + 1}`,
      difficulty,
    }),
  );

  const players = createBotPlayers(botConfigs);
  const playerIds = players.map(p => p.id);
  const playerNames: Record<string, string> = {};
  for (const p of players) {
    playerNames[p.id] = p.name;
  }

  const settings: GameSettings = {
    maxCards,
    turnTimer: 0, // No timers in headless simulation
    ...config.gameSettings,
  };

  const results: GameResult[] = [];
  const startTime = performance.now();

  for (let i = 0; i < games; i++) {
    const result = runGame(players, settings, botConfigs, strategy, difficulty);
    results.push(result);

    if (progressInterval > 0 && (i + 1) % progressInterval === 0) {
      const elapsed = performance.now() - startTime;
      const rate = ((i + 1) / elapsed) * 1000;
      const pct = (((i + 1) / games) * 100).toFixed(0);
      process.stderr.write(
        `\r  [${pct}%] ${i + 1}/${games} games  |  ${rate.toFixed(0)} games/sec`,
      );
    }
  }

  const durationMs = performance.now() - startTime;

  if (progressInterval > 0 && games > 0) {
    process.stderr.write('\r' + ' '.repeat(70) + '\r'); // Clear progress line
  }

  const stats = computeBatchStats(results, playerIds, durationMs);

  // Print report to stdout
  const report = formatReport(stats, playerNames);
  process.stdout.write(report);

  return stats;
}
