/**
 * Information set abstraction for 5 Draw CFR evaluation.
 * Ported from training/src/cfr/fiveDrawInfoSet.ts — evaluation-only subset.
 *
 * 5 Draw is always 2 players, 5 cards each, 10 total.
 * Actions: raise (6 variants) or pass. No bull/true.
 */

import type { Card, HandCall, Rank, Suit } from '../types.js';
import { HandType } from '../types.js';
import { RANK_VALUES } from '../constants.js';

// ── Abstract action space ───────────────────────────────────────────

export enum FiveDrawAction {
  TRUTHFUL_LOW = 'truthful_low',
  TRUTHFUL_MID = 'truthful_mid',
  TRUTHFUL_HIGH = 'truthful_high',
  BLUFF_SMALL = 'bluff_small',
  BLUFF_MID = 'bluff_mid',
  BLUFF_BIG = 'bluff_big',
  PASS = 'pass',
}

// ── Legal actions ───────────────────────────────────────────────────

export function getFiveDrawLegalActions(
  currentHand: HandCall | null,
): FiveDrawAction[] {
  if (!currentHand) {
    return [
      FiveDrawAction.TRUTHFUL_LOW,
      FiveDrawAction.TRUTHFUL_MID,
      FiveDrawAction.TRUTHFUL_HIGH,
      FiveDrawAction.BLUFF_SMALL,
      FiveDrawAction.BLUFF_MID,
      FiveDrawAction.BLUFF_BIG,
    ];
  }

  return [
    FiveDrawAction.PASS,
    FiveDrawAction.TRUTHFUL_LOW,
    FiveDrawAction.TRUTHFUL_MID,
    FiveDrawAction.TRUTHFUL_HIGH,
    FiveDrawAction.BLUFF_SMALL,
    FiveDrawAction.BLUFF_MID,
    FiveDrawAction.BLUFF_BIG,
  ];
}

// ── Hand strength bucketing ─────────────────────────────────────────

function handStrengthBucket(cards: Card[]): string {
  if (cards.length === 0) return 'x';

  const rankCounts = new Map<Rank, number>();
  const suitCounts = new Map<Suit, number>();
  for (const c of cards) {
    rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
    suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
  }

  const maxGroup = Math.max(...rankCounts.values());
  const maxSuit = Math.max(...suitCounts.values());
  const pairCount = [...rankCounts.values()].filter(c => c >= 2).length;

  const vals = [...new Set([...rankCounts.keys()].map(r => RANK_VALUES[r]))].sort((a, b) => a - b);
  let maxConsecutive = 1;
  let current = 1;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i]! - vals[i - 1]! <= 2) {
      current++;
      maxConsecutive = Math.max(maxConsecutive, current);
    } else {
      current = 1;
    }
  }

  if (maxGroup >= 3 || pairCount >= 2) return 'vStr';
  if (maxGroup >= 2) return 'pair';
  if (maxSuit >= 3 || maxConsecutive >= 3) return 'draw';
  return 'weak';
}

// ── Hand vs claim bucketing ─────────────────────────────────────────

function handVsClaimBucket(myCards: Card[], currentHand: HandCall | null): string {
  if (!currentHand) return 'none';

  switch (currentHand.type) {
    case HandType.HIGH_CARD: {
      const hasRank = myCards.some(c => c.rank === currentHand.rank);
      const hasHigher = myCards.some(c => RANK_VALUES[c.rank] > RANK_VALUES[currentHand.rank]);
      if (hasRank || hasHigher) return 'has';
      return 'below';
    }

    case HandType.PAIR: {
      const count = myCards.filter(c => c.rank === currentHand.rank).length;
      if (count >= 2) return 'has';
      if (count === 1) return 'close';
      const hasSomePair = hasPairInCards(myCards);
      return hasSomePair ? 'close' : 'below';
    }

    case HandType.TWO_PAIR: {
      const hiCount = myCards.filter(c => c.rank === currentHand.highRank).length;
      const loCount = myCards.filter(c => c.rank === currentHand.lowRank).length;
      if (hiCount >= 2 && loCount >= 2) return 'has';
      if (hiCount >= 1 && loCount >= 1) return 'close';
      return 'below';
    }

    case HandType.FLUSH: {
      const suitCount = myCards.filter(c => c.suit === currentHand.suit).length;
      if (suitCount >= 3) return 'has';
      if (suitCount >= 2) return 'close';
      return 'below';
    }

    case HandType.THREE_OF_A_KIND: {
      const count = myCards.filter(c => c.rank === currentHand.rank).length;
      if (count >= 3) return 'has';
      if (count >= 1) return 'close';
      return 'below';
    }

    case HandType.STRAIGHT: {
      const highVal = RANK_VALUES[currentHand.highRank];
      const neededVals = [highVal, highVal - 1, highVal - 2, highVal - 3, highVal - 4];
      const myVals = new Set(myCards.map(c => RANK_VALUES[c.rank]));
      const overlap = neededVals.filter(v => myVals.has(v)).length;
      if (overlap >= 3) return 'has';
      if (overlap >= 2) return 'close';
      return 'below';
    }

    case HandType.FULL_HOUSE: {
      const threeCount = myCards.filter(c => c.rank === currentHand.threeRank).length;
      const twoCount = myCards.filter(c => c.rank === currentHand.twoRank).length;
      if (threeCount >= 2 && twoCount >= 1) return 'has';
      if (threeCount >= 1 || twoCount >= 1) return 'close';
      return 'below';
    }

    case HandType.FOUR_OF_A_KIND: {
      const count = myCards.filter(c => c.rank === currentHand.rank).length;
      if (count >= 3) return 'has';
      if (count >= 1) return 'close';
      return 'below';
    }

    case HandType.STRAIGHT_FLUSH: {
      const highVal = RANK_VALUES[currentHand.highRank];
      const neededVals = [highVal, highVal - 1, highVal - 2, highVal - 3, highVal - 4];
      const matching = myCards.filter(c =>
        c.suit === currentHand.suit && neededVals.includes(RANK_VALUES[c.rank])
      );
      if (matching.length >= 2) return 'has';
      if (matching.length >= 1) return 'close';
      return 'below';
    }

    case HandType.ROYAL_FLUSH: {
      const royalRanks = new Set(['10', 'J', 'Q', 'K', 'A'] as const);
      const matching = myCards.filter(c =>
        c.suit === currentHand.suit && royalRanks.has(c.rank as '10' | 'J' | 'Q' | 'K' | 'A')
      );
      if (matching.length >= 2) return 'has';
      if (matching.length >= 1) return 'close';
      return 'below';
    }
  }
}

function hasPairInCards(cards: Card[]): boolean {
  const counts = new Map<Rank, number>();
  for (const c of cards) {
    counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  }
  for (const count of counts.values()) {
    if (count >= 2) return true;
  }
  return false;
}

// ── Claim height bucketing ──────────────────────────────────────────

function claimHeightBucket(hand: HandCall | null): string {
  if (!hand) return 'x';
  if (hand.type <= HandType.PAIR) return 'lo';
  if (hand.type <= HandType.THREE_OF_A_KIND) return 'mid';
  return 'hi';
}

// ── Turn depth bucketing ────────────────────────────────────────────

function turnDepthBucket(turnCount: number): string {
  if (turnCount === 0) return 'open';
  if (turnCount <= 2) return 'early';
  return 'late';
}

// ── Info set key ────────────────────────────────────────────────────

/**
 * Generate info set key for 5 Draw CFR evaluation.
 * Must match the format used during training.
 */
export function getFiveDrawInfoSetKey(
  myCards: Card[],
  currentHand: HandCall | null,
  turnCount: number,
  isOpener: boolean,
): string {
  return [
    'fd',
    isOpener ? 'p1' : 'p2',
    handStrengthBucket(myCards),
    handVsClaimBucket(myCards, currentHand),
    claimHeightBucket(currentHand),
    turnDepthBucket(turnCount),
  ].join('|');
}
