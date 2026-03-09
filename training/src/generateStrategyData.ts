import * as fs from 'node:fs';
import * as path from 'node:path';

const STRATEGIES_DIR = path.resolve(import.meta.dirname, '../strategies');
const OUTPUT_FILE = path.resolve(import.meta.dirname, '../../shared/src/cfr/strategyData.ts');

// Load per-player-count strategy files
const buckets = ['p2', 'p34', 'p5+'];
const strategies = new Map<string, { strategy: Record<string, Record<string, number>>; infoSetCount: number }>();

for (const bucket of buckets) {
  const files = fs.readdirSync(STRATEGIES_DIR)
    .filter(f => f.includes(`-${bucket}.json`) && f.startsWith('cfr-strategy-'))
    .sort();
  const latestFile = files[files.length - 1];
  if (latestFile) {
    const filepath = path.join(STRATEGIES_DIR, latestFile);
    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    strategies.set(bucket, data);
    console.log(`  ${bucket}: ${latestFile} (${data.infoSetCount} info sets)`);
  }
}

// Generate TypeScript
let totalInfoSets = 0;
const bucketLines: string[] = [];
for (const [bucket, data] of strategies) {
  totalInfoSets += data.infoSetCount;
  bucketLines.push(`  ['${bucket}', ${JSON.stringify(data.strategy)} as Record<string, StrategyEntry>]`);
}

const output = `/**
 * Embedded CFR strategy data from 1.5M iteration training run (v2 abstraction).
 * Auto-generated — do not edit manually.
 *
 * Total info sets: ${totalInfoSets}
${[...strategies].map(([b, d]) => ` * ${b}: ${d.infoSetCount} info sets`).join('\n')}
 *
 * Abstraction: 3 claim height buckets (lo/mid/hi), 3 card count buckets (n1/nMid/nHi)
 * Training: 1.5M iterations, mixed player counts [2,2,2,3,3,4,4,5,6]
 * Avg regret: 0.0036
 */

/** Action probability distribution for one info set. */
export interface StrategyEntry {
  [action: string]: number;
}

/** Pre-computed strategy lookup: player count bucket → info set key → action probabilities. */
export const STRATEGY_DATA: ReadonlyMap<string, Record<string, StrategyEntry>> = new Map([
${bucketLines.join(',\n')},
]);
`;

fs.writeFileSync(OUTPUT_FILE, output, 'utf-8');
console.log(`\nGenerated ${OUTPUT_FILE}`);
console.log(`  Total info sets: ${totalInfoSets}`);
console.log(`  File size: ${(Buffer.byteLength(output) / 1024).toFixed(1)} KB`);
