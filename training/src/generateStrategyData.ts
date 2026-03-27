import * as fs from 'node:fs';
import * as path from 'node:path';
import { encode } from '@msgpack/msgpack';

const STRATEGIES_DIR = path.resolve(import.meta.dirname, '../strategies');
const OUTPUT_DIR = path.resolve(import.meta.dirname, '../../client/public/data');

/**
 * Compact action name mapping to reduce size.
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

/** Fixed action order for compact format. */
const ACTION_ORDER = ['bu', 'pa', 'tl', 'tm', 'th', 'tr', 'bs', 'bm', 'bb'];
const ACTION_TO_IDX = new Map(ACTION_ORDER.map((a, i) => [a, i]));

/**
 * Base characters for dictionary encoding of key segments.
 * 2-char codes from base-62 alphabet (supports up to 3844 segments).
 */
const DICT_BASE = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function makeDictCode(index: number): string {
  const hi = Math.floor(index / DICT_BASE.length);
  const lo = index % DICT_BASE.length;
  return DICT_BASE[hi]! + DICT_BASE[lo]!;
}

/** Bucket name → output filename (avoid '+' in URLs). */
const BUCKET_FILES: Record<string, string> = {
  'p2': 'cfr-p2.bin',
  'p34': 'cfr-p34.bin',
  'p5+': 'cfr-p5plus.bin',
};

/**
 * Re-prune and filter a strategy for embedding.
 *
 * Only standard game config info sets (no jokers, classic LCM) are included.
 * Variant configs add 110K+ info sets that bloat the bundle but only apply to
 * less-common game modes. Those fall back to the heuristic at runtime.
 *
 * Actions with <5% probability are pruned, and names are abbreviated.
 */
function repruneStrategy(
  strategy: Record<string, Record<string, number>>,
  bucket: string = '',
): { pruned: Record<string, Record<string, number>>; count: number; skipped: number } {
  const isP2 = bucket === 'p2';
  // 20M iterations: p2 is better converged, can use moderate threshold.
  // Under-converged states fall back to heuristic + Monte Carlo search.
  const PRUNE_THRESHOLD = isP2 ? 0.20 : 0.10;
  const PRECISION = 2;
  const CONVERGENCE_THRESHOLD = isP2 ? 0.92 : 0.30;
  const pruned: Record<string, Record<string, number>> = {};
  let count = 0;
  let skipped = 0;

  for (const [key, strat] of Object.entries(strategy)) {
    // Skip variant-specific info sets (joker/strict LCM)
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
 * Build a segment dictionary from a single bucket's info set keys.
 * Each unique pipe-separated segment gets a 2-char code.
 * Segments are sorted by frequency so the most common get the lowest codes.
 */
function buildBucketSegmentDictionary(
  entries: Record<string, Record<string, number>>,
): { segToCode: Map<string, string>; codeToSeg: Record<string, string> } {
  const freq = new Map<string, number>();
  for (const key of Object.keys(entries)) {
    for (const seg of key.split('|')) {
      freq.set(seg, (freq.get(seg) ?? 0) + 1);
    }
  }

  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([seg]) => seg);
  const maxCodes = DICT_BASE.length * DICT_BASE.length; // 3844
  if (sorted.length > maxCodes) {
    throw new Error(`Too many unique segments (${sorted.length}) for 2-char encoding (max ${maxCodes})`);
  }

  const segToCode = new Map<string, string>();
  const codeToSeg: Record<string, string> = {};
  for (let i = 0; i < sorted.length; i++) {
    const code = makeDictCode(i);
    segToCode.set(sorted[i]!, code);
    codeToSeg[code] = sorted[i]!;
  }

  return { segToCode, codeToSeg };
}

/**
 * Encode a strategy bucket into compact format.
 * Keys: each pipe-separated segment → dictionary code → concatenated.
 * Values: single-action → action index; multi-action → flat [idx, prob%, ...].
 */
function encodeCompactBucket(
  entries: Record<string, Record<string, number>>,
  segToCode: Map<string, string>,
): Record<string, number | number[]> {
  const compact: Record<string, number | number[]> = {};
  for (const [key, strat] of Object.entries(entries)) {
    const compactKey = key.split('|').map(seg => segToCode.get(seg) ?? seg).join('');

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
    const { pruned, count, skipped } = repruneStrategy(data.strategy, bucket);
    strategies.set(bucket, { strategy: pruned, infoSetCount: count });
    console.log(`  ${bucket}: ${latestFile} (${data.infoSetCount} → ${count} standard, ${skipped} variant skipped)`);
  }
}

// Generate per-bucket MessagePack files
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
let totalInfoSets = 0;

for (const [bucket, data] of strategies) {
  totalInfoSets += data.infoSetCount;

  // Build per-bucket segment dictionary (self-contained files)
  const { segToCode, codeToSeg } = buildBucketSegmentDictionary(data.strategy);
  const compactEntries = encodeCompactBucket(data.strategy, segToCode);

  const v3Bucket = {
    v: 3 as const,
    bucket,
    actions: ACTION_ORDER,
    segments: codeToSeg,
    entries: compactEntries,
  };

  const filename = BUCKET_FILES[bucket];
  if (!filename) throw new Error(`No filename mapping for bucket "${bucket}"`);

  const binary = encode(v3Bucket);
  const outputPath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(outputPath, binary);

  const sizeMB = (binary.length / 1024 / 1024).toFixed(2);
  const segCount = Object.keys(codeToSeg).length;
  console.log(`  → ${filename}: ${data.infoSetCount} info sets, ${segCount} segments, ${sizeMB} MB`);

  if (binary.length / 1024 / 1024 > 5) {
    console.warn(`  ⚠️  ${filename} exceeds 5MB — consider increasing prune thresholds for ${bucket}`);
  }
}

console.log(`\nGenerated ${strategies.size} bucket files in ${OUTPUT_DIR} (v3 MessagePack format)`);
console.log(`  Total info sets: ${totalInfoSets}`);

// Clean up legacy JSON file if it exists
const legacyFile = path.join(OUTPUT_DIR, 'cfr-strategy.json');
if (fs.existsSync(legacyFile)) {
  fs.unlinkSync(legacyFile);
  console.log(`  Removed legacy cfr-strategy.json`);
}
