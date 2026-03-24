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

/** Fixed action order for v2 compact format. */
const ACTION_ORDER = ['bu', 'pa', 'tl', 'tm', 'th', 'tr', 'bs', 'bm', 'bb'];
const ACTION_TO_IDX = new Map(ACTION_ORDER.map((a, i) => [a, i]));

/** Characters used for single-char dictionary encoding of key segments. */
const DICT_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

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
  // Action prune threshold: actions below this probability are noise.
  // With 7M+ iterations (~26 visits/state), 10% keeps file under 8MB.
  const PRUNE_THRESHOLD = 0.10;
  const PRECISION = 2;
  // Info set convergence threshold: drop entries where no action exceeds this
  // probability — these are under-visited states with near-uniform strategy.
  // The runtime heuristic fallback handles these at ~80% trained quality.
  // With 7M iterations, keep at 0.30 to fit within 8MB file size limit.
  const CONVERGENCE_THRESHOLD = 0.30;
  const pruned: Record<string, Record<string, number>> = {};
  let count = 0;
  let skipped = 0;

  for (const [key, strat] of Object.entries(strategy)) {
    // Skip variant-specific info sets (joker/strict LCM) — too many for client bundle
    if (key.includes('|j1') || key.includes('|j2') || key.includes('|lcS')) {
      skipped++;
      continue;
    }

    // Skip info sets where strategy hasn't converged (near-uniform distribution)
    const maxProb = Math.max(...Object.values(strat));
    if (maxProb < CONVERGENCE_THRESHOLD) {
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

/**
 * Build a segment dictionary from all info set keys across all buckets.
 * Each unique pipe-separated segment gets a single-character code.
 * Segments are sorted by frequency so the most common get the simplest codes.
 */
function buildSegmentDictionary(
  allBuckets: Record<string, Record<string, Record<string, number>>>,
): { segToCode: Map<string, string>; codeToSeg: Record<string, string> } {
  const freq = new Map<string, number>();
  for (const entries of Object.values(allBuckets)) {
    for (const key of Object.keys(entries)) {
      for (const seg of key.split('|')) {
        freq.set(seg, (freq.get(seg) ?? 0) + 1);
      }
    }
  }

  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([seg]) => seg);
  if (sorted.length > DICT_CHARS.length) {
    throw new Error(`Too many unique segments (${sorted.length}) for single-char encoding (max ${DICT_CHARS.length})`);
  }

  const segToCode = new Map<string, string>();
  const codeToSeg: Record<string, string> = {};
  for (let i = 0; i < sorted.length; i++) {
    const code = DICT_CHARS[i]!;
    segToCode.set(sorted[i]!, code);
    codeToSeg[code] = sorted[i]!;
  }

  return { segToCode, codeToSeg };
}

/**
 * Encode a v1 strategy bucket into compact v2 format.
 * Keys: each pipe-separated segment → single char via dictionary.
 * Values: single-action → action index; multi-action → flat [idx, prob%, ...].
 */
function encodeCompactBucket(
  entries: Record<string, Record<string, number>>,
  segToCode: Map<string, string>,
): Record<string, number | number[]> {
  const compact: Record<string, number | number[]> = {};
  for (const [key, strat] of Object.entries(entries)) {
    // Encode key
    const compactKey = key.split('|').map(seg => segToCode.get(seg) ?? seg).join('');

    // Encode value
    const actions = Object.entries(strat);
    if (actions.length === 1) {
      const idx = ACTION_TO_IDX.get(actions[0]![0]);
      if (idx === undefined) throw new Error(`Unknown action: ${actions[0]![0]}`);
      compact[compactKey] = idx;
    } else {
      const pairs: number[] = [];
      for (const [action, prob] of actions) {
        const idx = ACTION_TO_IDX.get(action);
        if (idx === undefined) throw new Error(`Unknown action: ${action}`);
        const probPct = Math.round(prob * 100);
        if (probPct > 0) {
          pairs.push(idx, probPct);
        }
      }
      compact[compactKey] = pairs;
    }
  }
  return compact;
}

// ── Main ─────────────────────────────────────────────────────────────

// Load per-player-count strategy files
const bucketNames = ['p2', 'p34', 'p5+'];
const strategies = new Map<string, { strategy: Record<string, Record<string, number>>; infoSetCount: number }>();

for (const bucket of bucketNames) {
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

// Build the v1 buckets for dictionary analysis
let totalInfoSets = 0;
const v1Buckets: Record<string, Record<string, Record<string, number>>> = {};
for (const [bucket, data] of strategies) {
  totalInfoSets += data.infoSetCount;
  v1Buckets[bucket] = data.strategy;
}

// Build segment dictionary and encode to compact v2 format
const { segToCode, codeToSeg } = buildSegmentDictionary(v1Buckets);

const compactBuckets: Record<string, Record<string, number | number[]>> = {};
for (const [bucket, entries] of Object.entries(v1Buckets)) {
  compactBuckets[bucket] = encodeCompactBucket(entries, segToCode);
}

const v2Json = {
  v: 2 as const,
  actions: ACTION_ORDER,
  segments: codeToSeg,
  buckets: compactBuckets,
};

const output = JSON.stringify(v2Json);

fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
fs.writeFileSync(OUTPUT_FILE, output, 'utf-8');
const sizeKB = (Buffer.byteLength(output) / 1024).toFixed(1);
const sizeMB = (Buffer.byteLength(output) / 1024 / 1024).toFixed(1);
console.log(`\nGenerated ${OUTPUT_FILE} (compact v2 format)`);
console.log(`  Total info sets: ${totalInfoSets}`);
console.log(`  File size: ${sizeKB} KB (${sizeMB} MB)`);
console.log(`  Unique segments: ${Object.keys(codeToSeg).length}`);
if (Number(sizeMB) > 10) {
  console.warn(`\n⚠️  WARNING: File size exceeds 10MB. Consider reducing training iterations or increasing prune threshold.`);
}
