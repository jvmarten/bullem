import { describe, it, expect } from 'vitest';
import { getMinimumRaise, isHigherHand, validateHandCall } from './hands.js';
import { HandType } from './types.js';
import type { HandCall, Rank } from './types.js';
import { RANK_VALUES } from './constants.js';

/**
 * Tests for getMinimumRaise() — focused on specific boundary transitions
 * and edge cases that the raise chain integrity tests don't cover.
 */

describe('getMinimumRaise: type boundary transitions', () => {
  it('HIGH_CARD Ace → PAIR of 2s (type transition)', () => {
    const result = getMinimumRaise({ type: HandType.HIGH_CARD, rank: 'A' });
    expect(result).toEqual({ type: HandType.PAIR, rank: '2' });
  });

  it('PAIR of Aces → TWO_PAIR 3s and 2s (lowest valid two pair)', () => {
    const result = getMinimumRaise({ type: HandType.PAIR, rank: 'A' });
    expect(result).toEqual({ type: HandType.TWO_PAIR, highRank: '3', lowRank: '2' });
  });

  it('TWO_PAIR Aces and Kings → FLUSH in clubs', () => {
    const result = getMinimumRaise({ type: HandType.TWO_PAIR, highRank: 'A', lowRank: 'K' });
    expect(result).toEqual({ type: HandType.FLUSH, suit: 'clubs' });
  });

  it('any FLUSH → THREE_OF_A_KIND 2s (all flushes equal)', () => {
    // All 4 suits should produce the same result
    for (const suit of ['clubs', 'diamonds', 'hearts', 'spades'] as const) {
      const result = getMinimumRaise({ type: HandType.FLUSH, suit });
      expect(result).toEqual({ type: HandType.THREE_OF_A_KIND, rank: '2' });
    }
  });

  it('THREE_OF_A_KIND Aces → STRAIGHT 5-high', () => {
    const result = getMinimumRaise({ type: HandType.THREE_OF_A_KIND, rank: 'A' });
    expect(result).toEqual({ type: HandType.STRAIGHT, highRank: '5' });
  });

  it('STRAIGHT Ace-high → FULL_HOUSE 2s over 3s', () => {
    const result = getMinimumRaise({ type: HandType.STRAIGHT, highRank: 'A' });
    expect(result).toEqual({ type: HandType.FULL_HOUSE, threeRank: '2', twoRank: '3' });
  });

  it('FULL_HOUSE Aces over Kings → FOUR_OF_A_KIND 2s', () => {
    const result = getMinimumRaise({ type: HandType.FULL_HOUSE, threeRank: 'A', twoRank: 'K' });
    expect(result).toEqual({ type: HandType.FOUR_OF_A_KIND, rank: '2' });
  });

  it('FOUR_OF_A_KIND Aces → STRAIGHT_FLUSH clubs 5-high', () => {
    const result = getMinimumRaise({ type: HandType.FOUR_OF_A_KIND, rank: 'A' });
    expect(result).toEqual({ type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '5' });
  });

  it('STRAIGHT_FLUSH spades K-high → ROYAL_FLUSH clubs', () => {
    const result = getMinimumRaise({ type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: 'K' });
    expect(result).toEqual({ type: HandType.ROYAL_FLUSH, suit: 'clubs' });
  });

  it('ROYAL_FLUSH any suit → null (nothing beats it)', () => {
    for (const suit of ['clubs', 'diamonds', 'hearts', 'spades'] as const) {
      expect(getMinimumRaise({ type: HandType.ROYAL_FLUSH, suit })).toBeNull();
    }
  });
});

describe('getMinimumRaise: TWO_PAIR inner transitions', () => {
  it('lowRank increments within valid range before highRank increments', () => {
    // highRank=4, lowRank=2 → lowRank should go to 3 (still < 4)
    const result = getMinimumRaise({ type: HandType.TWO_PAIR, highRank: '4', lowRank: '2' });
    expect(result).toEqual({ type: HandType.TWO_PAIR, highRank: '4', lowRank: '3' });
  });

  it('when lowRank can no longer increment (next would equal highRank), highRank increments', () => {
    // highRank=4, lowRank=3 → next lowRank=4 equals highRank, so highRank→5, lowRank→2
    const result = getMinimumRaise({ type: HandType.TWO_PAIR, highRank: '4', lowRank: '3' });
    expect(result).toEqual({ type: HandType.TWO_PAIR, highRank: '5', lowRank: '2' });
  });

  it('highRank=A, lowRank=Q → lowRank=K (last valid before wrap)', () => {
    const result = getMinimumRaise({ type: HandType.TWO_PAIR, highRank: 'A', lowRank: 'Q' });
    expect(result).toEqual({ type: HandType.TWO_PAIR, highRank: 'A', lowRank: 'K' });
  });
});

describe('getMinimumRaise: FULL_HOUSE inner transitions', () => {
  it('twoRank increments within valid range, skipping threeRank', () => {
    // threeRank=5, twoRank=2 → twoRank=3
    const result = getMinimumRaise({ type: HandType.FULL_HOUSE, threeRank: '5', twoRank: '2' });
    expect(result).toEqual({ type: HandType.FULL_HOUSE, threeRank: '5', twoRank: '3' });
  });

  it('twoRank skips threeRank value', () => {
    // threeRank=5, twoRank=4 → twoRank=6 (skip 5 since threeRank=5)
    const result = getMinimumRaise({ type: HandType.FULL_HOUSE, threeRank: '5', twoRank: '4' });
    expect(result).toEqual({ type: HandType.FULL_HOUSE, threeRank: '5', twoRank: '6' });
  });

  it('threeRank increments when all twoRank values exhausted', () => {
    // threeRank=2, twoRank=A (last possible) → threeRank=3, twoRank=2
    const result = getMinimumRaise({ type: HandType.FULL_HOUSE, threeRank: '2', twoRank: 'A' });
    expect(result).toEqual({ type: HandType.FULL_HOUSE, threeRank: '3', twoRank: '2' });
  });

  it('twoRank avoids collision with new threeRank', () => {
    // threeRank=A with all twoRanks exhausted → FOUR_OF_A_KIND
    // But first: threeRank=K, twoRank=A → threeRank wraps? No — K is second-last
    const result = getMinimumRaise({ type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: 'A' });
    // threeRank should go from K to A, twoRank should be lowest non-A = 2
    expect(result).toEqual({ type: HandType.FULL_HOUSE, threeRank: 'A', twoRank: '2' });
  });

  it('allows twoRank to be higher than threeRank (valid in bull em)', () => {
    // This is a valid game rule: full house 2s over Aces is valid
    const result = getMinimumRaise({ type: HandType.FULL_HOUSE, threeRank: '2', twoRank: '3' });
    expect(result).toEqual({ type: HandType.FULL_HOUSE, threeRank: '2', twoRank: '4' });
  });
});

describe('getMinimumRaise: STRAIGHT_FLUSH suit/rank ordering', () => {
  it('suit increments before rank: clubs 5-high → diamonds 5-high', () => {
    const result = getMinimumRaise({ type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '5' });
    expect(result).toEqual({ type: HandType.STRAIGHT_FLUSH, suit: 'diamonds', highRank: '5' });
  });

  it('all suits exhausted at rank → next rank lowest suit: spades 5 → clubs 6', () => {
    const result = getMinimumRaise({ type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '5' });
    expect(result).toEqual({ type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '6' });
  });

  it('spades K-high → ROYAL_FLUSH (ace-high straight flush is royal flush)', () => {
    const result = getMinimumRaise({ type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: 'K' });
    expect(result).toEqual({ type: HandType.ROYAL_FLUSH, suit: 'clubs' });
  });

  it('rank is primary sort key: clubs K-high > spades 5-high', () => {
    const kClubs: HandCall = { type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: 'K' };
    const fiveSpades: HandCall = { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '5' };
    expect(isHigherHand(kClubs, fiveSpades)).toBe(true);
  });

  it('suit is secondary sort key at same rank: spades > hearts > diamonds > clubs', () => {
    const suits = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
    for (let i = 0; i < suits.length - 1; i++) {
      const lower: HandCall = { type: HandType.STRAIGHT_FLUSH, suit: suits[i]!, highRank: '7' };
      const higher: HandCall = { type: HandType.STRAIGHT_FLUSH, suit: suits[i + 1]!, highRank: '7' };
      expect(isHigherHand(higher, lower)).toBe(true);
      expect(isHigherHand(lower, higher)).toBe(false);
    }
  });
});

describe('getMinimumRaise: every raised hand passes validation', () => {
  it('all full house transitions produce valid hands', () => {
    let hand: HandCall = { type: HandType.FULL_HOUSE, threeRank: '2', twoRank: '3' };
    let count = 0;
    while (hand.type === HandType.FULL_HOUSE && count < 200) {
      const err = validateHandCall(hand);
      expect(err, `Invalid full house: ${JSON.stringify(hand)}`).toBeNull();
      const next = getMinimumRaise(hand);
      if (!next || next.type !== HandType.FULL_HOUSE) break;
      hand = next;
      count++;
    }
    // 13 threeRanks × 12 twoRanks = 156 total, minus 1 for the starting hand = 155 transitions
    expect(count).toBe(155);
  });

  it('all straight flush transitions produce valid hands', () => {
    let hand: HandCall = { type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '5' };
    let count = 0;
    while (hand.type === HandType.STRAIGHT_FLUSH && count < 200) {
      const err = validateHandCall(hand);
      expect(err, `Invalid SF: ${JSON.stringify(hand)}`).toBeNull();
      const next = getMinimumRaise(hand);
      if (!next || next.type !== HandType.STRAIGHT_FLUSH) break;
      hand = next;
      count++;
    }
    // 9 ranks (5-K) × 4 suits = 36 total, minus 1 for the starting hand = 35 transitions
    expect(count).toBe(35);
  });
});
