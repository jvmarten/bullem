/**
 * Client-side CFR strategy loader.
 *
 * Fetches the strategy JSON from the static asset path and injects it into
 * the shared CFR engine via setCFRStrategyData(). The JSON file (~7.5MB) is
 * served by Express/Vite from client/public/data/ and parsed with JSON.parse()
 * which is 2-10x faster than equivalent JS parsing.
 *
 * Call preloadCFRStrategy() early (e.g., on mount of pages that use CFR bots)
 * and await it before starting a game with CFR bots.
 */
import { setCFRStrategyData, isCFRStrategyLoaded } from '@bull-em/shared';
import type { StrategyEntry } from '@bull-em/shared';

let _loadPromise: Promise<void> | null = null;

interface CFRStrategyJSON {
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
      const data: CFRStrategyJSON = await resp.json();
      setCFRStrategyData(data);
    })();
  }
  await _loadPromise;
}
