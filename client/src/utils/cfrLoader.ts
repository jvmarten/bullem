/**
 * Client-side CFR strategy loader.
 *
 * Loads per-bucket MessagePack files on demand. Each bucket is self-contained
 * and loaded independently based on player count. Files are cached by the
 * service worker for offline play.
 *
 * Call preloadCFRBucket(playerCount) before starting a game with CFR bots.
 */
import { decode } from '@msgpack/msgpack';
import { setCFRBucketData, isCFRBucketLoaded } from '@bull-em/shared';
import type { CompactCFRBucket } from '@bull-em/shared';

const _loadPromises = new Map<string, Promise<void>>();

/** Map player count to bucket name and filename. */
function getBucketFile(playerCount: number): { bucket: string; file: string } {
  if (playerCount <= 2) return { bucket: 'p2', file: 'cfr-p2.bin' };
  if (playerCount <= 4) return { bucket: 'p34', file: 'cfr-p34.bin' };
  return { bucket: 'p5+', file: 'cfr-p5plus.bin' };
}

/**
 * Preload a specific CFR strategy bucket for the given player count.
 * Fetches the MessagePack binary and injects it into the shared engine.
 * Safe to call multiple times — only fetches each bucket once.
 */
export async function preloadCFRBucket(playerCount: number): Promise<void> {
  const { bucket, file } = getBucketFile(playerCount);
  if (isCFRBucketLoaded(bucket)) return;
  if (!_loadPromises.has(bucket)) {
    _loadPromises.set(bucket, (async () => {
      const resp = await fetch(`/data/${file}`);
      if (!resp.ok) {
        throw new Error(`Failed to load CFR bucket ${bucket}: ${resp.status}`);
      }
      const buffer = await resp.arrayBuffer();
      const data = decode(new Uint8Array(buffer)) as CompactCFRBucket;
      setCFRBucketData(bucket, data);
    })());
  }
  await _loadPromises.get(bucket)!;
}

/**
 * Preload all CFR strategy buckets. Use when the player count isn't known yet.
 * Safe to call multiple times — only fetches each bucket once.
 */
export async function preloadCFRStrategy(): Promise<void> {
  await Promise.all([preloadCFRBucket(2), preloadCFRBucket(3), preloadCFRBucket(5)]);
}
