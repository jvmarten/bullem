/**
 * Client-side CFR strategy loader.
 *
 * Fetches the compact strategy JSON (~7MB, ~1.8MB gzipped) from the static
 * asset path, decodes it via decodeCFRCompact(), and injects it into the
 * shared CFR engine via setCFRStrategyData().
 *
 * Call preloadCFRStrategy() early (e.g., on mount of pages that use CFR bots)
 * and await it before starting a game with CFR bots.
 */
import { setCFRStrategyData, isCFRStrategyLoaded, decodeCFRCompact } from '@bull-em/shared';
import type { StrategyEntry, CompactCFRStrategy } from '@bull-em/shared';

let _loadPromise: Promise<void> | null = null;

interface CFRStrategyV1JSON {
  actionExpand: Record<string, string>;
  buckets: Record<string, Record<string, StrategyEntry>>;
}

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
      const raw: CFRStrategyV1JSON | CompactCFRStrategy = await resp.json();

      // Support both v1 (original) and v2 (compact) formats
      if ('v' in raw && raw.v === 2) {
        setCFRStrategyData(decodeCFRCompact(raw as CompactCFRStrategy));
      } else {
        setCFRStrategyData(raw as CFRStrategyV1JSON);
      }
    })();
  }
  await _loadPromise;
}
