#!/usr/bin/env node

/**
 * CLI entry point for 5 Draw CFR training.
 *
 * Usage:
 *   npm run train-five-draw -w training -- --iterations 200000
 *   npx tsx training/src/trainFiveDraw.ts --iterations 100000 --resume
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  trainFiveDrawCFR,
  resumeFiveDrawTraining,
  type FiveDrawProgressMetrics,
} from './cfr/fiveDrawTraining.js';
import { CFREngine } from './cfr/cfrEngine.js';

const TRAINING_ROOT = path.resolve(import.meta.dirname, '..');
const CHECKPOINTS_DIR = path.join(TRAINING_ROOT, 'checkpoints');
const STRATEGIES_DIR = path.join(TRAINING_ROOT, 'strategies');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function saveFiveDrawCheckpoint(engine: CFREngine, label?: string): string {
  ensureDir(CHECKPOINTS_DIR);
  const filename = label
    ? `five-draw-checkpoint-${label}.json`
    : `five-draw-checkpoint-${engine.iterations}.json`;
  const filepath = path.join(CHECKPOINTS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(engine.toState()), 'utf-8');
  return filepath;
}

function findLatestFiveDrawCheckpoint(): string | null {
  if (!fs.existsSync(CHECKPOINTS_DIR)) return null;
  const files = fs.readdirSync(CHECKPOINTS_DIR)
    .filter(f => f.startsWith('five-draw-checkpoint-') && f.endsWith('.json'))
    .sort();
  if (files.length === 0) return null;
  return path.join(CHECKPOINTS_DIR, files[files.length - 1]!);
}

function loadCheckpoint(filepath: string): CFREngine {
  const raw = fs.readFileSync(filepath, 'utf-8');
  const state = JSON.parse(raw);
  const engine = new CFREngine();
  engine.fromState(state);
  return engine;
}

function exportFiveDrawStrategy(engine: CFREngine, name?: string): string {
  ensureDir(STRATEGIES_DIR);
  const strategy = engine.exportCurrentStrategy();
  const filename = name
    ? `${name}.json`
    : `five-draw-strategy-${engine.iterations}.json`;
  const filepath = path.join(STRATEGIES_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(strategy), 'utf-8');
  return filepath;
}

// ── Parse CLI args ──────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  iterations: number;
  progressInterval: number;
  checkpointInterval: number;
  resume: boolean;
  checkpointFile: string | null;
  strategyName: string | null;
} {
  const args = argv.slice(2);
  let iterations = 200_000;
  let progressInterval = 5000;
  let checkpointInterval = 50_000;
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
      case '--progress':
        progressInterval = parseInt(next ?? '', 10);
        i++;
        break;
      case '--checkpoint-interval':
        checkpointInterval = parseInt(next ?? '', 10);
        i++;
        break;
      case '--resume':
        resume = true;
        break;
      case '--from-checkpoint':
        checkpointFile = next ?? null;
        i++;
        break;
      case '--strategy-name':
        strategyName = next ?? null;
        i++;
        break;
      case '--help':
      case '-h':
        console.log(`
5 Draw CFR Training

Usage:
  npm run train-five-draw -w training -- [options]

Options:
  --iterations, -i <n>       Number of self-play iterations (default: 200000)
  --progress <n>             Log progress every N iterations (default: 5000)
  --checkpoint-interval <n>  Save checkpoint every N iterations (default: 50000)
  --resume                   Resume from latest 5 Draw checkpoint
  --from-checkpoint <path>   Resume from a specific checkpoint file
  --strategy-name <name>     Custom name for the exported strategy file
  --help, -h                 Show this help message
`);
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}. Use --help for usage.`);
        process.exit(1);
    }
  }

  return { iterations, progressInterval, checkpointInterval, resume, checkpointFile, strategyName };
}

const config = parseArgs(process.argv);

// ── Resolve starting point ──────────────────────────────────────────

let existingEngine: CFREngine | null = null;

if (config.checkpointFile) {
  console.log(`Loading checkpoint: ${config.checkpointFile}`);
  existingEngine = loadCheckpoint(config.checkpointFile);
  console.log(`  Resuming from iteration ${existingEngine.iterations} (${existingEngine.nodeCount} info sets)`);
} else if (config.resume) {
  const latest = findLatestFiveDrawCheckpoint();
  if (latest) {
    console.log(`Resuming from latest checkpoint: ${latest}`);
    existingEngine = loadCheckpoint(latest);
    console.log(`  Starting at iteration ${existingEngine.iterations} (${existingEngine.nodeCount} info sets)`);
  } else {
    console.log('No checkpoint found — starting fresh training.');
  }
}

// ── Progress handler ────────────────────────────────────────────────

function onProgress(metrics: FiveDrawProgressMetrics): void {
  const pct = ((metrics.iteration / metrics.totalIterations) * 100).toFixed(1);
  const avgRegret = metrics.avgRegretPerIteration.toFixed(4);
  const rate = metrics.gamesPerSecond.toFixed(0);
  const elapsed = (metrics.elapsedMs / 1000).toFixed(1);
  const p1Pct = (metrics.p1WinRate * 100).toFixed(1);
  const p2Pct = (metrics.p2WinRate * 100).toFixed(1);

  process.stderr.write(
    `\r  [${pct}%] iter ${metrics.iteration}/${metrics.totalIterations}` +
    `  |  ${metrics.infoSets} info sets` +
    `  |  avg regret: ${avgRegret}` +
    `  |  P1: ${p1Pct}% P2: ${p2Pct}%` +
    `  |  ${rate} games/sec` +
    `  |  ${elapsed}s`,
  );
}

function onCheckpoint(engine: CFREngine, iteration: number): void {
  const filepath = saveFiveDrawCheckpoint(engine);
  process.stderr.write(`\n  Checkpoint saved: ${filepath}\n`);
}

// ── Run training ────────────────────────────────────────────────────

console.log(`\n5 Draw CFR Training: ${config.iterations} iterations, pure self-play\n`);

const result = existingEngine
  ? resumeFiveDrawTraining(existingEngine, {
      ...config,
      onProgress,
      onCheckpoint,
    })
  : trainFiveDrawCFR({
      ...config,
      onProgress,
      onCheckpoint,
    });

// Clear progress line
process.stderr.write('\r' + ' '.repeat(120) + '\r');

// ── Results ─────────────────────────────────────────────────────────

const totalGames = result.p1Wins + result.p2Wins;
const p1WinRate = totalGames > 0 ? (result.p1Wins / totalGames * 100).toFixed(2) : '0.00';
const p2WinRate = totalGames > 0 ? (result.p2Wins / totalGames * 100).toFixed(2) : '0.00';

console.log('\n═══════════════════════════════════════════════');
console.log('  5 Draw CFR Training Complete');
console.log('═══════════════════════════════════════════════\n');
console.log(`  Total iterations:    ${result.totalIterations}`);
console.log(`  Unique info sets:    ${result.infoSetCount}`);
console.log(`  Avg regret/iter:     ${result.finalAvgRegret.toFixed(6)}`);
console.log(`  Duration:            ${(result.durationMs / 1000).toFixed(2)}s`);
console.log(`  Throughput:          ${(result.totalIterations / (result.durationMs / 1000)).toFixed(1)} games/sec`);
console.log(`\n  Position Analysis:`);
console.log(`    P1 (opener) wins:  ${result.p1Wins} (${p1WinRate}%)`);
console.log(`    P2 (responder) wins: ${result.p2Wins} (${p2WinRate}%)`);

// Save final checkpoint
const checkpointPath = saveFiveDrawCheckpoint(result.engine);
console.log(`\n  Final checkpoint:    ${checkpointPath}`);

// Export strategy
const strategyPath = exportFiveDrawStrategy(result.engine, config.strategyName ?? undefined);
console.log(`  Strategy exported:   ${strategyPath}`);

// Strategy summary
const exported = result.engine.exportCurrentStrategy();
console.log(`  Strategy info sets:  ${Object.keys(exported.strategy).length}`);
const strategyJson = JSON.stringify(exported);
console.log(`  File size:           ${(Buffer.byteLength(strategyJson) / 1024).toFixed(1)} KB`);

console.log('\n═══════════════════════════════════════════════\n');
