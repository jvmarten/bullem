#!/usr/bin/env node

/**
 * Validates cfr-strategy.json is in v2 compact format and under the size limit.
 * Runs as part of the build to prevent deploying a v1 format file that would
 * cause OOM crashes on the 256MB production machine.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STRATEGY_PATH = path.resolve(__dirname, '../client/public/data/cfr-strategy.json');
// Hard limit: fail the build above this size. The 256MB Fly.io machine with
// --max-old-space-size=200 can't safely parse files much larger than this.
const MAX_SIZE_MB = 8;
// Soft limit: warn when approaching the hard limit so retrains don't surprise.
const WARN_SIZE_MB = 6;

function validate() {
  if (!fs.existsSync(STRATEGY_PATH)) {
    console.log('⚠️  cfr-strategy.json not found — skipping validation (CFR bots will use heuristic fallback)');
    return;
  }

  const stats = fs.statSync(STRATEGY_PATH);
  const sizeMB = stats.size / 1024 / 1024;

  if (sizeMB > MAX_SIZE_MB) {
    console.error(
      `❌ cfr-strategy.json is ${sizeMB.toFixed(1)}MB (max ${MAX_SIZE_MB}MB). ` +
      `The 256MB production machine cannot safely parse files this large. ` +
      `Reduce info set count or run "npm run generate-strategy -w training" to re-encode.`,
    );
    process.exit(1);
  }

  if (sizeMB > WARN_SIZE_MB) {
    console.warn(
      `⚠️  cfr-strategy.json is ${sizeMB.toFixed(1)}MB — approaching the ${MAX_SIZE_MB}MB limit. ` +
      `Consider reducing info set count in the next retrain.`,
    );
  }

  // Quick format check — read just the first 100 bytes to verify v2 format
  const fd = fs.openSync(STRATEGY_PATH, 'r');
  const buf = Buffer.alloc(100);
  fs.readSync(fd, buf, 0, 100, 0);
  fs.closeSync(fd);
  const head = buf.toString('utf8');

  if (!head.includes('"v":2')) {
    console.error(
      '❌ cfr-strategy.json is not in v2 compact format. ' +
      'V1 format causes OOM crashes on production (256MB machine). ' +
      'Run "npm run generate-strategy -w training" to convert.',
    );
    process.exit(1);
  }

  console.log(`✅ cfr-strategy.json: v2 compact format, ${sizeMB.toFixed(1)}MB`);
}

validate();
