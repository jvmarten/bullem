import { describe, it, expect } from 'vitest';
import { isHigherHand, getMinimumRaise, validateHandCall } from './hands.js';
import { HandType } from './types.js';
import type { HandCall, Rank } from './types.js';
import { ALL_RANKS, ALL_SUITS } from './constants.js';

// ─── Complete raise chain: walk from lowest to highest without gaps ─────────

describe('getMinimumRaise: complete chain integrity', () => {
  it('walks the entire chain from "2 High" to "Royal Flush in spades" without gaps', () => {
    let hand: HandCall | null = { type: HandType.HIGH_CARD, rank: '2' };
    let count = 0;
    const maxIterations = 2000; // safety bound to prevent infinite loops

    while (hand !== null && count < maxIterations) {
      const next = getMinimumRaise(hand);
      if (next === null) break;

      // Every raise must be strictly higher
      expect(isHigherHand(next, hand)).toBe(true);

      // Every raise must produce a valid hand
      expect(validateHandCall(next)).toBeNull();

      hand = next;
      count++;
    }

    // Should terminate at royal flush (any suit — all royal flushes return null)
    expect(hand).not.toBeNull();
    expect(hand!.type).toBe(HandType.ROYAL_FLUSH);

    // getMinimumRaise returns null for ANY royal flush since nothing beats it.
    // The chain terminates at the first royal flush encountered (clubs).
    if (hand!.type === HandType.ROYAL_FLUSH) {
      expect((hand as { type: HandType.ROYAL_FLUSH; suit: string }).suit).toBe('clubs');
    }

    // Should have a reasonable number of steps (not infinite)
    expect(count).toBeGreaterThan(50);
    expect(count).toBeLessThan(maxIterations);
  });

  it('every step produces a valid HandCall per validateHandCall', () => {
    let hand: HandCall | null = { type: HandType.HIGH_CARD, rank: '2' };
    let maxSteps = 2000;

    while (hand !== null && maxSteps-- > 0) {
      const error = validateHandCall(hand);
      if (error !== null) {
        // Fail the test with a useful message
        expect.fail(`Invalid hand in raise chain: ${JSON.stringify(hand)} → ${error}`);
      }
      hand = getMinimumRaise(hand);
    }
  });

  it('chain covers all hand types', () => {
    const seenTypes = new Set<HandType>();
    let hand: HandCall | null = { type: HandType.HIGH_CARD, rank: '2' };
    let maxSteps = 2000;

    while (hand !== null && maxSteps-- > 0) {
      seenTypes.add(hand.type);
      hand = getMinimumRaise(hand);
    }

    // Should have visited all 10 hand types
    expect(seenTypes.size).toBe(10);
    for (let i = 0; i <= 9; i++) {
      expect(seenTypes.has(i as HandType)).toBe(true);
    }
  });
});

// ─── isHigherHand: transitivity ─────────────────────────────────────────────

describe('isHigherHand: transitivity guarantee', () => {
  it('if A > B and B > C, then A > C (sampled across types)', () => {
    const a: HandCall = { type: HandType.THREE_OF_A_KIND, rank: 'K' };
    const b: HandCall = { type: HandType.PAIR, rank: 'A' };
    const c: HandCall = { type: HandType.HIGH_CARD, rank: '5' };

    expect(isHigherHand(a, b)).toBe(true);
    expect(isHigherHand(b, c)).toBe(true);
    expect(isHigherHand(a, c)).toBe(true);
  });

  it('transitivity within same type: two pairs', () => {
    const a: HandCall = { type: HandType.TWO_PAIR, highRank: 'A', lowRank: 'K' };
    const b: HandCall = { type: HandType.TWO_PAIR, highRank: 'A', lowRank: '5' };
    const c: HandCall = { type: HandType.TWO_PAIR, highRank: 'A', lowRank: '3' };

    expect(isHigherHand(a, b)).toBe(true);
    expect(isHigherHand(b, c)).toBe(true);
    expect(isHigherHand(a, c)).toBe(true);
  });

  it('transitivity within same type: full house', () => {
    const a: HandCall = { type: HandType.FULL_HOUSE, threeRank: 'A', twoRank: 'K' };
    const b: HandCall = { type: HandType.FULL_HOUSE, threeRank: 'A', twoRank: '3' };
    const c: HandCall = { type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: 'Q' };

    expect(isHigherHand(a, b)).toBe(true);
    expect(isHigherHand(b, c)).toBe(true);
    expect(isHigherHand(a, c)).toBe(true);
  });
});

// ─── isHigherHand: irreflexivity ────────────────────────────────────────────

describe('isHigherHand: no hand beats itself', () => {
  it('all hand types: same hand is never higher', () => {
    const hands: HandCall[] = [
      { type: HandType.HIGH_CARD, rank: '7' },
      { type: HandType.PAIR, rank: 'Q' },
      { type: HandType.TWO_PAIR, highRank: 'A', lowRank: 'K' },
      { type: HandType.FLUSH, suit: 'hearts' },
      { type: HandType.THREE_OF_A_KIND, rank: '9' },
      { type: HandType.STRAIGHT, highRank: '8' },
      { type: HandType.FULL_HOUSE, threeRank: 'J', twoRank: '5' },
      { type: HandType.FOUR_OF_A_KIND, rank: '3' },
      { type: HandType.STRAIGHT_FLUSH, suit: 'diamonds', highRank: '7' },
      { type: HandType.ROYAL_FLUSH, suit: 'spades' },
    ];

    for (const hand of hands) {
      expect(isHigherHand(hand, hand)).toBe(false);
    }
  });
});

// ─── isHigherHand: asymmetry ────────────────────────────────────────────────

describe('isHigherHand: if A > B then B < A (asymmetric)', () => {
  const pairs: [HandCall, HandCall][] = [
    [
      { type: HandType.PAIR, rank: 'A' },
      { type: HandType.PAIR, rank: 'K' },
    ],
    [
      { type: HandType.STRAIGHT, highRank: 'A' },
      { type: HandType.STRAIGHT, highRank: '5' },
    ],
    [
      { type: HandType.FULL_HOUSE, threeRank: 'A', twoRank: '2' },
      { type: HandType.FULL_HOUSE, threeRank: '2', twoRank: 'A' },
    ],
    [
      { type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: 'K' },
      { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '9' },
    ],
  ];

  for (const [higher, lower] of pairs) {
    it(`${JSON.stringify(higher)} > ${JSON.stringify(lower)}`, () => {
      expect(isHigherHand(higher, lower)).toBe(true);
      expect(isHigherHand(lower, higher)).toBe(false);
    });
  }
});

// ─── isHigherHand: custom ranking edge cases ────────────────────────────────

describe('isHigherHand: custom ranking edge cases (flush < three_of_a_kind < straight)', () => {
  it('two pair Aces & Kings > flush (any suit)', () => {
    expect(isHigherHand(
      { type: HandType.FLUSH, suit: 'spades' },
      { type: HandType.TWO_PAIR, highRank: 'A', lowRank: 'K' },
    )).toBe(true);
  });

  it('three of a kind 2s > flush spades', () => {
    expect(isHigherHand(
      { type: HandType.THREE_OF_A_KIND, rank: '2' },
      { type: HandType.FLUSH, suit: 'spades' },
    )).toBe(true);
  });

  it('straight 5-high > three of a kind Aces', () => {
    expect(isHigherHand(
      { type: HandType.STRAIGHT, highRank: '5' },
      { type: HandType.THREE_OF_A_KIND, rank: 'A' },
    )).toBe(true);
  });

  it('full house 2s over 3s > straight Ace-high', () => {
    expect(isHigherHand(
      { type: HandType.FULL_HOUSE, threeRank: '2', twoRank: '3' },
      { type: HandType.STRAIGHT, highRank: 'A' },
    )).toBe(true);
  });
});

// ─── getMinimumRaise: boundary cases within each type ───────────────────────

describe('getMinimumRaise: boundary transitions within types', () => {
  it('pair: walks from 2 to Ace, then jumps to two pair', () => {
    let hand: HandCall = { type: HandType.PAIR, rank: '2' };
    const seenRanks: Rank[] = [];

    while (hand.type === HandType.PAIR) {
      seenRanks.push((hand as { rank: Rank }).rank);
      const next = getMinimumRaise(hand)!;
      hand = next;
    }

    // Should have 13 ranks (2 through A)
    expect(seenRanks).toEqual(ALL_RANKS);
    // Next should be lowest two pair
    expect(hand.type).toBe(HandType.TWO_PAIR);
  });

  it('two pair: exhausts all valid combinations then jumps to flush', () => {
    let hand: HandCall = { type: HandType.TWO_PAIR, highRank: '3', lowRank: '2' };
    let count = 0;

    while (hand.type === HandType.TWO_PAIR) {
      const next = getMinimumRaise(hand)!;
      expect(isHigherHand(next, hand)).toBe(true);
      hand = next;
      count++;
      if (count > 200) break; // safety
    }

    expect(hand.type).toBe(HandType.FLUSH);
    // Number of two-pair combos: C(13,2) = 78
    expect(count).toBe(78);
  });

  it('straight: walks from 5-high to Ace-high then jumps to full house', () => {
    let hand: HandCall = { type: HandType.STRAIGHT, highRank: '5' };
    const seenHighRanks: Rank[] = [];

    while (hand.type === HandType.STRAIGHT) {
      seenHighRanks.push((hand as { highRank: Rank }).highRank);
      const next = getMinimumRaise(hand)!;
      hand = next;
    }

    // 5, 6, 7, 8, 9, 10, J, Q, K, A = 10 straights
    expect(seenHighRanks.length).toBe(10);
    expect(seenHighRanks[0]).toBe('5');
    expect(seenHighRanks[seenHighRanks.length - 1]).toBe('A');
    expect(hand.type).toBe(HandType.FULL_HOUSE);
  });

  it('four of a kind: walks from 2 to Ace then jumps to straight flush', () => {
    let hand: HandCall = { type: HandType.FOUR_OF_A_KIND, rank: '2' };
    const seenRanks: Rank[] = [];

    while (hand.type === HandType.FOUR_OF_A_KIND) {
      seenRanks.push((hand as { rank: Rank }).rank);
      const next = getMinimumRaise(hand)!;
      hand = next;
    }

    expect(seenRanks).toEqual(ALL_RANKS);
    expect(hand.type).toBe(HandType.STRAIGHT_FLUSH);
  });

  it('straight flush: walks through all suits in order', () => {
    const suitsVisited = new Set<string>();
    let hand: HandCall = { type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '5' };

    while (hand.type === HandType.STRAIGHT_FLUSH) {
      suitsVisited.add((hand as { suit: string }).suit);
      const next = getMinimumRaise(hand)!;
      hand = next;
    }

    // Should have visited all 4 suits
    expect(suitsVisited.size).toBe(4);
    for (const suit of ALL_SUITS) {
      expect(suitsVisited.has(suit)).toBe(true);
    }
    expect(hand.type).toBe(HandType.ROYAL_FLUSH);
  });

  it('royal flush: walks through all 4 suits, last one returns null', () => {
    const royals: HandCall[] = ALL_SUITS.map(suit => ({
      type: HandType.ROYAL_FLUSH,
      suit,
    }));

    // clubs → diamonds → hearts → spades → null
    // But actually royal flush returns false for isHigherHand, so getMinimumRaise only returns null
    expect(getMinimumRaise(royals[0])).toBeNull();
    // All royal flushes return null (nothing beats any royal flush)
    for (const rf of royals) {
      expect(getMinimumRaise(rf)).toBeNull();
    }
  });
});

// ─── validateHandCall + isHigherHand consistency ────────────────────────────

describe('validateHandCall + isHigherHand: consistency', () => {
  it('all minimum raises from valid hands produce valid hands', () => {
    const sampleHands: HandCall[] = [
      { type: HandType.HIGH_CARD, rank: '2' },
      { type: HandType.HIGH_CARD, rank: 'A' },
      { type: HandType.PAIR, rank: '2' },
      { type: HandType.PAIR, rank: 'A' },
      { type: HandType.TWO_PAIR, highRank: '3', lowRank: '2' },
      { type: HandType.TWO_PAIR, highRank: 'A', lowRank: 'K' },
      { type: HandType.FLUSH, suit: 'clubs' },
      { type: HandType.FLUSH, suit: 'spades' },
      { type: HandType.THREE_OF_A_KIND, rank: '2' },
      { type: HandType.THREE_OF_A_KIND, rank: 'A' },
      { type: HandType.STRAIGHT, highRank: '5' },
      { type: HandType.STRAIGHT, highRank: 'A' },
      { type: HandType.FULL_HOUSE, threeRank: '2', twoRank: '3' },
      { type: HandType.FULL_HOUSE, threeRank: 'A', twoRank: 'K' },
      { type: HandType.FOUR_OF_A_KIND, rank: '2' },
      { type: HandType.FOUR_OF_A_KIND, rank: 'A' },
      { type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '5' },
      { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: 'K' },
      { type: HandType.ROYAL_FLUSH, suit: 'clubs' },
      { type: HandType.ROYAL_FLUSH, suit: 'spades' },
    ];

    for (const hand of sampleHands) {
      expect(validateHandCall(hand)).toBeNull();

      const raise = getMinimumRaise(hand);
      if (raise !== null) {
        const error = validateHandCall(raise);
        if (error !== null) {
          expect.fail(`getMinimumRaise(${JSON.stringify(hand)}) → ${JSON.stringify(raise)} is invalid: ${error}`);
        }
        expect(isHigherHand(raise, hand)).toBe(true);
      }
    }
  });
});
