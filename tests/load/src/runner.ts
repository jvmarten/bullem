#!/usr/bin/env tsx
/**
 * Load test runner — CLI entrypoint.
 *
 * Usage:
 *   npx tsx src/runner.ts --scenario <name> [options]
 *
 * Scenarios:
 *   room-throughput  — Measure room creation/join throughput
 *   full-game        — Simulate concurrent full games with bots
 *   stress           — Ramp up rooms/connections to find limits
 *   all              — Run all scenarios sequentially
 *
 * Options:
 *   --server <url>          Target server (default: http://localhost:3001)
 *   --rooms <n>             Number of rooms (room-throughput & stress)
 *   --concurrency <n>       Concurrent operations (room-throughput)
 *   --games <n>             Concurrent games (full-game)
 *   --players <n>           Players per room/game
 *   --stages <n>            Ramp-up stages (stress)
 *   --max-cards <n>         Max cards setting (1-5)
 *   --bot-speed <speed>     Bot speed: slow|normal|fast
 *   --output <path>         Write JSON report to file
 *   --threshold-p95 <ms>    Fail if room create p95 exceeds this
 *   --threshold-errors <n>  Fail if error rate exceeds this (0-1)
 */

import { run as runRoomThroughput } from './scenarios/room-throughput.js';
import { run as runFullGame } from './scenarios/full-game.js';
import { run as runStress } from './scenarios/stress.js';
import { printReport, writeJsonReport, checkThresholds } from './reporter.js';
import type { ScenarioResult } from './types.js';
import type { ThresholdConfig } from './reporter.js';

function parseArgs(): {
  scenario: string;
  serverUrl: string;
  rooms: number;
  concurrency: number;
  games: number;
  players: number;
  stages: number;
  maxCards: number;
  botSpeed: 'slow' | 'normal' | 'fast';
  output: string | null;
  thresholds: ThresholdConfig;
} {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  return {
    scenario: get('--scenario') ?? 'all',
    serverUrl: get('--server') ?? 'http://localhost:3001',
    rooms: parseInt(get('--rooms') ?? '50', 10),
    concurrency: parseInt(get('--concurrency') ?? '10', 10),
    games: parseInt(get('--games') ?? '10', 10),
    players: parseInt(get('--players') ?? '3', 10),
    stages: parseInt(get('--stages') ?? '5', 10),
    maxCards: parseInt(get('--max-cards') ?? '3', 10),
    botSpeed: (get('--bot-speed') as 'slow' | 'normal' | 'fast') ?? 'fast',
    output: get('--output') ?? null,
    thresholds: {
      maxRoomCreateP95Ms: get('--threshold-p95') ? parseInt(get('--threshold-p95')!, 10) : undefined,
      maxErrorRate: get('--threshold-errors') ? parseFloat(get('--threshold-errors')!) : undefined,
    },
  };
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const results: ScenarioResult[] = [];

  console.log('Bull \'Em Load Testing Suite');
  console.log(`Target: ${opts.serverUrl}`);
  console.log(`Scenario: ${opts.scenario}`);

  // Verify server is reachable
  try {
    const resp = await fetch(`${opts.serverUrl}/health`);
    const health = await resp.json() as { status: string };
    console.log(`Server health: ${health.status}`);
  } catch (err) {
    console.error(`\nERROR: Cannot reach server at ${opts.serverUrl}`);
    console.error('Make sure the server is running: npm run dev\n');
    process.exit(1);
  }

  const scenarios = opts.scenario === 'all'
    ? ['room-throughput', 'full-game', 'stress']
    : [opts.scenario];

  for (const scenario of scenarios) {
    try {
      switch (scenario) {
        case 'room-throughput': {
          const result = await runRoomThroughput({
            serverUrl: opts.serverUrl,
            totalRooms: opts.rooms,
            concurrency: opts.concurrency,
            playersPerRoom: opts.players,
          });
          results.push(result);
          break;
        }
        case 'full-game': {
          const result = await runFullGame({
            serverUrl: opts.serverUrl,
            concurrentGames: opts.games,
            playersPerGame: opts.players,
            maxCards: opts.maxCards,
            botSpeed: opts.botSpeed,
          });
          results.push(result);
          break;
        }
        case 'stress': {
          const result = await runStress({
            serverUrl: opts.serverUrl,
            roomsPerStage: opts.rooms,
            playersPerRoom: opts.players,
            stages: opts.stages,
          });
          results.push(result);
          break;
        }
        default:
          console.error(`Unknown scenario: ${scenario}`);
          process.exit(1);
      }
    } catch (err) {
      console.error(`\nScenario "${scenario}" failed:`, (err as Error).message);
      // Continue with remaining scenarios
    }
  }

  // Print results
  printReport(results);

  // Write JSON report if requested
  if (opts.output) {
    writeJsonReport(results, opts.output);
  }

  // Check thresholds
  const hasThresholds = opts.thresholds.maxRoomCreateP95Ms !== undefined ||
    opts.thresholds.maxErrorRate !== undefined;

  if (hasThresholds) {
    const violations = checkThresholds(results, opts.thresholds);
    if (violations.length > 0) {
      console.log('\nTHRESHOLD VIOLATIONS:');
      for (const v of violations) {
        console.log(`  [${v.scenario}] ${v.metric}: ${v.value} (threshold: ${v.threshold})`);
      }
      process.exit(1);
    }
    console.log('All thresholds passed.');
  }
}

main().catch((err) => {
  console.error('Load test runner failed:', err);
  process.exit(1);
});
