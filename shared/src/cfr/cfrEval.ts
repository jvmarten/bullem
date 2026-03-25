/**
 * CFR strategy evaluation for in-game bot decisions.
 *
 * Uses pre-trained strategy data injected at startup via setCFRStrategyData().
 * Strategy data (~7.6MB JSON) is NOT bundled — it's loaded from disk on the
 * server and fetched as a static asset on the client.
 *
 * Post-strategy safety layers:
 * 1. Plausibility override — forces bull when claims are impossible given card count
 * 2. Card knowledge — Bayesian probability using bot's own cards (card counting)
 * 3. Escalation dampening — increases bull probability as claims get absurdly high
 * 4. Plausibility-capped action mapping — prevents generating implausible hands
 */

import type { Card, ClientGameState, HandCall, JokerCount, LastChanceMode, Rank, Suit } from '../types.js';
import { HandType, RoundPhase } from '../types.js';
import type { BotAction } from '../engine/BotPlayer.js';
import { AbstractAction, getInfoSetKey, getLegalAbstractActions, MIN_CARDS_FOR_PLAUSIBLE } from './infoSet.js';
import { mapAbstractToConcreteAction } from './actionMapper.js';
import { HandChecker } from '../engine/HandChecker.js';
import { RANK_VALUES, ALL_RANKS, ALL_SUITS } from '../constants.js';

/** Action probability distribution for one info set. */
export interface StrategyEntry {
  [action: string]: number;
}

// ── Strategy data (injected at startup) ───────────────────────────────
// Strategy data is NOT bundled with shared/.
// On the server: loaded from JSON on disk and injected via setCFRStrategyData().
// On the client: fetched via fetch('/data/cfr-strategy.json') and injected.
//
// V2 compact format is stored DIRECTLY in memory to avoid the ~80MB
// expansion cost of decoding all 186K info set keys at startup.
// Keys are encoded on-the-fly during lookups using the segment dictionary.
// V2 compact format — stored as-is, decoded on lookup
let _compactData: CompactCFRStrategy | null = null;
let _segToCode: Map<string, string> | null = null; // segment → single char (for key encoding)

// ── Strategy lookup observability ────────────────────────────────────
// Tracks hit/miss ratio for strategy lookups. Logged periodically to
// detect silent key mismatches between strategy file and infoSet.ts.
let _strategyHits = 0;
let _strategyMisses = 0;
let _lastLogTime = 0;
const LOG_INTERVAL_MS = 60_000; // Log stats every 60 seconds

/** Get current strategy hit/miss stats (for testing/monitoring). */
export function getCFRStrategyStats(): { hits: number; misses: number; hitRate: number } {
  const total = _strategyHits + _strategyMisses;
  return {
    hits: _strategyHits,
    misses: _strategyMisses,
    hitRate: total > 0 ? _strategyHits / total : 0,
  };
}

/** Reset strategy stats (for testing). */
export function resetCFRStrategyStats(): void {
  _strategyHits = 0;
  _strategyMisses = 0;
  _lastLogTime = 0;
}

/** Record a strategy lookup result and log periodically. */
function recordStrategyLookup(hit: boolean): void {
  if (hit) _strategyHits++;
  else _strategyMisses++;

  const now = Date.now();
  if (now - _lastLogTime > LOG_INTERVAL_MS && (_strategyHits + _strategyMisses) > 0) {
    _lastLogTime = now;
    const total = _strategyHits + _strategyMisses;
    const hitRate = (_strategyHits / total * 100).toFixed(1);
    // Use console.info — structured logging picks this up on the server.
    // On the client this is harmless (dev tools only).
    console.info(
      `[CFR] Strategy lookup stats: ${_strategyHits}/${total} hits (${hitRate}%), ${_strategyMisses} misses`,
    );
  }
}

/**
 * Inject pre-parsed CFR strategy data. Called once at startup by the
 * platform-specific loader (server reads from disk, client fetches JSON).
 *
 * Only accepts v2 compact format. V1 format is rejected to prevent OOM
 * crashes on memory-constrained machines (256MB Fly.io). V2 is stored
 * directly in memory (~20MB) instead of being expanded to full keys (~80MB).
 *
 * If you see a v1 format error, run: npm run generate-strategy -w training
 */
export function setCFRStrategyData(data: CompactCFRStrategy): void {
  if (!('v' in data) || data.v !== 2) {
    throw new Error(
      'CFR strategy file is in v1 format, which causes OOM crashes on production. ' +
      'Run "npm run generate-strategy -w training" to convert to v2 compact format.',
    );
  }
  // Store compact format directly — decode keys on-the-fly during lookups
  _compactData = data;
  // Build reverse lookup: segment name → single char code
  _segToCode = new Map();
  for (const [code, seg] of Object.entries(data.segments)) {
    _segToCode.set(seg, code);
  }
}

/** Returns true if strategy data has been loaded. */
export function isCFRStrategyLoaded(): boolean {
  return _compactData !== null;
}

/**
 * Compact CFR strategy format (v2). Uses dictionary-encoded info set keys
 * and indexed action arrays to reduce JSON size by ~60% (19MB → 7MB).
 *
 * Keys: each character maps to a segment via the `segments` dictionary,
 *        concatenated with '|' to reconstruct the original info set key.
 * Values: single-action entries store the action index directly (number).
 *         Multi-action entries store a flat array [actionIdx, prob%, ...].
 */
export interface CompactCFRStrategy {
  v: 2;
  actions: string[];
  segments: Record<string, string>;
  buckets: Record<string, Record<string, number | number[]>>;
}

/**
 * Decode a compact (v2) CFR strategy JSON into the format expected by
 * setCFRStrategyData(). Call this on both server and client before injecting.
 */
export function decodeCFRCompact(compact: CompactCFRStrategy): {
  actionExpand: Record<string, string>;
  buckets: Record<string, Record<string, StrategyEntry>>;
} {
  const { actions, segments, buckets: compactBuckets } = compact;

  // Rebuild actionExpand from the known action abbreviations
  const ACTION_NAMES: Record<string, string> = {
    bu: 'bull', pa: 'pass', tl: 'truthful_low', tm: 'truthful_mid',
    th: 'truthful_high', tr: 'true', bs: 'bluff_small', bm: 'bluff_mid',
    bb: 'bluff_big',
  };
  const actionExpand: Record<string, string> = {};
  for (const a of actions) {
    actionExpand[a] = ACTION_NAMES[a] ?? a;
  }

  const decodedBuckets: Record<string, Record<string, StrategyEntry>> = {};
  for (const [bucketKey, entries] of Object.entries(compactBuckets)) {
    const decoded: Record<string, StrategyEntry> = {};
    for (const [compactKey, value] of Object.entries(entries)) {
      // Decode key: each char → segments lookup → join with '|'
      const parts: string[] = [];
      for (const ch of compactKey) {
        parts.push(segments[ch] ?? ch);
      }
      const fullKey = parts.join('|');

      // Decode value
      let entry: StrategyEntry;
      if (typeof value === 'number') {
        // Single-action: action index → { actionName: 1 }
        entry = { [actions[value]!]: 1 };
      } else {
        // Multi-action: flat array [idx, prob%, idx, prob%, ...]
        entry = {};
        for (let i = 0; i < value.length; i += 2) {
          entry[actions[value[i]!]!] = value[i + 1]! / 100;
        }
      }
      decoded[fullKey] = entry;
    }
    decodedBuckets[bucketKey] = decoded;
  }

  return { actionExpand, buckets: decodedBuckets };
}

/**
 * Encode an info set key from full pipe-separated form to compact single-char form.
 * Example: "c|p2|c1|tLo|weak" → "lHJLA" using the segment dictionary.
 */
function encodeInfoSetKey(fullKey: string, segToCode: Map<string, string>): string {
  const parts = fullKey.split('|');
  let encoded = '';
  for (const part of parts) {
    encoded += segToCode.get(part) ?? part;
  }
  return encoded;
}

/**
 * Look up a strategy entry from the compact v2 data and decode it on-the-fly.
 * Returns null if not found. Much cheaper than decoding all 186K entries at startup.
 */
function lookupCompactStrategy(
  bucket: string, infoSetKey: string,
): { entry: StrategyEntry; actionExpand: Record<string, string> } | null {
  if (!_compactData || !_segToCode) return null;
  const bucketData = _compactData.buckets[bucket];
  if (!bucketData) return null;

  const compactKey = encodeInfoSetKey(infoSetKey, _segToCode);
  const value = bucketData[compactKey];
  if (value === undefined) return null;

  const { actions } = _compactData;
  let entry: StrategyEntry;
  if (typeof value === 'number') {
    entry = { [actions[value]!]: 1 };
  } else {
    entry = {};
    for (let i = 0; i < value.length; i += 2) {
      entry[actions[value[i]!]!] = value[i + 1]! / 100;
    }
  }

  // Build actionExpand for this lookup
  const ACTION_NAMES: Record<string, string> = {
    bu: 'bull', pa: 'pass', tl: 'truthful_low', tm: 'truthful_mid',
    th: 'truthful_high', tr: 'true', bs: 'bluff_small', bm: 'bluff_mid',
    bb: 'bluff_big',
  };
  const actionExpand: Record<string, string> = {};
  for (const a of actions) {
    actionExpand[a] = ACTION_NAMES[a] ?? a;
  }

  return { entry, actionExpand };
}

/** Map active player count to strategy bucket key. */
function resolvePlayerBucket(activePlayers: number): string {
  if (activePlayers <= 2) return 'p2';
  if (activePlayers <= 4) return 'p34';
  return 'p5+';
}

// ── Claim plausibility analysis ────────────────────────────────────────

/**
 * Returns 0.0 (certainly doesn't exist) to 1.0 (very likely exists)
 * representing how plausible the current claim is given total cards.
 *
 * Uses MIN_CARDS_FOR_PLAUSIBLE from infoSet.ts — the canonical thresholds
 * shared between training and eval. This alignment ensures the safety
 * layers don't contradict what the trained strategy learned.
 */
function claimPlausibility(hand: HandCall | null, totalCards: number): number {
  if (!hand) return 1.0;
  const minNeeded = MIN_CARDS_FOR_PLAUSIBLE[hand.type] ?? 10;
  const ratio = totalCards / minNeeded;
  if (ratio >= 2.5) return 1.0;   // Very likely
  if (ratio >= 1.5) return 0.8;   // Likely
  if (ratio >= 1.0) return 0.5;   // Coin flip
  if (ratio >= 0.75) return 0.2;  // Unlikely
  return 0.0;                      // Nearly impossible
}

/**
 * Returns a "claim height" score from 0-1 indicating how high the claim is
 * relative to the full hand spectrum. Used to dampen escalation spirals.
 */
function claimHeightScore(hand: HandCall | null): number {
  if (!hand) return 0;
  // Base score from hand type (0-9 mapped to 0-1)
  let score = hand.type / HandType.ROYAL_FLUSH;
  // Within type, use rank to refine (higher rank = higher score)
  if ('rank' in hand && hand.rank) {
    score += (RANK_VALUES[hand.rank] / 14) * 0.05;
  } else if ('highRank' in hand && hand.highRank) {
    score += (RANK_VALUES[hand.highRank] / 14) * 0.05;
  }
  return Math.min(score, 1.0);
}

// ── Combinatorial hand probability ────────────────────────────────────

/**
 * Binomial coefficient C(n, k) — "n choose k".
 * Returns 0 for invalid inputs (k > n, negative values).
 * Uses multiplicative formula to avoid overflow for reasonable inputs.
 */
function choose(n: number, k: number): number {
  if (k < 0 || k > n || n < 0) return 0;
  if (k === 0 || k === n) return 1;
  if (k > n - k) k = n - k; // Optimization: C(n,k) = C(n, n-k)
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = result * (n - i) / (i + 1);
  }
  return Math.round(result);
}

/**
 * Probability that at least `needed` copies of a specific rank exist
 * among `unknownCards` drawn from a pool of `poolSize` cards containing
 * `copiesInPool` copies of that rank.
 *
 * Uses the hypergeometric distribution:
 *   P(X >= needed) = 1 - Σ_{x=0}^{needed-1} P(X = x)
 *   where P(X = x) = C(copiesInPool, x) * C(poolSize - copiesInPool, unknownCards - x) / C(poolSize, unknownCards)
 *
 * This is exact Bayesian probability conditioned on the bot's own cards.
 */
function probAtLeastN(
  copiesInPool: number,
  poolSize: number,
  unknownCards: number,
  needed: number,
): number {
  if (needed <= 0) return 1.0;
  if (copiesInPool < needed) return 0.0;
  if (unknownCards <= 0) return 0.0;
  if (unknownCards > poolSize) return copiesInPool >= needed ? 1.0 : 0.0;

  const totalWays = choose(poolSize, unknownCards);
  if (totalWays === 0) return 0.0;

  let cumProb = 0;
  for (let x = 0; x < needed; x++) {
    const ways = choose(copiesInPool, x) * choose(poolSize - copiesInPool, unknownCards - x);
    cumProb += ways / totalWays;
  }

  return Math.max(0, Math.min(1, 1 - cumProb));
}

/**
 * Compute the Bayesian probability that a claimed hand exists across all
 * players' combined cards, conditioned on the bot's own hand.
 *
 * The bot knows its own cards, so it can compute exact probabilities
 * for what remains in the unknown cards (other players' hands).
 *
 * This is the key advantage: a bot holding 2 of the 4 sevens knows that
 * "pair of 7s" among 8 total cards is almost certain (the 2 remaining
 * sevens are among 6 unknown cards), while a bot with zero sevens knows
 * it's much less likely.
 *
 * Returns a value in [0, 1] representing P(hand exists | my cards).
 */
function computeHandExistsProbability(
  hand: HandCall,
  myCards: Card[],
  totalCards: number,
  deckSize: number = 52,
): number {
  const unknownCards = totalCards - myCards.length;
  const poolSize = deckSize - myCards.length; // Cards we haven't seen

  if (unknownCards <= 0 || poolSize <= 0) {
    // All cards are ours — check directly
    return checkHandInCards(hand, myCards) ? 1.0 : 0.0;
  }

  switch (hand.type) {
    case HandType.HIGH_CARD: {
      // P(at least 1 copy of rank X among all cards)
      const myCount = myCards.filter(c => c.rank === hand.rank).length;
      if (myCount >= 1) return 1.0; // We have it
      const poolCopies = 4 - myCount; // Copies of this rank in the pool
      return probAtLeastN(poolCopies, poolSize, unknownCards, 1);
    }

    case HandType.PAIR: {
      // P(at least 2 copies of rank X total)
      const myCount = myCards.filter(c => c.rank === hand.rank).length;
      const needed = Math.max(0, 2 - myCount);
      if (needed === 0) return 1.0; // We already have the pair
      const poolCopies = 4 - myCount;
      return probAtLeastN(poolCopies, poolSize, unknownCards, needed);
    }

    case HandType.THREE_OF_A_KIND: {
      const myCount = myCards.filter(c => c.rank === hand.rank).length;
      const needed = Math.max(0, 3 - myCount);
      if (needed === 0) return 1.0;
      const poolCopies = 4 - myCount;
      return probAtLeastN(poolCopies, poolSize, unknownCards, needed);
    }

    case HandType.FOUR_OF_A_KIND: {
      const myCount = myCards.filter(c => c.rank === hand.rank).length;
      const needed = Math.max(0, 4 - myCount);
      if (needed === 0) return 1.0;
      const poolCopies = 4 - myCount;
      return probAtLeastN(poolCopies, poolSize, unknownCards, needed);
    }

    case HandType.TWO_PAIR: {
      // P(pair of highRank AND pair of lowRank) — approximate as independent
      const hiCount = myCards.filter(c => c.rank === hand.highRank).length;
      const loCount = myCards.filter(c => c.rank === hand.lowRank).length;
      const hiNeeded = Math.max(0, 2 - hiCount);
      const loNeeded = Math.max(0, 2 - loCount);

      const pHi = hiNeeded === 0 ? 1.0 : probAtLeastN(4 - hiCount, poolSize, unknownCards, hiNeeded);
      const pLo = loNeeded === 0 ? 1.0 : probAtLeastN(4 - loCount, poolSize, unknownCards, loNeeded);
      // Independence approximation (slightly optimistic for tight pools)
      return pHi * pLo;
    }

    case HandType.FLUSH: {
      // P(at least 5 cards of suit X across all cards)
      const mySuitCount = myCards.filter(c => c.suit === hand.suit).length;
      const needed = Math.max(0, 5 - mySuitCount);
      if (needed === 0) return 1.0;
      const poolCopies = 13 - mySuitCount; // 13 cards per suit minus what I hold
      return probAtLeastN(poolCopies, poolSize, unknownCards, needed);
    }

    case HandType.FULL_HOUSE: {
      // P(3 of threeRank AND 2 of twoRank)
      const threeCount = myCards.filter(c => c.rank === hand.threeRank).length;
      const twoCount = myCards.filter(c => c.rank === hand.twoRank).length;
      const threeNeeded = Math.max(0, 3 - threeCount);
      const twoNeeded = Math.max(0, 2 - twoCount);

      const pThree = threeNeeded === 0 ? 1.0 : probAtLeastN(4 - threeCount, poolSize, unknownCards, threeNeeded);
      const pTwo = twoNeeded === 0 ? 1.0 : probAtLeastN(4 - twoCount, poolSize, unknownCards, twoNeeded);
      return pThree * pTwo;
    }

    case HandType.STRAIGHT: {
      // 5 consecutive ranks. Approximate: product of P(at least 1 of each rank).
      const highVal = RANK_VALUES[hand.highRank];
      let prob = 1.0;
      for (let v = highVal; v > highVal - 5; v--) {
        const rank = Object.entries(RANK_VALUES).find(([, val]) => val === v)?.[0] as Rank | undefined;
        if (!rank) return 0;
        const myCount = myCards.filter(c => c.rank === rank).length;
        if (myCount >= 1) continue; // We have this rank
        const poolCopies = 4 - myCount;
        prob *= probAtLeastN(poolCopies, poolSize, unknownCards, 1);
      }
      return prob;
    }

    case HandType.STRAIGHT_FLUSH: {
      // 5 consecutive cards of the same suit
      const highVal = RANK_VALUES[hand.highRank];
      let prob = 1.0;
      for (let v = highVal; v > highVal - 5; v--) {
        const rank = Object.entries(RANK_VALUES).find(([, val]) => val === v)?.[0] as Rank | undefined;
        if (!rank) return 0;
        const hasIt = myCards.some(c => c.rank === rank && c.suit === hand.suit);
        if (hasIt) continue;
        // Exactly 1 copy of this specific card in the pool (if we don't have it)
        const poolCopies = 1;
        prob *= probAtLeastN(poolCopies, poolSize, unknownCards, 1);
      }
      return prob;
    }

    case HandType.ROYAL_FLUSH: {
      // 10, J, Q, K, A of a specific suit
      const royalRanks: Rank[] = ['10', 'J', 'Q', 'K', 'A'];
      let prob = 1.0;
      for (const rank of royalRanks) {
        const hasIt = myCards.some(c => c.rank === rank && c.suit === hand.suit);
        if (hasIt) continue;
        const poolCopies = 1;
        prob *= probAtLeastN(poolCopies, poolSize, unknownCards, 1);
      }
      return prob;
    }
  }
}

/** Quick check if a hand is satisfied by the given cards alone. */
function checkHandInCards(hand: HandCall, cards: Card[]): boolean {
  switch (hand.type) {
    case HandType.HIGH_CARD:
      return cards.some(c => c.rank === hand.rank);
    case HandType.PAIR:
      return cards.filter(c => c.rank === hand.rank).length >= 2;
    case HandType.THREE_OF_A_KIND:
      return cards.filter(c => c.rank === hand.rank).length >= 3;
    case HandType.FOUR_OF_A_KIND:
      return cards.filter(c => c.rank === hand.rank).length >= 4;
    default:
      return false; // Conservative for complex hands
  }
}

// ── Heuristic fallback ───────────────────────────────────────────────

/**
 * Context-aware fallback when info set is missing from trained strategy.
 *
 * Key improvements over naive uniform:
 * - When claim plausibility is low, heavily favor bull
 * - When claim height is very high (escalation spiral), favor bull
 * - Bluff weights scale down with fewer total cards
 * - Truthful claims preferred when possible
 */
function heuristicFallback(
  legalActions: AbstractAction[],
  currentHand: HandCall | null,
  totalCards: number,
): AbstractAction {
  const weights = new Map<AbstractAction, number>();
  for (const action of legalActions) {
    weights.set(action, 1);
  }

  const plausibility = claimPlausibility(currentHand, totalCards);
  const heightScore = claimHeightScore(currentHand);

  // Bull weight scales inversely with plausibility
  // plausibility 0.0 → bull weight 12 (overwhelmingly call bull)
  // plausibility 0.5 → bull weight 4
  // plausibility 1.0 → bull weight 2
  if (legalActions.includes(AbstractAction.BULL)) {
    const bullWeight = Math.max(2, Math.round(12 - 10 * plausibility));
    weights.set(AbstractAction.BULL, bullWeight);
  }

  // True weight scales with plausibility
  if (legalActions.includes(AbstractAction.TRUE)) {
    const trueWeight = Math.max(1, Math.round(5 * plausibility));
    weights.set(AbstractAction.TRUE, trueWeight);
  }

  // Pass is favored in last-chance
  if (legalActions.includes(AbstractAction.PASS)) {
    weights.set(AbstractAction.PASS, 4);
  }

  // Raise weights scale down when claims are already high
  // (prevents escalation spirals in fallback)
  const raiseScale = Math.max(0.1, 1 - heightScore);

  if (legalActions.includes(AbstractAction.TRUTHFUL_LOW)) {
    weights.set(AbstractAction.TRUTHFUL_LOW, Math.max(1, Math.round(4 * raiseScale)));
  }
  if (legalActions.includes(AbstractAction.TRUTHFUL_MID)) {
    weights.set(AbstractAction.TRUTHFUL_MID, Math.max(1, Math.round(2 * raiseScale)));
  }
  if (legalActions.includes(AbstractAction.TRUTHFUL_HIGH)) {
    weights.set(AbstractAction.TRUTHFUL_HIGH, Math.max(1, Math.round(1 * raiseScale)));
  }

  // Bluffs: minimal weight, further reduced by high claims or low cards
  const bluffScale = raiseScale * Math.min(1, totalCards / 10);
  if (legalActions.includes(AbstractAction.BLUFF_SMALL)) {
    weights.set(AbstractAction.BLUFF_SMALL, Math.max(1, Math.round(2 * bluffScale)));
  }
  if (legalActions.includes(AbstractAction.BLUFF_MID)) {
    weights.set(AbstractAction.BLUFF_MID, Math.max(1, Math.round(1 * bluffScale)));
  }
  if (legalActions.includes(AbstractAction.BLUFF_BIG)) {
    weights.set(AbstractAction.BLUFF_BIG, Math.max(1, Math.round(1 * bluffScale)));
  }

  let totalWeight = 0;
  for (const w of weights.values()) totalWeight += w;
  const r = Math.random() * totalWeight;
  let cumulative = 0;
  for (const action of legalActions) {
    cumulative += weights.get(action) ?? 1;
    if (r <= cumulative) return action;
  }
  return legalActions[legalActions.length - 1]!;
}

// ── Strategy adjustment ──────────────────────────────────────────────

/**
 * Apply post-strategy safety adjustments to prevent implausible behavior.
 *
 * The trained strategy may not cover all edge cases (especially multiplayer
 * early rounds with few total cards). These overrides act as guardrails:
 *
 * 1. When the current claim is implausible (e.g., two-pair with 5 total cards),
 *    shift probability mass heavily toward BULL.
 * 2. When claims have escalated very high (full house+), increase BULL weight
 *    to prevent bots from endlessly raising to royal flush.
 * 3. Remove raise actions that would produce implausible claims.
 */
function adjustStrategyForPlausibility(
  probs: Map<AbstractAction, number>,
  legalActions: AbstractAction[],
  currentHand: HandCall | null,
  totalCards: number,
): void {
  const plausibility = claimPlausibility(currentHand, totalCards);
  const heightScore = claimHeightScore(currentHand);

  const hasBull = legalActions.includes(AbstractAction.BULL);

  // Adjustment 1: When claims are implausible, shift mass toward bull
  if (hasBull && plausibility < 0.5) {
    // Transfer probability from raise actions to bull
    const bullBoost = (0.5 - plausibility) * 1.5; // 0 to 0.75 extra for bull
    const raiseActions = legalActions.filter(a =>
      a !== AbstractAction.BULL && a !== AbstractAction.TRUE && a !== AbstractAction.PASS,
    );

    let raiseMass = 0;
    for (const a of raiseActions) {
      raiseMass += probs.get(a) ?? 0;
    }

    if (raiseMass > 0) {
      // Reduce raise mass and shift to bull
      const transfer = Math.min(raiseMass * 0.8, bullBoost);
      const scale = 1 - transfer / raiseMass;
      for (const a of raiseActions) {
        probs.set(a, (probs.get(a) ?? 0) * scale);
      }
      probs.set(AbstractAction.BULL, (probs.get(AbstractAction.BULL) ?? 0) + transfer);
    }
  }

  // Adjustment 2: When claims are very high (escalation spiral), boost bull.
  // Straight+ claims (heightScore >= 0.5) should heavily favor bull to
  // prevent the insane raising patterns observed in replay analysis.
  if (hasBull && heightScore > 0.45) {
    // Quadratic scaling with stronger multiplier:
    // 0.45→0, 0.55→0.10, 0.6→0.22, 0.7→0.62, 0.8→1.0 (capped)
    const excess = heightScore - 0.45;
    const escalationBoost = Math.min(excess * excess * 10, 1.0);
    const raiseActions = legalActions.filter(a =>
      a !== AbstractAction.BULL && a !== AbstractAction.TRUE && a !== AbstractAction.PASS,
    );

    let raiseMass = 0;
    for (const a of raiseActions) {
      raiseMass += probs.get(a) ?? 0;
    }

    if (raiseMass > 0) {
      const transfer = Math.min(raiseMass * 0.9, escalationBoost);
      const scale = 1 - transfer / raiseMass;
      for (const a of raiseActions) {
        probs.set(a, (probs.get(a) ?? 0) * scale);
      }
      probs.set(AbstractAction.BULL, (probs.get(AbstractAction.BULL) ?? 0) + transfer);
    }
  }

  // Adjustment 2b: When current claim is at or near the plausibility ceiling,
  // any raise will produce an implausible hand. Kill raise probability early
  // so bots don't waste turns generating hands that get overridden to bull.
  if (hasBull && currentHand) {
    const currentType = currentHand.type;
    // Find the max plausible type for this card count
    let maxPlausible = HandType.HIGH_CARD;
    for (let t = HandType.ROYAL_FLUSH; t >= HandType.HIGH_CARD; t--) {
      if (totalCards >= (MIN_CARDS_FOR_PLAUSIBLE[t] ?? 999)) {
        maxPlausible = t as HandType;
        break;
      }
    }
    // If current claim is already ABOVE the plausible ceiling,
    // raises can only go higher into implausible territory.
    // Note: strictly greater than — when AT the ceiling, same-type raises
    // (e.g., higher rank within the same hand type) are still valid.
    if (currentType > maxPlausible) {
      const raiseActions = legalActions.filter(a =>
        a !== AbstractAction.BULL && a !== AbstractAction.TRUE && a !== AbstractAction.PASS,
      );
      let raiseMass = 0;
      for (const a of raiseActions) {
        raiseMass += probs.get(a) ?? 0;
      }
      if (raiseMass > 0) {
        // Transfer 95% of raise mass to bull — raises are almost certainly implausible
        const transfer = raiseMass * 0.95;
        const scale = 0.05;
        for (const a of raiseActions) {
          probs.set(a, (probs.get(a) ?? 0) * scale);
        }
        probs.set(AbstractAction.BULL, (probs.get(AbstractAction.BULL) ?? 0) + transfer);
      }
    }
  }

  // Adjustment 3: When claim is near-impossible, make bull near-certain
  if (hasBull && plausibility === 0.0) {
    // Override: 90% bull, split remaining among other legal actions
    const otherActions = legalActions.filter(a => a !== AbstractAction.BULL);
    probs.set(AbstractAction.BULL, 0.9);
    const remaining = 0.1 / otherActions.length;
    for (const a of otherActions) {
      probs.set(a, remaining);
    }
  }
}

// ── Opponent claim credibility ───────────────────────────────────────

/**
 * Adjusts bull/true probabilities based on the insight that players who
 * make claims likely hold cards supporting those claims.
 *
 * Key insight: when a player opens with "pair of 7s", they almost certainly
 * hold at least one 7. The current Bayesian probability treats unknown cards
 * as uniform random, but the claimant's cards are biased toward their claim.
 *
 * This is especially impactful for:
 * - Opening claims (the opener chose this specific hand for a reason)
 * - Low claims (high card, pair) which are almost always truthful
 * - Heads-up games where there's only one opponent to model
 *
 * The adjustment reduces bull probability on credible opening claims and
 * increases it when claims seem like escalation bluffs (high claim height
 * after many turns = more likely to be a bluff).
 */
function adjustForOpponentCredibility(
  probs: Map<AbstractAction, number>,
  legalActions: AbstractAction[],
  state: ClientGameState,
  totalCards: number,
  activePlayers: number,
): void {
  if (!state.currentHand) return;
  const hasBull = legalActions.includes(AbstractAction.BULL);
  if (!hasBull) return;

  const turnCount = state.turnHistory.length;
  const heightScore = claimHeightScore(state.currentHand);

  // Opening claims (turn 0-1) are highly credible — players almost always
  // claim something they can back up. Don't waste a life calling bull.
  // Credibility decays with turn depth as claims escalate through raises.
  let credibilityBoost = 0;

  if (turnCount <= 1 && state.currentHand.type <= HandType.PAIR) {
    // Opening low claim — extremely credible.
    // High card: opener has it ~95%+ of the time.
    // Pair: opener likely has at least one of the rank.
    credibilityBoost = state.currentHand.type === HandType.HIGH_CARD ? 0.40 : 0.25;
  } else if (turnCount <= 3 && heightScore < 0.3) {
    // Early low claims are still fairly credible
    credibilityBoost = 0.15;
  }

  // Late-round high claims are less credible — more likely forced bluffs
  if (turnCount >= 5 && heightScore > 0.5) {
    // Escalation bluff detection: reduce credibility (boost bull)
    const bluffSignal = Math.min((turnCount - 4) * 0.05, 0.20) * heightScore;
    credibilityBoost = -bluffSignal;
  }

  if (Math.abs(credibilityBoost) < 0.02) return;

  if (credibilityBoost > 0) {
    // Claim is credible → reduce bull probability
    const currentBull = probs.get(AbstractAction.BULL) ?? 0;
    const transfer = currentBull * credibilityBoost;
    probs.set(AbstractAction.BULL, currentBull - transfer);
    // Distribute to other actions proportionally
    const others = legalActions.filter(a => a !== AbstractAction.BULL);
    let otherTotal = 0;
    for (const a of others) otherTotal += probs.get(a) ?? 0;
    if (otherTotal > 0) {
      for (const a of others) {
        probs.set(a, (probs.get(a) ?? 0) + transfer * ((probs.get(a) ?? 0) / otherTotal));
      }
    }
  } else {
    // Claim is suspicious → boost bull
    const boost = Math.abs(credibilityBoost);
    const donors = legalActions.filter(a => a !== AbstractAction.BULL && a !== AbstractAction.PASS);
    let donorMass = 0;
    for (const a of donors) donorMass += probs.get(a) ?? 0;
    if (donorMass > 0) {
      const transfer = donorMass * boost;
      const scale = 1 - transfer / donorMass;
      for (const a of donors) {
        probs.set(a, (probs.get(a) ?? 0) * scale);
      }
      probs.set(AbstractAction.BULL, (probs.get(AbstractAction.BULL) ?? 0) + transfer);
    }
  }
}

// ── Heads-up card knowledge boost ───────────────────────────────────

/**
 * In heads-up (2-player) situations, the bot's cards provide much
 * stronger information because there are fewer unknown cards.
 *
 * With 2 players holding 3 cards each (6 total), the bot sees 3/6 = 50%
 * of all cards. With 5 cards each (10 total), it sees 5/10 = 50%.
 * The base card knowledge adjustment treats all game sizes the same,
 * but in heads-up the signal is much stronger.
 *
 * This adjustment amplifies the card knowledge effect when:
 * - There are only 2 active players
 * - The bot can see a significant fraction of total cards
 * - The exact probability strongly disagrees with the baseline
 */
function adjustForHeadsUpCardKnowledge(
  probs: Map<AbstractAction, number>,
  legalActions: AbstractAction[],
  currentHand: HandCall | null,
  myCards: Card[],
  totalCards: number,
  activePlayers: number,
): void {
  if (activePlayers > 2) return; // Only applies to heads-up
  if (!currentHand) return;

  const hasBull = legalActions.includes(AbstractAction.BULL);
  const hasTrue = legalActions.includes(AbstractAction.TRUE);
  if (!hasBull && !hasTrue) return;

  const exactProb = computeHandExistsProbability(currentHand, myCards, totalCards);
  const baselinePlaus = claimPlausibility(currentHand, totalCards);
  const shift = exactProb - baselinePlaus;

  // In heads-up, we can trust the exact probability more because we see
  // a larger fraction of the cards. Lower the threshold and increase strength.
  if (Math.abs(shift) < 0.03) return; // Lower threshold than standard (0.05)

  // Visibility ratio: what fraction of total cards can we see?
  const visibilityRatio = myCards.length / Math.max(1, totalCards);
  // Scale strength by visibility — seeing 50% of cards is much more informative
  // than seeing 10% of cards. Range: 0.6 (low visibility) to 0.75 (high visibility)
  const strengthMultiplier = 0.6 + visibilityRatio * 0.3;
  const adjustmentStrength = Math.min(Math.abs(shift) * 1.2, strengthMultiplier);

  if (shift > 0 && hasBull) {
    // Hand MORE likely in heads-up → aggressively reduce bull
    const currentBull = probs.get(AbstractAction.BULL) ?? 0;
    const transfer = currentBull * adjustmentStrength;
    probs.set(AbstractAction.BULL, currentBull - transfer);
    if (hasTrue) {
      probs.set(AbstractAction.TRUE, (probs.get(AbstractAction.TRUE) ?? 0) + transfer * 0.7);
      const others = legalActions.filter(a => a !== AbstractAction.BULL && a !== AbstractAction.TRUE);
      const otherTotal = others.reduce((s, a) => s + (probs.get(a) ?? 0), 0);
      if (otherTotal > 0) {
        for (const a of others) {
          probs.set(a, (probs.get(a) ?? 0) + transfer * 0.3 * ((probs.get(a) ?? 0) / otherTotal));
        }
      }
    }
  } else if (shift < 0 && hasBull) {
    // Hand LESS likely in heads-up → aggressively boost bull
    const donors = legalActions.filter(a => a !== AbstractAction.BULL && a !== AbstractAction.PASS);
    let donorMass = 0;
    for (const a of donors) donorMass += probs.get(a) ?? 0;
    if (donorMass > 0) {
      const transfer = donorMass * adjustmentStrength;
      const scale = 1 - transfer / donorMass;
      for (const a of donors) {
        probs.set(a, (probs.get(a) ?? 0) * scale);
      }
      probs.set(AbstractAction.BULL, (probs.get(AbstractAction.BULL) ?? 0) + transfer);
    }
  }
}

// ── Disproof awareness ──────────────────────────────────────────────

/**
 * When the bot's own cards make the claimed hand nearly impossible,
 * call bull with near-certainty.
 *
 * Examples:
 * - Bot holds 3 of the 4 sevens → "four of a kind 7s" is impossible
 * - Bot holds 2 of the 4 sevens → "three 7s" needs the remaining 2 from
 *   unknown cards, which is much less likely than baseline
 * - Bot holds 4 cards of a suit → opponent claiming flush in that suit
 *   needs 5 of the remaining 9 from unknown cards
 *
 * This is the "card counter's edge" — a strong human player would
 * instantly recognize these situations.
 */
function adjustForDisproofAwareness(
  probs: Map<AbstractAction, number>,
  legalActions: AbstractAction[],
  currentHand: HandCall | null,
  myCards: Card[],
  totalCards: number,
): void {
  if (!currentHand) return;
  const hasBull = legalActions.includes(AbstractAction.BULL);
  if (!hasBull) return;

  const exactProb = computeHandExistsProbability(currentHand, myCards, totalCards);

  // When our cards make the hand nearly impossible (< 5% probability),
  // we should call bull with very high confidence. This catches cases
  // where the baseline plausibility is "maybe" but our specific cards
  // tell us it's actually near-impossible.
  if (exactProb < 0.05) {
    // Near-disproof: override to ~90% bull
    const bullTarget = 0.90;
    const currentBull = probs.get(AbstractAction.BULL) ?? 0;
    if (currentBull < bullTarget) {
      const others = legalActions.filter(a => a !== AbstractAction.BULL);
      probs.set(AbstractAction.BULL, bullTarget);
      const remaining = 1 - bullTarget;
      const otherTotal = others.reduce((s, a) => s + (probs.get(a) ?? 0), 0);
      if (otherTotal > 0) {
        for (const a of others) {
          probs.set(a, remaining * ((probs.get(a) ?? 0) / otherTotal));
        }
      } else {
        const share = remaining / others.length;
        for (const a of others) probs.set(a, share);
      }
    }
  } else if (exactProb < 0.15) {
    // Low probability: strong bull bias but not override-level
    const bullBoost = (0.15 - exactProb) * 4; // 0 to 0.6
    const currentBull = probs.get(AbstractAction.BULL) ?? 0;
    const donors = legalActions.filter(a => a !== AbstractAction.BULL && a !== AbstractAction.PASS);
    let donorMass = 0;
    for (const a of donors) donorMass += probs.get(a) ?? 0;
    if (donorMass > 0) {
      const transfer = Math.min(donorMass * 0.8, bullBoost);
      const scale = 1 - transfer / donorMass;
      for (const a of donors) {
        probs.set(a, (probs.get(a) ?? 0) * scale);
      }
      probs.set(AbstractAction.BULL, currentBull + transfer);
    }
  }
}

// ── Anti-cascade adjustment ─────────────────────────────────────────

/**
 * Prevents herding behavior in bull_phase where bots blindly follow
 * earlier voters' decisions, causing destructive cascades.
 *
 * Observed in replays: when 2+ bots call true, remaining bots pile on
 * true even when the hand is unlikely (7 bots calling true on a
 * non-existent two-pair). Similarly, when many call bull on a plausible
 * hand, the rest follow instead of applying independent judgment.
 *
 * Fix: Each bot applies independent skepticism that scales with the
 * number of same-direction votes already cast.
 */
function adjustForSentimentCascade(
  probs: Map<AbstractAction, number>,
  legalActions: AbstractAction[],
  state: ClientGameState,
  totalCards: number,
): void {
  if (state.roundPhase !== RoundPhase.BULL_PHASE) return;

  const hasBull = legalActions.includes(AbstractAction.BULL);
  const hasTrue = legalActions.includes(AbstractAction.TRUE);
  if (!hasBull || !hasTrue) return;

  let bullCount = 0;
  let trueCount = 0;
  for (const entry of state.turnHistory) {
    if (entry.action === 'bull') bullCount++;
    if (entry.action === 'true') trueCount++;
  }

  const plausibility = claimPlausibility(state.currentHand, totalCards);

  // True cascade: multiple true votes on a hand that isn't clearly real.
  // If the hand were obviously real, it wouldn't need defenders — be skeptical.
  // Aggressive: even 1 prior true vote triggers skepticism on unlikely hands.
  if (trueCount >= 1 && plausibility < 1.0) {
    // Quadratic scaling: 1 true→0.15, 2→0.30, 3→0.45, capped at 0.60
    const cascadeFactor = Math.min(trueCount * 0.15, 0.60);
    const skepticism = cascadeFactor * (1 - plausibility);
    const currentTrue = probs.get(AbstractAction.TRUE) ?? 0;
    const transfer = Math.min(currentTrue * 0.75, skepticism);
    probs.set(AbstractAction.TRUE, currentTrue - transfer);
    probs.set(AbstractAction.BULL, (probs.get(AbstractAction.BULL) ?? 0) + transfer);
  }

  // Bull cascade: many bull votes on a plausible hand.
  // Don't follow the crowd when the hand is likely to exist.
  if (bullCount >= 2 && plausibility >= 0.5) {
    const contraryFactor = Math.min(bullCount * 0.08, 0.40);
    const contraryBoost = contraryFactor * plausibility;
    const currentBull = probs.get(AbstractAction.BULL) ?? 0;
    const transfer = Math.min(currentBull * 0.5, contraryBoost);
    probs.set(AbstractAction.BULL, currentBull - transfer);
    probs.set(AbstractAction.TRUE, (probs.get(AbstractAction.TRUE) ?? 0) + transfer);
  }
}

// ── Low-claim protection ────────────────────────────────────────────

/**
 * Prevents calling bull on very low claims when many cards are in play.
 *
 * "High card Q" with 7+ cards or "pair of X" with 15+ cards are almost
 * always going to exist. Calling bull is burning a life for no reason.
 *
 * Observed: Viper called bull on "high card Q" heads-up with 7 total
 * cards — Q exists among 7 random cards ~46% of the time, and the
 * opponent likely holds it since they claimed it.
 */
function adjustForLowClaims(
  probs: Map<AbstractAction, number>,
  legalActions: AbstractAction[],
  currentHand: HandCall | null,
  totalCards: number,
): void {
  if (!currentHand) return;
  const hasBull = legalActions.includes(AbstractAction.BULL);
  if (!hasBull) return;

  let protection = 0;

  if (currentHand.type === HandType.HIGH_CARD) {
    // P(rank X exists) ≈ 1 - (48/52)^N. With 5 cards: ~35%, 9: ~54%.
    // The opener likely HAS the card they're claiming, making bull even worse.
    // In heads-up (≤10 total cards), the opponent almost certainly has what
    // they claimed — protecting even at 3+ cards.
    if (totalCards >= 3) {
      protection = Math.min(0.75, (totalCards - 2) * 0.08);
    }
  } else if (currentHand.type === HandType.PAIR) {
    // Pair of X needs 2+ of a specific rank among N cards.
    // With 12 cards: ~22%, 16: ~37%. Still risky to bull.
    if (totalCards >= 8) {
      protection = Math.min(0.50, (totalCards - 6) * 0.05);
    }
  }

  if (protection > 0) {
    const currentBull = probs.get(AbstractAction.BULL) ?? 0;
    const transfer = currentBull * protection;
    probs.set(AbstractAction.BULL, currentBull - transfer);

    // Distribute transferred mass proportionally to other actions
    const otherActions = legalActions.filter(a => a !== AbstractAction.BULL);
    let otherTotal = 0;
    for (const a of otherActions) {
      otherTotal += probs.get(a) ?? 0;
    }
    if (otherTotal > 0) {
      for (const a of otherActions) {
        const current = probs.get(a) ?? 0;
        probs.set(a, current + transfer * (current / otherTotal));
      }
    }
  }
}

// ── Last-chance pass encouragement ──────────────────────────────────

/**
 * In last-chance phase, favors passing over raising to implausible hands.
 *
 * When a bot's claim is challenged and they get last chance, raising to
 * an even higher hand is only valuable if the new claim is plausible.
 * Raising to three-of-a-kind with 9 cards (as observed in replays)
 * guarantees losing when everyone calls bull again.
 *
 * If the current claim might already be false, passing lets the round
 * resolve on the existing claim — which might actually penalize the
 * bull callers if it happens to exist.
 */
function adjustForLastChancePass(
  probs: Map<AbstractAction, number>,
  legalActions: AbstractAction[],
  currentHand: HandCall | null,
  totalCards: number,
): void {
  if (!legalActions.includes(AbstractAction.PASS)) return;

  const plausibility = claimPlausibility(currentHand, totalCards);
  const heightScore = claimHeightScore(currentHand);

  // When the current claim is already borderline or high, raising
  // will almost certainly produce something even less plausible.
  // In last-chance, the safest play is usually to pass and let the
  // round resolve on the existing claim — if it exists, the bull
  // callers get penalized. Raising only helps if the new claim is
  // both plausible AND more likely to exist.
  if (plausibility <= 0.9 || heightScore >= 0.2) {
    const passBoost = Math.max(
      (1.0 - plausibility) * 0.7,    // Low plausibility → very strong pass
      (heightScore - 0.1) * 0.5,     // High claim → strong pass
    );

    const raiseActions = legalActions.filter(a =>
      a !== AbstractAction.PASS && a !== AbstractAction.BULL && a !== AbstractAction.TRUE,
    );

    let raiseMass = 0;
    for (const a of raiseActions) {
      raiseMass += probs.get(a) ?? 0;
    }

    if (raiseMass > 0) {
      const transfer = Math.min(raiseMass * 0.85, passBoost);
      const scale = 1 - transfer / raiseMass;
      for (const a of raiseActions) {
        probs.set(a, (probs.get(a) ?? 0) * scale);
      }
      probs.set(AbstractAction.PASS, (probs.get(AbstractAction.PASS) ?? 0) + transfer);
    }
  }
}

// ── Card-aware Bayesian adjustment ───────────────────────────────────

/**
 * Uses the bot's own cards to compute exact Bayesian probability that
 * the current claim exists, then adjusts bull/true probabilities.
 *
 * This is the single most impactful decision improvement: a human
 * expert counts cards to estimate whether a claim is real. Without
 * this, the bot treats "pair of 7s" the same whether it holds two
 * 7s (making it near-certain) or zero 7s (making it less likely).
 *
 * The adjustment is proportional to the distance between the computed
 * probability and the baseline plausibility, preventing overcorrection
 * when the trained strategy already accounts for the general case.
 */
function adjustForCardKnowledge(
  probs: Map<AbstractAction, number>,
  legalActions: AbstractAction[],
  currentHand: HandCall | null,
  myCards: Card[],
  totalCards: number,
): void {
  if (!currentHand) return;

  const hasBull = legalActions.includes(AbstractAction.BULL);
  const hasTrue = legalActions.includes(AbstractAction.TRUE);
  if (!hasBull && !hasTrue) return;

  const exactProb = computeHandExistsProbability(currentHand, myCards, totalCards);
  const baselinePlaus = claimPlausibility(currentHand, totalCards);

  // The "surprise" is how much our card knowledge shifts the probability
  // relative to what the general plausibility suggests.
  // Positive shift = hand more likely than baseline → favor true, reduce bull
  // Negative shift = hand less likely than baseline → favor bull, reduce true
  const shift = exactProb - baselinePlaus;

  // Only apply meaningful adjustments (|shift| > 0.05 avoids noise)
  if (Math.abs(shift) < 0.05) return;

  // Scale the adjustment — max 55% probability transfer. Card counting
  // is the single most impactful signal; the trained strategy doesn't have
  // access to exact card information, so we allow strong overrides.
  const adjustmentStrength = Math.min(Math.abs(shift) * 0.9, 0.55);

  if (shift > 0 && hasBull) {
    // Hand is MORE likely than baseline → reduce bull, boost true/raise
    const currentBull = probs.get(AbstractAction.BULL) ?? 0;
    const transfer = currentBull * adjustmentStrength;
    probs.set(AbstractAction.BULL, currentBull - transfer);

    // Distribute to true first (if available), then other actions
    if (hasTrue) {
      probs.set(AbstractAction.TRUE, (probs.get(AbstractAction.TRUE) ?? 0) + transfer * 0.7);
      // Remaining 30% to other actions proportionally
      const otherActions = legalActions.filter(
        a => a !== AbstractAction.BULL && a !== AbstractAction.TRUE,
      );
      const otherTotal = otherActions.reduce((s, a) => s + (probs.get(a) ?? 0), 0);
      if (otherTotal > 0) {
        for (const a of otherActions) {
          probs.set(a, (probs.get(a) ?? 0) + transfer * 0.3 * ((probs.get(a) ?? 0) / otherTotal));
        }
      } else {
        probs.set(AbstractAction.TRUE, (probs.get(AbstractAction.TRUE) ?? 0) + transfer * 0.3);
      }
    } else {
      const otherActions = legalActions.filter(a => a !== AbstractAction.BULL);
      const otherTotal = otherActions.reduce((s, a) => s + (probs.get(a) ?? 0), 0);
      if (otherTotal > 0) {
        for (const a of otherActions) {
          probs.set(a, (probs.get(a) ?? 0) + transfer * ((probs.get(a) ?? 0) / otherTotal));
        }
      }
    }
  } else if (shift < 0 && hasBull) {
    // Hand is LESS likely than baseline → boost bull, reduce true/raise
    const raiseAndTrueActions = legalActions.filter(a => a !== AbstractAction.BULL && a !== AbstractAction.PASS);
    let donorMass = 0;
    for (const a of raiseAndTrueActions) {
      donorMass += probs.get(a) ?? 0;
    }
    if (donorMass > 0) {
      const transfer = donorMass * adjustmentStrength;
      const scale = 1 - transfer / donorMass;
      for (const a of raiseAndTrueActions) {
        probs.set(a, (probs.get(a) ?? 0) * scale);
      }
      probs.set(AbstractAction.BULL, (probs.get(AbstractAction.BULL) ?? 0) + transfer);
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Small epsilon-noise mixed into the strategy at eval time.
 * Prevents humans from building a perfect model of the bot's tendencies.
 * Even if they figure out the rough strategy, the noise makes specific
 * predictions unreliable across many games.
 */
const EVAL_EPSILON = 0.03;

/**
 * Make a CFR-based decision for a bot.
 *
 * Looks up the trained strategy for the current game state and samples
 * an action from the probability distribution. Applies post-strategy
 * plausibility adjustments to prevent implausible behavior, then mixes
 * in small epsilon-noise (3%) for unpredictability.
 *
 * @param state - The game state as seen by this bot
 * @param botCards - The bot's actual cards
 * @param totalCards - Total cards across all active players
 * @param activePlayers - Number of non-eliminated players
 * @param botPlayerId - Bot's player ID (for opponent aggression tracking)
 * @param wasPenalizedLastRound - Whether this bot lost the previous round
 * @returns A BotAction, or null if no legal actions (shouldn't happen in practice)
 */
export function decideCFR(
  state: ClientGameState,
  botCards: Card[],
  totalCards: number,
  activePlayers: number,
  jokerCount: JokerCount = 0,
  lastChanceMode: LastChanceMode = 'classic',
  botPlayerId: string = '',
  wasPenalizedLastRound: boolean = false,
): BotAction | null {
  const legalActions = getLegalAbstractActions(state);
  if (legalActions.length === 0) return null;

  // If strategy data hasn't been loaded yet, fall through to heuristic.
  // setCFRStrategyData() should be called before the first CFR decision.
  if (!_compactData) return null;

  const bucket = resolvePlayerBucket(activePlayers);

  const maxCards = state.maxCards ?? 5;
  const infoSetKey = getInfoSetKey(
    state, botCards, totalCards, activePlayers,
    jokerCount, lastChanceMode, botPlayerId, wasPenalizedLastRound, maxCards,
  );

  // Look up the strategy entry from compact v2 data
  let expanded: Record<string, number> | null = null;
  const result = lookupCompactStrategy(bucket, infoSetKey);
  recordStrategyLookup(result !== null);
  if (result) {
    expanded = {};
    for (const [key, prob] of Object.entries(result.entry)) {
      const fullKey = result.actionExpand[key] ?? key;
      expanded[fullKey] = prob;
    }
  }

  let chosenAction: AbstractAction;

  if (expanded) {

      // Build probability distribution over legal actions with epsilon-noise
      const uniform = 1 / legalActions.length;
      let totalProb = 0;
      const probs = new Map<AbstractAction, number>();
      for (const action of legalActions) {
        const base = expanded[action] ?? 0;
        // Mix in epsilon-noise: (1-ε)*strategy + ε*uniform
        const mixed = (1 - EVAL_EPSILON) * base + EVAL_EPSILON * uniform;
        probs.set(action, mixed);
        totalProb += mixed;
      }

      // Normalize
      if (totalProb > 0) {
        for (const action of legalActions) {
          probs.set(action, (probs.get(action) ?? 0) / totalProb);
        }
      }

      // V5: Only keep adjustments that use exact card information the
      // strategy cannot access. All plausibility, sentiment, credibility,
      // and low-claim adjustments are removed — V5's expanded info set
      // (corrected plausibility thresholds, phase-specific depth, vote
      // magnitude, elimination pressure) lets the strategy learn these
      // patterns directly during training.
      //
      // Kept: card knowledge (exact Bayesian), disproof awareness (card
      // counting), heads-up card knowledge (amplified signal in 1v1).
      // These use the bot's actual hand — information the strategy's
      // info set abstraction deliberately doesn't include.
      adjustForCardKnowledge(probs, legalActions, state.currentHand, botCards, totalCards);
      adjustForDisproofAwareness(probs, legalActions, state.currentHand, botCards, totalCards);
      adjustForHeadsUpCardKnowledge(probs, legalActions, state.currentHand, botCards, totalCards, activePlayers);

      // Sample from adjusted distribution
      let adjTotal = 0;
      for (const action of legalActions) {
        adjTotal += probs.get(action) ?? 0;
      }

      if (adjTotal > 0) {
        const r = Math.random() * adjTotal;
        let cumulative = 0;
        chosenAction = legalActions[legalActions.length - 1]!;
        for (const action of legalActions) {
          cumulative += probs.get(action) ?? 0;
          if (r <= cumulative) {
            chosenAction = action;
            break;
          }
        }
      } else {
        chosenAction = heuristicFallback(legalActions, state.currentHand, totalCards);
      }
  } else {
    chosenAction = heuristicFallback(legalActions, state.currentHand, totalCards);
  }

  return mapAbstractToConcreteAction(chosenAction, state, botCards, totalCards);
}

// ── Real-time subgame solving ─────────────────────────────────────

/**
 * Configuration for the Monte Carlo search component of decideCFRWithSearch.
 */
export interface SearchConfig {
  /** Number of Monte Carlo simulations to run. Higher = more accurate, slower. Default: 100. */
  simulations: number;
  /**
   * Blend weight for search results vs pre-trained strategy.
   * 0.0 = pure pre-trained, 1.0 = pure search. Default: 0.4.
   */
  searchWeight: number;
  /** Max wall-clock time budget in ms. Terminates early if exceeded. Default: 80. */
  timeBudgetMs: number;
}

const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  simulations: 200,
  // Increased from 0.15 to 0.30: with safety adjustments re-enabled, MC
  // search provides complementary card-aware correction. The pre-trained
  // strategy handles general game theory but MC catches complex hands
  // (straights, flushes, full houses) where independence assumptions break.
  searchWeight: 0.30,
  timeBudgetMs: 80,
};

/**
 * Build the full 52-card deck as a flat array.
 * Excludes jokers — joker-aware search would need deck expansion.
 */
function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const rank of ALL_RANKS) {
    for (const suit of ALL_SUITS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

/**
 * Fisher-Yates shuffle (in-place). Returns the array for chaining.
 */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/**
 * Sample random opponent hands by dealing from the remaining deck.
 *
 * Returns the combined cards (bot's cards + sampled opponent cards) that
 * represent one possible world consistent with the bot's knowledge.
 *
 * @param botCards - Cards the bot can see (its own hand)
 * @param opponentCardCounts - Array of card counts for each opponent
 * @returns All cards in play for this simulation
 */
function sampleOpponentCards(
  botCards: Card[],
  opponentCardCounts: number[],
): Card[] {
  // Remove bot's known cards from the deck
  const remaining = buildDeck().filter(
    c => !botCards.some(bc => bc.rank === c.rank && bc.suit === c.suit),
  );
  shuffle(remaining);

  const allCards = [...botCards];
  let dealt = 0;
  for (const count of opponentCardCounts) {
    for (let i = 0; i < count && dealt < remaining.length; i++) {
      allCards.push(remaining[dealt]!);
      dealt++;
    }
  }
  return allCards;
}

/**
 * Estimate the probability that a hand claim exists across all players'
 * cards using Monte Carlo sampling.
 *
 * More accurate than the closed-form Bayesian computation for complex
 * hand types (straight, flush, full house) where independence assumptions
 * break down.
 *
 * @param hand - The claimed hand to check
 * @param botCards - Bot's own cards
 * @param opponentCardCounts - Card count per opponent
 * @param simulations - Number of random worlds to sample
 * @param timeBudgetMs - Max wall-clock time before early termination
 * @returns Estimated probability [0, 1]
 */
function monteCarloHandExistence(
  hand: HandCall,
  botCards: Card[],
  opponentCardCounts: number[],
  simulations: number,
  timeBudgetMs: number,
): number {
  const startTime = Date.now();
  let exists = 0;
  let completed = 0;

  for (let i = 0; i < simulations; i++) {
    if (i > 0 && i % 20 === 0 && Date.now() - startTime > timeBudgetMs) break;

    const allCards = sampleOpponentCards(botCards, opponentCardCounts);
    if (HandChecker.exists(allCards, hand)) exists++;
    completed++;
  }

  return completed > 0 ? exists / completed : 0.5;
}

/**
 * For each raise action, estimate how likely the resulting hand claim
 * will survive (i.e., actually exist in the combined cards).
 *
 * A raise is stronger when the claimed hand is likely to be true —
 * if challenged, the bot wins. This biases toward truthful raises
 * and away from bluffs that are likely to get caught.
 *
 * @returns Map from abstract action to survival probability [0, 1]
 */
function estimateRaiseSurvival(
  legalActions: AbstractAction[],
  state: ClientGameState,
  botCards: Card[],
  opponentCardCounts: number[],
  simulations: number,
  timeBudgetMs: number,
): Map<AbstractAction, number> {
  const survival = new Map<AbstractAction, number>();
  const raiseActions = legalActions.filter(
    a => a !== AbstractAction.BULL && a !== AbstractAction.TRUE && a !== AbstractAction.PASS,
  );

  if (raiseActions.length === 0) return survival;

  // Generate concrete hands for each raise action
  const totalCards = botCards.length + opponentCardCounts.reduce((a, b) => a + b, 0);
  const concreteHands = new Map<AbstractAction, HandCall>();
  for (const action of raiseActions) {
    const result = mapAbstractToConcreteAction(action, state, botCards, totalCards);
    if (result.action === 'call' && 'hand' in result) {
      concreteHands.set(action, result.hand);
    } else if (result.action === 'lastChanceRaise' && 'hand' in result) {
      concreteHands.set(action, result.hand);
    }
  }

  // Budget time evenly across raise actions
  const perActionBudget = Math.max(10, timeBudgetMs / Math.max(1, concreteHands.size));
  const perActionSims = Math.max(10, Math.floor(simulations / Math.max(1, concreteHands.size)));

  for (const [action, hand] of concreteHands) {
    const prob = monteCarloHandExistence(
      hand, botCards, opponentCardCounts, perActionSims, perActionBudget,
    );
    survival.set(action, prob);
  }

  return survival;
}

/**
 * Enhanced CFR decision-making with real-time subgame solving.
 *
 * Extends decideCFR() with Monte Carlo search to refine decisions based
 * on the bot's actual cards. The pre-trained strategy provides a strong
 * "blueprint" — search improves it in two ways:
 *
 * 1. **Bull/true refinement**: Monte Carlo sampling gives a more accurate
 *    estimate of P(hand exists) than the closed-form Bayesian approximation,
 *    especially for complex hands (straights, flushes, full houses) where
 *    independence assumptions break down.
 *
 * 2. **Raise survival**: For each possible raise, estimates how likely the
 *    resulting claim is to actually exist. Raises that are likely true
 *    (and thus survive a bull challenge) get boosted; raises that are
 *    almost certainly false get suppressed.
 *
 * The final strategy is a blend of pre-trained + search results, weighted
 * by `searchWeight` (default 0.4 = 40% search, 60% pre-trained).
 *
 * Performance: Targets <100ms per decision. Time-budgeted with early
 * termination. Falls back to decideCFR() if search can't complete.
 *
 * @param state - The game state as seen by this bot
 * @param botCards - The bot's actual cards
 * @param totalCards - Total cards across all active players
 * @param activePlayers - Number of non-eliminated players
 * @param jokerCount - Jokers in the deck
 * @param lastChanceMode - Last chance raise mode
 * @param botPlayerId - Bot's player ID
 * @param wasPenalizedLastRound - Whether this bot lost the previous round
 * @param config - Search configuration (simulations, weight, time budget)
 * @returns A BotAction, or null if no legal actions
 */
export function decideCFRWithSearch(
  state: ClientGameState,
  botCards: Card[],
  totalCards: number,
  activePlayers: number,
  jokerCount: JokerCount = 0,
  lastChanceMode: LastChanceMode = 'classic',
  botPlayerId: string = '',
  wasPenalizedLastRound: boolean = false,
  config: Partial<SearchConfig> = {},
): BotAction | null {
  const searchConfig = { ...DEFAULT_SEARCH_CONFIG, ...config };
  const startTime = Date.now();

  const legalActions = getLegalAbstractActions(state);
  if (legalActions.length === 0) return null;
  if (!_compactData) return null;

  // ── Step 1: Get the base pre-trained strategy (same pipeline as decideCFR) ──

  const bucket = resolvePlayerBucket(activePlayers);
  const maxCards = state.maxCards ?? 5;
  const infoSetKey = getInfoSetKey(
    state, botCards, totalCards, activePlayers,
    jokerCount, lastChanceMode, botPlayerId, wasPenalizedLastRound, maxCards,
  );

  // Look up strategy from compact v2 data
  let expanded: Record<string, number> | null = null;
  const result = lookupCompactStrategy(bucket, infoSetKey);
  recordStrategyLookup(result !== null);
  if (result) {
    expanded = {};
    for (const [key, prob] of Object.entries(result.entry)) {
      expanded[result.actionExpand[key] ?? key] = prob;
    }
  }

  const baseProbs = new Map<AbstractAction, number>();

  if (expanded) {
      const uniform = 1 / legalActions.length;
      let totalProb = 0;
      for (const action of legalActions) {
        const base = expanded[action] ?? 0;
        const mixed = (1 - EVAL_EPSILON) * base + EVAL_EPSILON * uniform;
        baseProbs.set(action, mixed);
        totalProb += mixed;
      }
      if (totalProb > 0) {
        for (const action of legalActions) {
          baseProbs.set(action, (baseProbs.get(action) ?? 0) / totalProb);
        }
      }
  } else {
    const fb = heuristicFallbackProbs(legalActions, state.currentHand, totalCards);
    for (const [action, prob] of fb) {
      baseProbs.set(action, prob);
    }
  }

  // V5: Only card-knowledge adjustments (bot's exact cards — not in info set).
  adjustForCardKnowledge(baseProbs, legalActions, state.currentHand, botCards, totalCards);
  adjustForDisproofAwareness(baseProbs, legalActions, state.currentHand, botCards, totalCards);
  adjustForHeadsUpCardKnowledge(baseProbs, legalActions, state.currentHand, botCards, totalCards, activePlayers);

  // ── Step 2: Monte Carlo search refinement ──

  // Compute opponent card counts from game state
  const opponentCardCounts: number[] = [];
  for (const p of state.players) {
    if (!p.isEliminated && p.id !== (botPlayerId || state.currentPlayerId)) {
      opponentCardCounts.push(p.cardCount);
    }
  }

  const remainingBudget = searchConfig.timeBudgetMs - (Date.now() - startTime);
  if (remainingBudget < 10) {
    // No time for search — use base strategy directly
    return sampleAndMap(baseProbs, legalActions, state, botCards, totalCards);
  }

  const searchProbs = new Map<AbstractAction, number>();
  for (const action of legalActions) {
    searchProbs.set(action, baseProbs.get(action) ?? 0);
  }

  const hasBull = legalActions.includes(AbstractAction.BULL);
  const hasTrue = legalActions.includes(AbstractAction.TRUE);

  // ── 2a: Refine bull/true using Monte Carlo hand existence ──
  // The MC estimate is more accurate than closed-form Bayesian for complex
  // hand types (straights, flushes) where independence assumptions break.
  // We allocate all simulation budget here — raise selection is left to
  // the pre-trained strategy which already balances bluffs vs truth optimally.

  if (state.currentHand && (hasBull || hasTrue)) {
    const mcExistence = monteCarloHandExistence(
      state.currentHand, botCards, opponentCardCounts,
      searchConfig.simulations, remainingBudget,
    );

    const baseExact = computeHandExistsProbability(
      state.currentHand, botCards, totalCards,
    );

    // Only apply MC refinement when it disagrees meaningfully with closed-form.
    // With 200 samples, standard error ≈ 0.035, so 0.08 threshold requires
    // ~2.3σ divergence — confident enough while still responsive.
    const mcShift = mcExistence - baseExact;
    if (Math.abs(mcShift) > 0.08) {
      const mcStrength = Math.min(Math.abs(mcShift) * 0.8, 0.35);

      if (mcShift > 0 && hasBull) {
        // MC says hand MORE likely → reduce bull
        const currentBull = searchProbs.get(AbstractAction.BULL) ?? 0;
        const transfer = currentBull * mcStrength;
        searchProbs.set(AbstractAction.BULL, currentBull - transfer);
        if (hasTrue) {
          searchProbs.set(AbstractAction.TRUE, (searchProbs.get(AbstractAction.TRUE) ?? 0) + transfer);
        } else {
          distributeToOthers(searchProbs, legalActions, AbstractAction.BULL, transfer);
        }
      } else if (mcShift < 0 && hasBull) {
        // MC says hand LESS likely → boost bull
        const donors = legalActions.filter(a => a !== AbstractAction.BULL && a !== AbstractAction.PASS);
        let donorMass = 0;
        for (const a of donors) donorMass += searchProbs.get(a) ?? 0;
        if (donorMass > 0) {
          const transfer = donorMass * mcStrength;
          const scale = 1 - transfer / donorMass;
          for (const a of donors) {
            searchProbs.set(a, (searchProbs.get(a) ?? 0) * scale);
          }
          searchProbs.set(AbstractAction.BULL, (searchProbs.get(AbstractAction.BULL) ?? 0) + transfer);
        }
      }
    }
  }

  // NOTE: Raise survival estimation was removed. The pre-trained CFR strategy
  // already balances bluff vs truthful raises at game-theoretic frequencies.
  // MC survival estimation suppressed bluffs, making the bot predictable and
  // exploitable — a net -3.8pp loss in 1v1 win rate.

  // ── Step 3: Blend pre-trained and search strategies ──

  const finalProbs = new Map<AbstractAction, number>();
  const w = searchConfig.searchWeight;
  let finalTotal = 0;

  for (const action of legalActions) {
    const base = baseProbs.get(action) ?? 0;
    const search = searchProbs.get(action) ?? 0;
    const blended = (1 - w) * base + w * search;
    finalProbs.set(action, blended);
    finalTotal += blended;
  }

  // Normalize
  if (finalTotal > 0) {
    for (const action of legalActions) {
      finalProbs.set(action, (finalProbs.get(action) ?? 0) / finalTotal);
    }
  }

  return sampleAndMap(finalProbs, legalActions, state, botCards, totalCards);
}

/**
 * Convert heuristic fallback weights to a probability distribution.
 * Unlike heuristicFallback() which returns a sampled action, this returns
 * the full probability map for blending with search results.
 */
function heuristicFallbackProbs(
  legalActions: AbstractAction[],
  currentHand: HandCall | null,
  totalCards: number,
): Map<AbstractAction, number> {
  const weights = new Map<AbstractAction, number>();
  for (const action of legalActions) {
    weights.set(action, 1);
  }

  const plausibility = claimPlausibility(currentHand, totalCards);
  const heightScore = claimHeightScore(currentHand);

  if (legalActions.includes(AbstractAction.BULL)) {
    weights.set(AbstractAction.BULL, Math.max(2, Math.round(12 - 10 * plausibility)));
  }
  if (legalActions.includes(AbstractAction.TRUE)) {
    weights.set(AbstractAction.TRUE, Math.max(1, Math.round(5 * plausibility)));
  }
  if (legalActions.includes(AbstractAction.PASS)) {
    weights.set(AbstractAction.PASS, 4);
  }

  const raiseScale = Math.max(0.1, 1 - heightScore);
  if (legalActions.includes(AbstractAction.TRUTHFUL_LOW)) {
    weights.set(AbstractAction.TRUTHFUL_LOW, Math.max(1, Math.round(4 * raiseScale)));
  }
  if (legalActions.includes(AbstractAction.TRUTHFUL_MID)) {
    weights.set(AbstractAction.TRUTHFUL_MID, Math.max(1, Math.round(2 * raiseScale)));
  }
  if (legalActions.includes(AbstractAction.TRUTHFUL_HIGH)) {
    weights.set(AbstractAction.TRUTHFUL_HIGH, Math.max(1, Math.round(1 * raiseScale)));
  }

  const bluffScale = raiseScale * Math.min(1, totalCards / 10);
  if (legalActions.includes(AbstractAction.BLUFF_SMALL)) {
    weights.set(AbstractAction.BLUFF_SMALL, Math.max(1, Math.round(2 * bluffScale)));
  }
  if (legalActions.includes(AbstractAction.BLUFF_MID)) {
    weights.set(AbstractAction.BLUFF_MID, Math.max(1, Math.round(1 * bluffScale)));
  }
  if (legalActions.includes(AbstractAction.BLUFF_BIG)) {
    weights.set(AbstractAction.BLUFF_BIG, Math.max(1, Math.round(1 * bluffScale)));
  }

  // Normalize to probabilities
  let total = 0;
  for (const w of weights.values()) total += w;
  const probs = new Map<AbstractAction, number>();
  for (const [action, weight] of weights) {
    probs.set(action, total > 0 ? weight / total : 1 / legalActions.length);
  }
  return probs;
}

/**
 * Distribute probability mass from an excluded action to all other legal actions
 * proportionally.
 */
function distributeToOthers(
  probs: Map<AbstractAction, number>,
  legalActions: AbstractAction[],
  exclude: AbstractAction,
  amount: number,
): void {
  const others = legalActions.filter(a => a !== exclude);
  let otherTotal = 0;
  for (const a of others) otherTotal += probs.get(a) ?? 0;

  if (otherTotal > 0) {
    for (const a of others) {
      const current = probs.get(a) ?? 0;
      probs.set(a, current + amount * (current / otherTotal));
    }
  } else if (others.length > 0) {
    const share = amount / others.length;
    for (const a of others) {
      probs.set(a, (probs.get(a) ?? 0) + share);
    }
  }
}

/**
 * Sample an action from a probability distribution and map it to a concrete BotAction.
 */
function sampleAndMap(
  probs: Map<AbstractAction, number>,
  legalActions: AbstractAction[],
  state: ClientGameState,
  botCards: Card[],
  totalCards: number,
): BotAction {
  let total = 0;
  for (const action of legalActions) total += probs.get(action) ?? 0;

  if (total > 0) {
    const r = Math.random() * total;
    let cumulative = 0;
    for (const action of legalActions) {
      cumulative += probs.get(action) ?? 0;
      if (r <= cumulative) {
        return mapAbstractToConcreteAction(action, state, botCards, totalCards);
      }
    }
  }

  // Fallback: use last legal action
  return mapAbstractToConcreteAction(
    legalActions[legalActions.length - 1]!,
    state, botCards, totalCards,
  );
}

