#!/usr/bin/env node

/**
 * Validates per-bucket CFR strategy files are present and under size limits.
 * Runs as part of the build to prevent deploying oversized files that would
 * cause memory issues on the 512MB production machine.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../client/public/data');

const BUCKETS = [
  { name: 'p2', file: 'cfr-p2.bin' },
  { name: 'p34', file: 'cfr-p34.bin' },
  { name: 'p5+', file: 'cfr-p5plus.bin' },
];

// Per-bucket limits. The 512MB Fly.io machine with --max-old-space-size=400
// can handle ~8MB per bucket file comfortably.
const MAX_SIZE_MB = 8;
const WARN_SIZE_MB = 6;

function validate() {
  let allValid = true;
  let found = 0;

  for (const { name, file } of BUCKETS) {
    const filePath = path.join(DATA_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.log(`  ${name}: not found (heuristic fallback)`);
      continue;
    }
    found++;

    const stats = fs.statSync(filePath);
    const sizeMB = stats.size / 1024 / 1024;

    if (sizeMB > MAX_SIZE_MB) {
      console.error(
        `❌ ${file} is ${sizeMB.toFixed(1)}MB (max ${MAX_SIZE_MB}MB). ` +
        `Reduce info set count or increase prune thresholds.`,
      );
      allValid = false;
    } else if (sizeMB > WARN_SIZE_MB) {
      console.warn(
        `⚠️  ${file} is ${sizeMB.toFixed(1)}MB — approaching the ${MAX_SIZE_MB}MB limit.`,
      );
    } else {
      console.log(`  ✅ ${file}: ${sizeMB.toFixed(1)}MB`);
    }
  }

  if (found === 0) {
    console.log('⚠️  No CFR strategy files found — CFR bots will use heuristic fallback');
    return;
  }

  if (!allValid) {
    process.exit(1);
  }

  console.log(`✅ ${found} CFR bucket file(s) validated`);
}

validate();
