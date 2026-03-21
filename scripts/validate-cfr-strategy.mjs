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
const MAX_SIZE_MB = 10;

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
      `Run "npm run generate-strategy -w training" to re-encode in compact v2 format.`,
    );
    process.exit(1);
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
