#!/usr/bin/env node

/**
 * Merge standard-config and mixed-config CFR strategies.
 *
 * For each player bucket (p2, p34, p5+):
 * - Standard-config keys (no j/lcS suffix) use the standard-trained strategy
 *   (more training iterations, better convergence for default game settings)
 * - Variant keys (with j1/j2/lcS suffixes) use the mixed-trained strategy
 *   (only source of variant-specific training)
 *
 * Usage:
 *   npx tsx training/src/mergeStrategies.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const STRATEGIES_DIR = path.resolve(import.meta.dirname, '../strategies');

interface ExportedStrategy {
  strategy: Record<string, Record<string, number>>;
  iterations: number;
  infoSetCount: number;
  avgRegret: number;
}

function loadStrategy(filepath: string): ExportedStrategy {
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

/** Check if an info set key is a variant key (has joker/LCR suffix). */
function isVariantKey(key: string): boolean {
  return key.includes('|j1') || key.includes('|j2') || key.includes('|lcS');
}

const buckets = ['p2', 'p34', 'p5+'] as const;

for (const bucket of buckets) {
  // Find standard strategy (highest iteration count with that bucket)
  const standardFile = `cfr-strategy-20000000-${bucket}.json`;
  const mixedFile = `cfr-mixed-config-${bucket}.json`;

  const standardPath = path.join(STRATEGIES_DIR, standardFile);
  const mixedPath = path.join(STRATEGIES_DIR, mixedFile);

  if (!fs.existsSync(standardPath)) {
    console.error(`Missing standard strategy: ${standardPath}`);
    continue;
  }
  if (!fs.existsSync(mixedPath)) {
    console.error(`Missing mixed strategy: ${mixedPath}`);
    continue;
  }

  const standard = loadStrategy(standardPath);
  const mixed = loadStrategy(mixedPath);

  // Merge: standard keys from standard, variant keys from mixed
  const merged: Record<string, Record<string, number>> = {};
  let standardCount = 0;
  let variantCount = 0;

  // First, add all standard keys from the standard-trained strategy
  for (const [key, value] of Object.entries(standard.strategy)) {
    if (!isVariantKey(key)) {
      merged[key] = value;
      standardCount++;
    }
  }

  // Then add variant keys from the mixed strategy
  for (const [key, value] of Object.entries(mixed.strategy)) {
    if (isVariantKey(key)) {
      merged[key] = value;
      variantCount++;
    }
  }

  // Also add any standard keys from mixed that are NOT in standard
  // (mixed training may have discovered new standard-config states)
  let extraStandard = 0;
  for (const [key, value] of Object.entries(mixed.strategy)) {
    if (!isVariantKey(key) && !(key in merged)) {
      merged[key] = value;
      extraStandard++;
    }
  }

  const totalInfoSets = Object.keys(merged).length;
  const outputFile = `cfr-merged-${bucket}.json`;
  const outputPath = path.join(STRATEGIES_DIR, outputFile);

  const output: ExportedStrategy = {
    strategy: merged,
    iterations: standard.iterations + mixed.iterations,
    infoSetCount: totalInfoSets,
    avgRegret: Math.min(standard.avgRegret, mixed.avgRegret),
  };

  fs.writeFileSync(outputPath, JSON.stringify(output), 'utf-8');
  const sizeKB = (Buffer.byteLength(JSON.stringify(output)) / 1024).toFixed(1);

  console.log(`${bucket}:`);
  console.log(`  Standard keys: ${standardCount} (from 5M standard training)`);
  console.log(`  Extra standard keys: ${extraStandard} (from mixed training)`);
  console.log(`  Variant keys: ${variantCount} (from 3M mixed training)`);
  console.log(`  Total: ${totalInfoSets} info sets (${sizeKB} KB)`);
  console.log(`  Output: ${outputFile}\n`);
}
