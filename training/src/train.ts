#!/usr/bin/env node

/**
 * CLI entry point for CFR self-play training.
 *
 * Usage:
 *   npm run train -w training -- --iterations 100000
 *   npx tsx training/src/train.ts --iterations 50000 --players 4 --resume
 */

import type { JokerCount, LastChanceMode } from '@bull-em/shared';
import {
  trainCFR, resumeTraining,
  saveCheckpoint, exportStrategy, exportStrategiesByPlayerCount,
  findLatestCheckpoint, loadCheckpoint,
  CFREngine,
  type ProgressMetrics,
} from './cfr/index.js';

function parseArgs(argv: string[]): {
  iterations: number;
  players: number | number[];
  maxCards: number;
  jokerCount: JokerCount;
  lastChanceMode: LastChanceMode;
  mixConfigs: boolean;
  progressInterval: number;
  checkpointInterval: number;
  resume: boolean;
  checkpointFile: string | null;
  strategyName: string | null;
} {
  const args = argv.slice(2);
  let iterations = 500_000;
  // Weight multiplayer games more heavily — the info set space is larger
  // and multiplayer dynamics (bull/true voting chains) need more samples
  // to converge. 2P is well-served by fewer samples since it's simpler.
  // With coarsened abstraction (~5-10K info sets), 500K iterations gives
  // ~50-100 visits per info set — enough for reasonable convergence.
  // Heavy heads-up weighting: endgame is where matches are decided.
  // Also balanced distribution including large games for p5+ coverage.
  let players: number | number[] = [2, 2, 2, 2, 3, 3, 3, 4, 4, 5, 5, 6, 6, 7, 8, 9];
  let maxCards = 5;
  let jokerCount: JokerCount = 0;
  let lastChanceMode: LastChanceMode = 'classic';
  let mixConfigs = false;
  let progressInterval = 1000;
  let checkpointInterval = 100_000;
  let resume = false;
  let checkpointFile: string | null = null;
  let strategyName: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--iterations':
      case '-i':
        iterations = parseInt(next ?? '', 10);
        if (isNaN(iterations) || iterations < 1) {
          console.error('Error: --iterations must be a positive integer');
          process.exit(1);
        }
        i++;
        break;
      case '--players':
      case '-p': {
        const val = next ?? '';
        if (val.includes(',')) {
          // Comma-separated list: --players 2,3,4,6
          const parsed = val.split(',').map(s => parseInt(s.trim(), 10));
          if (parsed.some(n => isNaN(n) || n < 2 || n > 12)) {
            console.error('Error: --players values must be between 2 and 12 (e.g. --players 2,3,4,6)');
            process.exit(1);
          }
          players = parsed;
        } else {
          const n = parseInt(val, 10);
          if (isNaN(n) || n < 2 || n > 12) {
            console.error('Error: --players must be between 2 and 12');
            process.exit(1);
          }
          players = n;
        }
        i++;
        break;
      }
      case '--max-cards':
      case '-m':
        maxCards = parseInt(next ?? '', 10);
        if (isNaN(maxCards) || maxCards < 1 || maxCards > 5) {
          console.error('Error: --max-cards must be between 1 and 5');
          process.exit(1);
        }
        i++;
        break;
      case '--progress':
        progressInterval = parseInt(next ?? '', 10);
        if (isNaN(progressInterval) || progressInterval < 0) {
          console.error('Error: --progress must be a non-negative integer');
          process.exit(1);
        }
        i++;
        break;
      case '--checkpoint-interval':
        checkpointInterval = parseInt(next ?? '', 10);
        if (isNaN(checkpointInterval) || checkpointInterval < 0) {
          console.error('Error: --checkpoint-interval must be a non-negative integer');
          process.exit(1);
        }
        i++;
        break;
      case '--resume':
        resume = true;
        break;
      case '--from-checkpoint':
        checkpointFile = next ?? null;
        if (!checkpointFile) {
          console.error('Error: --from-checkpoint requires a file path');
          process.exit(1);
        }
        i++;
        break;
      case '--jokers':
      case '-j': {
        const jc = parseInt(next ?? '', 10);
        if (isNaN(jc) || (jc !== 0 && jc !== 1 && jc !== 2)) {
          console.error('Error: --jokers must be 0, 1, or 2');
          process.exit(1);
        }
        jokerCount = jc as JokerCount;
        i++;
        break;
      }
      case '--last-chance-mode':
      case '--lcm': {
        const val = (next ?? '').toLowerCase();
        if (val !== 'classic' && val !== 'strict') {
          console.error('Error: --last-chance-mode must be "classic" or "strict"');
          process.exit(1);
        }
        lastChanceMode = val;
        i++;
        break;
      }
      case '--mix-configs':
        mixConfigs = true;
        break;
      case '--strategy-name':
        strategyName = next ?? null;
        if (!strategyName) {
          console.error('Error: --strategy-name requires a name');
          process.exit(1);
        }
        i++;
        break;
      case '--help':
      case '-h':
        console.log(`
Bull 'Em CFR Training

Usage:
  npm run train -w training -- [options]
  npx tsx training/src/train.ts [options]

Options:
  --iterations, -i <n>       Number of self-play iterations (default: 500000)
  --players, -p <n|list>     Players per game: single number or comma-separated
                             (default: 2,3,4,5,6 — mixed training)
  --max-cards, -m <n>        Max cards before elimination (default: 5, range: 1-5)
  --jokers, -j <n>           Jokers in deck: 0, 1, or 2 (default: 0)
  --last-chance-mode <mode>  Last chance raise mode: classic or strict (default: classic)
  --mix-configs              Randomly mix joker/LCR settings each iteration
  --progress <n>             Log progress every N iterations (default: 1000)
  --checkpoint-interval <n>  Save checkpoint every N iterations (default: 100000)
  --resume                   Resume from latest checkpoint
  --from-checkpoint <path>   Resume from a specific checkpoint file
  --strategy-name <name>     Custom name for the exported strategy file
  --help, -h                 Show this help message

Examples:
  npm run train -w training -- --iterations 100000
  npm run train -w training -- -i 50000 -p 2 --resume
  npx tsx training/src/train.ts -i 1000000 --checkpoint-interval 50000
`);
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}. Use --help for usage.`);
        process.exit(1);
    }
  }

  // Validate player/card combo (account for jokers expanding deck size)
  const deckSize = 52 + jokerCount;
  const maxPlayersForCards = Math.floor(deckSize / maxCards);
  const playerCounts = typeof players === 'number' ? [players] : players;
  for (const p of playerCounts) {
    if (p > maxPlayersForCards) {
      console.error(
        `Error: ${p} players with max ${maxCards} cards exceeds deck size (${deckSize}). ` +
        `Max players for ${maxCards} cards: ${maxPlayersForCards}`,
      );
      process.exit(1);
    }
  }

  return { iterations, players, maxCards, jokerCount, lastChanceMode, mixConfigs, progressInterval, checkpointInterval, resume, checkpointFile, strategyName };
}

const config = parseArgs(process.argv);

// ── Resolve starting point ──────────────────────────────────────────────

let existingEngine: CFREngine | null = null;

if (config.checkpointFile) {
  console.log(`Loading checkpoint: ${config.checkpointFile}`);
  existingEngine = loadCheckpoint(config.checkpointFile);
  console.log(`  Resuming from iteration ${existingEngine.iterations} (${existingEngine.nodeCount} info sets)`);
} else if (config.resume) {
  const latest = findLatestCheckpoint();
  if (latest) {
    console.log(`Resuming from latest checkpoint: ${latest}`);
    existingEngine = loadCheckpoint(latest);
    console.log(`  Starting at iteration ${existingEngine.iterations} (${existingEngine.nodeCount} info sets)`);
  } else {
    console.log('No checkpoint found — starting fresh training.');
  }
}

// ── Progress handler ────────────────────────────────────────────────────

function onProgress(metrics: ProgressMetrics): void {
  const pct = ((metrics.iteration / metrics.totalIterations) * 100).toFixed(1);
  const avgRegret = metrics.avgRegretPerIteration.toFixed(4);
  const rate = metrics.gamesPerSecond.toFixed(0);
  const elapsed = (metrics.elapsedMs / 1000).toFixed(1);

  process.stderr.write(
    `\r  [${pct}%] iter ${metrics.iteration}/${metrics.totalIterations}` +
    `  |  ${metrics.infoSets} info sets` +
    `  |  avg regret: ${avgRegret}` +
    `  |  ${rate} games/sec` +
    `  |  ${elapsed}s`,
  );
}

// ── Checkpoint handler ──────────────────────────────────────────────────

function onCheckpoint(engine: CFREngine, iteration: number): void {
  const filepath = saveCheckpoint(engine);
  process.stderr.write(`\n  Checkpoint saved: ${filepath}\n`);
}

// ── Run training ────────────────────────────────────────────────────────

const playerDesc = typeof config.players === 'number'
  ? `${config.players} players`
  : `mixed [${config.players.join(',')}] players`;
const configDesc = config.mixConfigs
  ? 'mixed configs (jokers 0/1/2, LCR classic/strict)'
  : `${config.jokerCount} jokers, ${config.lastChanceMode} LCR`;
console.log(
  `\nCFR Training: ${config.iterations} iterations, ${playerDesc}, ` +
  `max ${config.maxCards} cards, ${configDesc}\n`,
);

const result = existingEngine
  ? resumeTraining(existingEngine, {
      ...config,
      onProgress,
      onCheckpoint,
    })
  : trainCFR({
      ...config,
      onProgress,
      onCheckpoint,
    });

// Clear progress line
process.stderr.write('\r' + ' '.repeat(100) + '\r');

// ── Results ─────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════');
console.log("  Bull 'Em CFR Training Complete");
console.log('═══════════════════════════════════════════════\n');
console.log(`  Total iterations:    ${result.totalIterations}`);
console.log(`  Games played:        ${result.totalGames}`);
console.log(`  Unique info sets:    ${result.infoSetCount}`);
console.log(`  Avg regret/iter:     ${result.finalAvgRegret.toFixed(6)}`);
console.log(`  Duration:            ${(result.durationMs / 1000).toFixed(2)}s`);
console.log(`  Throughput:          ${(result.totalGames / (result.durationMs / 1000)).toFixed(1)} games/sec`);

// Save final checkpoint
const checkpointPath = saveCheckpoint(result.engine);
console.log(`\n  Final checkpoint:    ${checkpointPath}`);

// Export combined strategy
const strategyPath = exportStrategy(result.engine, config.strategyName ?? undefined);
console.log(`  Strategy exported:   ${strategyPath}`);

// Export per-player-count strategies
const perPlayerPaths = exportStrategiesByPlayerCount(result.engine);
console.log(`\n  Per-player-count strategies:`);
for (const [bucket, filepath] of [...perPlayerPaths].sort(([a], [b]) => a.localeCompare(b))) {
  const strategy = result.engine.exportStrategiesByPlayerCount().get(bucket);
  const count = strategy ? strategy.infoSetCount : 0;
  console.log(`    ${bucket}: ${filepath} (${count} info sets)`);
}

// Strategy summary
const exported = result.engine.exportStrategy();
console.log(`\n  Total strategy size: ${Object.keys(exported.strategy).length} info sets`);
const strategyJson = JSON.stringify(exported);
console.log(`  File size:           ${(Buffer.byteLength(strategyJson) / 1024).toFixed(1)} KB`);

console.log('\n═══════════════════════════════════════════════\n');
