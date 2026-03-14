/**
 * Heuristic opponent strategies for mixed-opponent 5 Draw CFR training.
 *
 * These mirror the evaluation opponents from evaluateFiveDraw.ts but are
 * structured for use inside the training loop. During mixed training,
 * the CFR player plays against these heuristic opponents instead of
 * itself, learning to exploit non-equilibrium play (e.g. passive players
 * who always pass).
 */

import type { Card, HandCall, Rank, Suit } from '@bull-em/shared';
import { HandType, RANK_VALUES, ALL_RANKS } from '@bull-em/shared';
import { getMinimumRaise, isHigherHand } from '@bull-em/shared';

export type HeuristicPlayerFn = (
  myCards: Card[],
  currentHand: HandCall | null,
  turnCount: number,
) => { action: 'call' | 'pass'; hand?: HandCall };

// ── Opening enforcement ──────────────────────────────────────────────

/**
 * Wrap a heuristic player to enforce the opening rule: P1 MUST call a hand
 * on the opening move (no passing). If the player tries to pass on opening,
 * force a minimum truthful call (high card with their best rank).
 */
function enforceOpening(
  fn: HeuristicPlayerFn,
): HeuristicPlayerFn {
  return (myCards, currentHand, turnCount) => {
    const result = fn(myCards, currentHand, turnCount);
    if (!currentHand && result.action === 'pass') {
      // Opening move — must call. Use best truthful hand (always available).
      const hand = pickBestTruthfulHand(myCards, null);
      if (hand) return { action: 'call', hand };
      // Absolute fallback: high card with best rank
      const bestRank = myCards.reduce(
        (best, c) => RANK_VALUES[c.rank] > RANK_VALUES[best] ? c.rank : best,
        myCards[0]!.rank,
      );
      return { action: 'call', hand: { type: HandType.HIGH_CARD, rank: bestRank } };
    }
    return result;
  };
}

// ── Opponent strategies ──────────────────────────────────────────────

function passivePlayerRaw(
  myCards: Card[],
  currentHand: HandCall | null,
): { action: 'call' | 'pass'; hand?: HandCall } {
  const hand = pickBestTruthfulHand(myCards, currentHand);
  if (hand && hand.type >= HandType.PAIR) return { action: 'call', hand };
  if (Math.random() < 0.05) {
    const bluff = pickBluff(currentHand, myCards);
    if (bluff) return { action: 'call', hand: bluff };
  }
  return { action: 'pass' };
}

function balancedPlayerRaw(
  myCards: Card[],
  currentHand: HandCall | null,
): { action: 'call' | 'pass'; hand?: HandCall } {
  const hand = pickBestTruthfulHand(myCards, currentHand);
  if (hand) return { action: 'call', hand };
  if (Math.random() < 0.2) {
    const bluff = pickBluff(currentHand, myCards);
    if (bluff) return { action: 'call', hand: bluff };
  }
  return { action: 'pass' };
}

function aggressivePlayerRaw(
  myCards: Card[],
  currentHand: HandCall | null,
): { action: 'call' | 'pass'; hand?: HandCall } {
  const hand = pickBestTruthfulHand(myCards, currentHand);
  if (hand) return { action: 'call', hand };
  if (Math.random() < 0.4) {
    const bluff = pickBluff(currentHand, myCards);
    if (bluff) return { action: 'call', hand: bluff };
  }
  return { action: 'pass' };
}

function randomPlayerRaw(
  myCards: Card[],
  currentHand: HandCall | null,
): { action: 'call' | 'pass'; hand?: HandCall } {
  if (currentHand && Math.random() < 0.5) {
    return { action: 'pass' };
  }
  const hand = pickRandomValidHand(myCards, currentHand);
  if (hand) return { action: 'call', hand };
  return { action: 'pass' };
}

function smartPlayerRaw(
  myCards: Card[],
  currentHand: HandCall | null,
): { action: 'call' | 'pass'; hand?: HandCall } {
  const truthful = pickBestTruthfulHand(myCards, currentHand);
  if (truthful) return { action: 'call', hand: truthful };

  if (currentHand) {
    if (currentHand.type >= HandType.STRAIGHT) return { action: 'pass' };
    if (currentHand.type >= HandType.TWO_PAIR) {
      if (Math.random() < 0.25) {
        const bluff = pickBluff(currentHand, myCards);
        if (bluff) return { action: 'call', hand: bluff };
      }
      return { action: 'pass' };
    }
    if (Math.random() < 0.35) {
      const bluff = pickBluff(currentHand, myCards);
      if (bluff) return { action: 'call', hand: bluff };
    }
  }

  return { action: 'pass' };
}

/** All heuristic opponents with opening enforcement — P1 must always call. */
export const HEURISTIC_OPPONENTS: Array<{
  name: string;
  fn: HeuristicPlayerFn;
  weight: number;
}> = [
  { name: 'passive',    fn: enforceOpening(passivePlayerRaw),    weight: 3 },
  { name: 'balanced',   fn: enforceOpening(balancedPlayerRaw),   weight: 2 },
  { name: 'aggressive', fn: enforceOpening(aggressivePlayerRaw), weight: 2 },
  { name: 'smart',      fn: enforceOpening(smartPlayerRaw),      weight: 2 },
  { name: 'random',     fn: enforceOpening(randomPlayerRaw),     weight: 1 },
];

/** Pick a random heuristic opponent weighted by the weight field. */
export function pickHeuristicOpponent(): HeuristicPlayerFn {
  const totalWeight = HEURISTIC_OPPONENTS.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * totalWeight;
  for (const opponent of HEURISTIC_OPPONENTS) {
    r -= opponent.weight;
    if (r <= 0) return opponent.fn;
  }
  return HEURISTIC_OPPONENTS[0]!.fn;
}

// ── Hand generation helpers (shared with evaluateFiveDraw.ts) ────────

function pickBestTruthfulHand(myCards: Card[], currentHand: HandCall | null): HandCall | null {
  const candidates: HandCall[] = [];
  if (myCards.length === 0) return null;

  const rankCounts = new Map<Rank, number>();
  const suitCounts = new Map<Suit, number>();
  for (const c of myCards) {
    rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
    suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
  }

  const bestRank = myCards.reduce(
    (best, c) => RANK_VALUES[c.rank] > RANK_VALUES[best] ? c.rank : best,
    myCards[0]!.rank,
  );

  candidates.push({ type: HandType.HIGH_CARD, rank: bestRank });

  for (const [rank, count] of rankCounts) {
    candidates.push({ type: HandType.PAIR, rank });
    if (count >= 2) {
      candidates.push({ type: HandType.PAIR, rank });
      candidates.push({ type: HandType.THREE_OF_A_KIND, rank });
    }
    if (count >= 3) {
      candidates.push({ type: HandType.THREE_OF_A_KIND, rank });
    }
  }

  const pairRanks = [...rankCounts.entries()].filter(([, c]) => c >= 2).map(([r]) => r);
  if (pairRanks.length >= 2) {
    const sorted = pairRanks.sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a]);
    candidates.push({ type: HandType.TWO_PAIR, highRank: sorted[0]!, lowRank: sorted[1]! });
  }

  for (const [suit, count] of suitCounts) {
    if (count >= 2) {
      candidates.push({ type: HandType.FLUSH, suit });
    }
  }

  const valid = currentHand
    ? candidates.filter(h => isHigherHand(h, currentHand))
    : candidates;

  if (valid.length === 0) return null;

  valid.sort((a, b) => {
    if (a.type !== b.type) return a.type - b.type;
    const aRank = 'rank' in a ? RANK_VALUES[a.rank as Rank] : ('highRank' in a ? RANK_VALUES[a.highRank as Rank] : 0);
    const bRank = 'rank' in b ? RANK_VALUES[b.rank as Rank] : ('highRank' in b ? RANK_VALUES[b.highRank as Rank] : 0);
    return aRank - bRank;
  });

  return valid[0]!;
}

function pickBluff(currentHand: HandCall | null, myCards: Card[]): HandCall | null {
  if (!currentHand) {
    const rank = myCards[Math.floor(Math.random() * myCards.length)]!.rank;
    return { type: HandType.PAIR, rank };
  }
  const minRaise = getMinimumRaise(currentHand);
  return minRaise ?? null;
}

function pickRandomValidHand(myCards: Card[], currentHand: HandCall | null): HandCall | null {
  const options: HandCall[] = [];
  for (const card of myCards) {
    options.push({ type: HandType.HIGH_CARD, rank: card.rank });
    options.push({ type: HandType.PAIR, rank: card.rank });
  }
  const valid = currentHand ? options.filter(h => isHigherHand(h, currentHand)) : options;
  if (valid.length === 0) {
    if (currentHand) {
      const min = getMinimumRaise(currentHand);
      return min ?? null;
    }
    return null;
  }
  return valid[Math.floor(Math.random() * valid.length)]!;
}
