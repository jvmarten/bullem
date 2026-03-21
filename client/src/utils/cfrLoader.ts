/**
 * Client-side CFR strategy loader.
 *
 * Fetches the compact strategy JSON (~7MB, ~1.8MB gzipped) from the static
 * asset path and injects it directly into the shared CFR engine via
 * setCFRStrategyData(). The compact v2 format is stored as-is in memory
 * (~20MB) instead of being decoded to full keys (~80MB).
 *
 * Call preloadCFRStrategy() early (e.g., on mount of pages that use CFR bots)
 * and await it before starting a game with CFR bots.
 */
import { setCFRStrategyData, isCFRStrategyLoaded } from '@bull-em/shared';

let _loadPromise: Promise<void> | null = null;

/**
 * Preload CFR strategy data so it's available for decideCFR().
 * Fetches the JSON static asset and injects it into the shared engine.
 * Safe to call multiple times — only fetches once.
 */
export async function preloadCFRStrategy(): Promise<void> {
  if (isCFRStrategyLoaded()) return;
  if (!_loadPromise) {
    _loadPromise = (async () => {
      const resp = await fetch('/data/cfr-strategy.json');
      if (!resp.ok) {
        throw new Error(`Failed to load CFR strategy: ${resp.status}`);
      }
      // setCFRStrategyData accepts both v1 and v2 formats directly.
      // V2 compact format is stored as-is and decoded on-the-fly during lookups.
      setCFRStrategyData(await resp.json());
    })();
  }
  await _loadPromise;
}
