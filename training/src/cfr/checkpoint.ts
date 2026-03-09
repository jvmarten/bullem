/**
 * Checkpoint and strategy file I/O for CFR training.
 *
 * - Checkpoints go to `training/checkpoints/` (gitignored — large intermediate data)
 * - Exported strategies go to `training/strategies/` (committed — compact deployment data)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CFREngine, type CFRState, type ExportedStrategy } from './cfrEngine.js';

const TRAINING_ROOT = path.resolve(import.meta.dirname, '../..');
const CHECKPOINTS_DIR = path.join(TRAINING_ROOT, 'checkpoints');
const STRATEGIES_DIR = path.join(TRAINING_ROOT, 'strategies');

/** Ensure a directory exists. */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ── Checkpoints ──────────────────────────────────────────────────────────

/** Save a CFR engine checkpoint. */
export function saveCheckpoint(engine: CFREngine, label?: string): string {
  ensureDir(CHECKPOINTS_DIR);

  const filename = label
    ? `cfr-checkpoint-${label}.json`
    : `cfr-checkpoint-${engine.iterations}.json`;
  const filepath = path.join(CHECKPOINTS_DIR, filename);

  const state = engine.toState();
  fs.writeFileSync(filepath, JSON.stringify(state), 'utf-8');

  return filepath;
}

/** Load a CFR engine from a checkpoint file. */
export function loadCheckpoint(filepath: string): CFREngine {
  const raw = fs.readFileSync(filepath, 'utf-8');
  const state = JSON.parse(raw) as CFRState;

  const engine = new CFREngine();
  engine.fromState(state);
  return engine;
}

/** Find the latest checkpoint file (by iteration count). */
export function findLatestCheckpoint(): string | null {
  if (!fs.existsSync(CHECKPOINTS_DIR)) return null;

  const files = fs.readdirSync(CHECKPOINTS_DIR)
    .filter(f => f.startsWith('cfr-checkpoint-') && f.endsWith('.json'))
    .sort(); // Lexicographic sort — works because filenames include iteration count

  if (files.length === 0) return null;
  return path.join(CHECKPOINTS_DIR, files[files.length - 1]!);
}

/** List all checkpoint files with their iteration counts. */
export function listCheckpoints(): { filepath: string; iterations: number }[] {
  if (!fs.existsSync(CHECKPOINTS_DIR)) return [];

  return fs.readdirSync(CHECKPOINTS_DIR)
    .filter(f => f.startsWith('cfr-checkpoint-') && f.endsWith('.json'))
    .map(f => {
      const match = f.match(/cfr-checkpoint-(\d+)\.json/);
      return {
        filepath: path.join(CHECKPOINTS_DIR, f),
        iterations: match ? parseInt(match[1]!, 10) : 0,
      };
    })
    .sort((a, b) => a.iterations - b.iterations);
}

// ── Strategy export ──────────────────────────────────────────────────────

/**
 * Export the trained strategy to a compact JSON file.
 * Defaults to the current (regret-matched) strategy which converges faster
 * in practice. Use mode='average' for the theoretical Nash-convergent average.
 */
export function exportStrategy(
  engine: CFREngine,
  name?: string,
  mode: 'current' | 'average' = 'current',
): string {
  ensureDir(STRATEGIES_DIR);

  const strategy = mode === 'current'
    ? engine.exportCurrentStrategy()
    : engine.exportStrategy();
  const filename = name
    ? `${name}.json`
    : `cfr-strategy-${engine.iterations}.json`;
  const filepath = path.join(STRATEGIES_DIR, filename);

  fs.writeFileSync(filepath, JSON.stringify(strategy), 'utf-8');

  return filepath;
}

/** Load a strategy file. */
export function loadStrategy(filepath: string): ExportedStrategy {
  const raw = fs.readFileSync(filepath, 'utf-8');
  return JSON.parse(raw) as ExportedStrategy;
}

/** Find the latest strategy file. */
export function findLatestStrategy(): string | null {
  if (!fs.existsSync(STRATEGIES_DIR)) return null;

  const files = fs.readdirSync(STRATEGIES_DIR)
    .filter(f => f.startsWith('cfr-strategy-') && f.endsWith('.json'))
    .sort();

  if (files.length === 0) return null;
  return path.join(STRATEGIES_DIR, files[files.length - 1]!);
}

/** List all strategy files. */
export function listStrategies(): { filepath: string; name: string }[] {
  if (!fs.existsSync(STRATEGIES_DIR)) return [];

  return fs.readdirSync(STRATEGIES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => ({
      filepath: path.join(STRATEGIES_DIR, f),
      name: f.replace('.json', ''),
    }));
}
