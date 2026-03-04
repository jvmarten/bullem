import { describe, it, expect } from 'vitest';
import { isHigherHand, getMinimumRaise, validateHandCall } from './hands.js';
import { HandType } from './types.js';
import type { HandCall, Rank } from './types.js';
import { ALL_RANKS, ALL_SUITS } from './constants.js';

// ─── getMinimumRaise complete chain ──────────────────────────────────────────
// Verify the ENTIRE raise chain from lowest to highest hand has no gaps.
// A gap would mean a player can never raise past a certain point → game stalls.

describe('getMinimumRaise complete chain — no gaps from 2 High to Royal Flush', () => {
  it('walks the entire chain without null until Royal Flush', () => {
    let current: HandCall = { type: HandType.HIGH_CARD, rank: '2' };
    let steps = 0;
    const maxSteps = 5000; // safety bound to prevent infinite loop

    while (steps < maxSteps) {
      const next = getMinimumRaise(current);
      if (next === null) {
        // Should only happen at Royal Flush
        expect(current.type).toBe(HandType.ROYAL_FLUSH);
        break;
      }
      // Each step must be strictly higher
      expect(isHigherHand(next, current)).toBe(true);
      // Each step must be a valid hand
      expect(validateHandCall(next)).toBeNull();
      current = next;
      steps++;
    }

    expect(steps).toBeGreaterThan(0);
    expect(steps).toBeLessThan(maxSteps); // ensure we didn't loop infinitely
  });

  it('reaches all 10 hand types in the chain', () => {
    let current: HandCall = { type: HandType.HIGH_CARD, rank: '2' };
    const typesReached = new Set<HandType>();
    typesReached.add(current.type);
    let steps = 0;
    const maxSteps = 5000;

    while (steps < maxSteps) {
      const next = getMinimumRaise(current);
      if (next === null) break;
      typesReached.add(next.type);
      current = next;
      steps++;
    }

    // All 10 hand types should appear in the chain
    expect(typesReached.size).toBe(10);
    for (let t = HandType.HIGH_CARD; t <= HandType.ROYAL_FLUSH; t++) {
      expect(typesReached.has(t)).toBe(true);
    }
  });

  it('covers all 13 ranks for HIGH_CARD type', () => {
    const ranksVisited: Rank[] = [];
    let current: HandCall = { type: HandType.HIGH_CARD, rank: '2' };

    while (current.type === HandType.HIGH_CARD) {
      ranksVisited.push((current as { rank: Rank }).rank);
      const next = getMinimumRaise(current);
      if (!next) break;
      current = next;
    }

    expect(ranksVisited).toEqual(ALL_RANKS);
  });

  it('covers all 13 ranks for PAIR type', () => {
    const ranksVisited: Rank[] = [];
    let current: HandCall = { type: HandType.PAIR, rank: '2' };

    while (current.type === HandType.PAIR) {
      ranksVisited.push((current as { rank: Rank }).rank);
      const next = getMinimumRaise(current);
      if (!next) break;
      current = next;
    }

    expect(ranksVisited).toEqual(ALL_RANKS);
  });

  it('covers all 4 suits for straight flush type', () => {
    const suitsVisited = new Set<string>();
    let current: HandCall = { type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '5' };

    while (current.type === HandType.STRAIGHT_FLUSH) {
      if ('suit' in current) suitsVisited.add(current.suit);
      const next = getMinimumRaise(current);
      if (!next) break;
      current = next;
    }

    expect(suitsVisited.size).toBe(4);
    for (const suit of ALL_SUITS) {
      expect(suitsVisited.has(suit)).toBe(true);
    }
  });
});

// ─── isHigherHand boundary cases ─────────────────────────────────────────────

describe('isHigherHand — boundary and regression cases', () => {
  it('two pair: lowRank just below highRank counts as higher', () => {
    // K-Q is higher than K-J
    expect(isHigherHand(
      { type: HandType.TWO_PAIR, highRank: 'K', lowRank: 'Q' },
      { type: HandType.TWO_PAIR, highRank: 'K', lowRank: 'J' },
    )).toBe(true);
  });

  it('full house: twoRank can be higher than threeRank and still compare correctly', () => {
    // 3s over Aces vs 3s over Kings — Aces > Kings
    expect(isHigherHand(
      { type: HandType.FULL_HOUSE, threeRank: '3', twoRank: 'A' },
      { type: HandType.FULL_HOUSE, threeRank: '3', twoRank: 'K' },
    )).toBe(true);
  });

  it('straight flush: suit takes priority over rank', () => {
    // Spades 5 beats Hearts King (spades > hearts)
    expect(isHigherHand(
      { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '5' },
      { type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: 'K' },
    )).toBe(true);
  });

  it('straight: ace-low (5 high) is lower than 6-high', () => {
    expect(isHigherHand(
      { type: HandType.STRAIGHT, highRank: '6' },
      { type: HandType.STRAIGHT, highRank: '5' },
    )).toBe(true);
    expect(isHigherHand(
      { type: HandType.STRAIGHT, highRank: '5' },
      { type: HandType.STRAIGHT, highRank: '6' },
    )).toBe(false);
  });

  it('high card: 2 is lowest, Ace is highest', () => {
    expect(isHigherHand(
      { type: HandType.HIGH_CARD, rank: 'A' },
      { type: HandType.HIGH_CARD, rank: '2' },
    )).toBe(true);
    expect(isHigherHand(
      { type: HandType.HIGH_CARD, rank: '2' },
      { type: HandType.HIGH_CARD, rank: 'A' },
    )).toBe(false);
  });

  it('all flushes are equal (cannot raise within flush)', () => {
    for (const s1 of ALL_SUITS) {
      for (const s2 of ALL_SUITS) {
        expect(isHigherHand(
          { type: HandType.FLUSH, suit: s1 },
          { type: HandType.FLUSH, suit: s2 },
        )).toBe(false);
      }
    }
  });

  it('royal flush cannot be raised (absolute ceiling)', () => {
    for (const s1 of ALL_SUITS) {
      for (const s2 of ALL_SUITS) {
        expect(isHigherHand(
          { type: HandType.ROYAL_FLUSH, suit: s1 },
          { type: HandType.ROYAL_FLUSH, suit: s2 },
        )).toBe(false);
      }
    }
  });
});

// ─── validateHandCall injection and boundary tests ───────────────────────────

describe('validateHandCall — additional injection and boundary tests', () => {
  it('rejects array input', () => {
    expect(validateHandCall([1, 2, 3])).toBe('Invalid hand type');
  });

  it('rejects boolean input', () => {
    expect(validateHandCall(true)).toBe('Hand must be an object');
  });

  it('rejects extra properties gracefully (does not fail)', () => {
    // Extra properties should be ignored — only validate required fields
    expect(validateHandCall({
      type: HandType.PAIR,
      rank: '7',
      extraField: 'injection',
      __proto__: { admin: true },
    })).toBeNull();
  });

  it('rejects straight highRank exactly at 5 boundary for straight flush', () => {
    // 5 is the minimum valid highRank (A-2-3-4-5)
    expect(validateHandCall({
      type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: '5',
    })).toBeNull();

    expect(validateHandCall({
      type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: '4',
    })).toBe('Straight flush highRank must be 5 or above');
  });

  it('validates all rank values for HIGH_CARD', () => {
    for (const rank of ALL_RANKS) {
      expect(validateHandCall({ type: HandType.HIGH_CARD, rank })).toBeNull();
    }
  });

  it('validates all suit values for FLUSH', () => {
    for (const suit of ALL_SUITS) {
      expect(validateHandCall({ type: HandType.FLUSH, suit })).toBeNull();
    }
  });

  it('rejects two pair where highRank equals lowRank in value', () => {
    // Same rank = invalid
    expect(validateHandCall({
      type: HandType.TWO_PAIR, highRank: '7', lowRank: '7',
    })).toBe('Two pair ranks must differ');
  });
});
