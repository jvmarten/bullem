import * as fs from 'node:fs';
import * as path from 'node:path';

const STRATEGIES_DIR = path.resolve(import.meta.dirname, '../strategies');
const OUTPUT_FILE = path.resolve(import.meta.dirname, '../../client/public/data/cfr-strategy.json');

/**
 * Compact action name mapping to reduce JSON size.
 * Full names like "truthful_low" (12 chars) → "tl" (2 chars).
 * Applied at generation time; runtime code expands them via ACTION_EXPAND.
 */
const ACTION_ABBREVIATIONS: Record<string, string> = {
  'truthful_low': 'tl',
  'truthful_mid': 'tm',
  'truthful_high': 'th',
  'bluff_small': 'bs',
  'bluff_mid': 'bm',
  'bluff_big': 'bb',
  'bull': 'bu',
  'true': 'tr',
  'pass': 'pa',
};

/**
 * Re-prune and filter a strategy for embedding.
 *
 * Only standard game config info sets (no jokers, classic LCM) are included.
 * Variant configs (jokers, strict LCM) add 110K+ info sets that 5x the bundle
 * size but only apply to less-common game modes. Those fall back to the
 * context-aware heuristic at runtime, which performs at ~80% of trained quality.
 *
 * Actions with <5% probability are pruned, and names are abbreviated.
 */
function repruneStrategy(
  strategy: Record<string, Record<string, number>>,
): { pruned: Record<string, Record<string, number>>; count: number; skipped: number } {
  const PRUNE_THRESHOLD = 0.05;
  const PRECISION = 2;
  const pruned: Record<string, Record<string, number>> = {};
  let count = 0;
  let skipped = 0;

  for (const [key, strat] of Object.entries(strategy)) {
    // Skip variant-specific info sets (joker/strict LCM) — too many for client bundle
    if (key.includes('|j1') || key.includes('|j2') || key.includes('|lcS')) {
      skipped++;
      continue;
    }

    const kept: Record<string, number> = {};
    for (const [action, prob] of Object.entries(strat)) {
      if (prob >= PRUNE_THRESHOLD) {
        const abbr = ACTION_ABBREVIATIONS[action] ?? action;
        kept[abbr] = Number(prob.toFixed(PRECISION));
      }
    }

    // Renormalize after pruning
    const sum = Object.values(kept).reduce((s, v) => s + v, 0);
    if (sum > 0 && Math.abs(sum - 1) > 0.02) {
      for (const action of Object.keys(kept)) {
        kept[action] = Number((kept[action]! / sum).toFixed(PRECISION));
      }
    }

    if (Object.keys(kept).length > 0) {
      pruned[key] = kept;
      count++;
    }
  }

  return { pruned, count, skipped };
}

// Load per-player-count strategy files
const buckets = ['p2', 'p34', 'p5+'];
const strategies = new Map<string, { strategy: Record<string, Record<string, number>>; infoSetCount: number }>();

for (const bucket of buckets) {
  const files = fs.readdirSync(STRATEGIES_DIR)
    .filter(f => f.includes(`-${bucket}.json`) && f.startsWith('cfr-strategy-'))
    .sort((a, b) => {
      const numA = parseInt(a.match(/cfr-strategy-(\d+)/)?.[1] ?? '0', 10);
      const numB = parseInt(b.match(/cfr-strategy-(\d+)/)?.[1] ?? '0', 10);
      return numA - numB;
    });
  const latestFile = files[files.length - 1];
  if (latestFile) {
    const filepath = path.join(STRATEGIES_DIR, latestFile);
    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    const { pruned, count, skipped } = repruneStrategy(data.strategy);
    strategies.set(bucket, { strategy: pruned, infoSetCount: count });
    console.log(`  ${bucket}: ${latestFile} (${data.infoSetCount} → ${count} standard, ${skipped} variant skipped)`);
  }
}

// Build the action expand reverse mapping
const actionExpand: Record<string, string> = {};
for (const [full, abbr] of Object.entries(ACTION_ABBREVIATIONS)) {
  actionExpand[abbr] = full;
}

// Generate JSON
let totalInfoSets = 0;
const bucketsObj: Record<string, Record<string, Record<string, number>>> = {};
for (const [bucket, data] of strategies) {
  totalInfoSets += data.infoSetCount;
  bucketsObj[bucket] = data.strategy;
}

const json = { actionExpand, buckets: bucketsObj };
const output = JSON.stringify(json);

fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
fs.writeFileSync(OUTPUT_FILE, output, 'utf-8');
const sizeKB = (Buffer.byteLength(output) / 1024).toFixed(1);
console.log(`\nGenerated ${OUTPUT_FILE}`);
console.log(`  Total info sets: ${totalInfoSets}`);
console.log(`  File size: ${sizeKB} KB`);
