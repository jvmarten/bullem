/**
 * Exhaustive tests verifying the hand comparison chain is continuous —
 * getMinimumRaise always produces a hand strictly higher than its input,
 * and the chain terminates at Royal Flush (null).
 *
 * A broken link in this chain would make certain hands unraiseable
 * (breaking the game flow) or allow invalid raise sequences.
 */
import { describe, it, expect } from 'vitest';
import { isHigherHand, getMinimumRaise, handToString, validateHandCall } from './hands.js';
import type { HandCall } from './types.js';
import { HandType } from './types.js';

describe('getMinimumRaise chain integrity', () => {
  it('every minimum raise is strictly higher than its input (full chain walk)', () => {
    let current: HandCall | null = { type: HandType.HIGH_CARD, rank: '2' };
    let steps = 0;
    const maxSteps = 1000; // safety bound

    while (current !== null && steps < maxSteps) {
      const next = getMinimumRaise(current);
      if (next === null) break;

      expect(isHigherHand(next, current)).toBe(true);
      // Validate the raised hand is structurally valid
      expect(validateHandCall(next)).toBeNull();

      current = next;
      steps++;
    }

    // Chain should terminate at Royal Flush
    expect(current!.type).toBe(HandType.ROYAL_FLUSH);
    expect(getMinimumRaise(current!)).toBeNull();

    // Should have taken many steps (covers all ranks × types)
    expect(steps).toBeGreaterThan(50);
  });

  it('every hand type is reachable from getMinimumRaise chain', () => {
    const seenTypes = new Set<HandType>();
    let current: HandCall | null = { type: HandType.HIGH_CARD, rank: '2' };
    let steps = 0;

    while (current !== null && steps < 1000) {
      seenTypes.add(current.type);
      current = getMinimumRaise(current);
      steps++;
    }

    // All 10 hand types should appear in the chain
    expect(seenTypes.size).toBe(10);
    for (let t = HandType.HIGH_CARD; t <= HandType.ROYAL_FLUSH; t++) {
      expect(seenTypes.has(t)).toBe(true);
    }
  });

  it('no two consecutive minimum raises produce the same hand', () => {
    let current: HandCall | null = { type: HandType.HIGH_CARD, rank: '2' };
    let prev: HandCall | null = null;
    let steps = 0;

    while (current !== null && steps < 1000) {
      if (prev !== null) {
        expect(handToString(current)).not.toBe(handToString(prev));
      }
      prev = current;
      current = getMinimumRaise(current);
      steps++;
    }
  });
});

describe('isHigherHand boundary conditions', () => {
  it('same hand is not higher than itself', () => {
    const hands: HandCall[] = [
      { type: HandType.HIGH_CARD, rank: 'A' },
      { type: HandType.PAIR, rank: 'K' },
      { type: HandType.TWO_PAIR, highRank: 'A', lowRank: 'K' },
      { type: HandType.FLUSH, suit: 'spades' },
      { type: HandType.THREE_OF_A_KIND, rank: 'Q' },
      { type: HandType.STRAIGHT, highRank: 'A' },
      { type: HandType.FULL_HOUSE, threeRank: 'A', twoRank: 'K' },
      { type: HandType.FOUR_OF_A_KIND, rank: 'A' },
      { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: 'K' },
      { type: HandType.ROYAL_FLUSH, suit: 'spades' },
    ];

    for (const hand of hands) {
      expect(isHigherHand(hand, hand)).toBe(false);
    }
  });

  it('flush of different suits are equal (not higher)', () => {
    const clubs: HandCall = { type: HandType.FLUSH, suit: 'clubs' };
    const spades: HandCall = { type: HandType.FLUSH, suit: 'spades' };

    expect(isHigherHand(clubs, spades)).toBe(false);
    expect(isHigherHand(spades, clubs)).toBe(false);
  });

  it('royal flush of different suits are equal (not higher)', () => {
    const clubs: HandCall = { type: HandType.ROYAL_FLUSH, suit: 'clubs' };
    const spades: HandCall = { type: HandType.ROYAL_FLUSH, suit: 'spades' };

    expect(isHigherHand(clubs, spades)).toBe(false);
    expect(isHigherHand(spades, clubs)).toBe(false);
  });

  it('two pair comparison uses high rank first, then low rank', () => {
    // Same high rank, different low rank
    const tp1: HandCall = { type: HandType.TWO_PAIR, highRank: 'A', lowRank: '3' };
    const tp2: HandCall = { type: HandType.TWO_PAIR, highRank: 'A', lowRank: '2' };
    expect(isHigherHand(tp1, tp2)).toBe(true);
    expect(isHigherHand(tp2, tp1)).toBe(false);

    // Different high rank — high rank dominates
    const tp3: HandCall = { type: HandType.TWO_PAIR, highRank: 'K', lowRank: 'Q' };
    const tp4: HandCall = { type: HandType.TWO_PAIR, highRank: 'A', lowRank: '2' };
    expect(isHigherHand(tp3, tp4)).toBe(false);
    expect(isHigherHand(tp4, tp3)).toBe(true);
  });

  it('full house comparison uses three-rank first, then two-rank', () => {
    const fh1: HandCall = { type: HandType.FULL_HOUSE, threeRank: 'A', twoRank: '3' };
    const fh2: HandCall = { type: HandType.FULL_HOUSE, threeRank: 'A', twoRank: '2' };
    expect(isHigherHand(fh1, fh2)).toBe(true);

    const fh3: HandCall = { type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: 'Q' };
    const fh4: HandCall = { type: HandType.FULL_HOUSE, threeRank: 'A', twoRank: '2' };
    expect(isHigherHand(fh3, fh4)).toBe(false);
  });

  it('straight flush comparison uses rank first, suit as tiebreaker', () => {
    // Different rank — rank wins
    const sf1: HandCall = { type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: 'K' };
    const sf2: HandCall = { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: 'Q' };
    expect(isHigherHand(sf1, sf2)).toBe(true);

    // Same rank — suit tiebreaker (spades > clubs)
    const sf3: HandCall = { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: 'K' };
    const sf4: HandCall = { type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: 'K' };
    expect(isHigherHand(sf3, sf4)).toBe(true);
    expect(isHigherHand(sf4, sf3)).toBe(false);
  });

  it('custom ranking: flush < three of a kind < straight', () => {
    const flush: HandCall = { type: HandType.FLUSH, suit: 'spades' };
    const threeKind: HandCall = { type: HandType.THREE_OF_A_KIND, rank: '2' };
    const straight: HandCall = { type: HandType.STRAIGHT, highRank: '5' };

    expect(isHigherHand(threeKind, flush)).toBe(true);
    expect(isHigherHand(straight, threeKind)).toBe(true);
    expect(isHigherHand(flush, threeKind)).toBe(false);
    expect(isHigherHand(threeKind, straight)).toBe(false);
  });

  it('ace-low straight (5 high) is the lowest straight', () => {
    const aceLow: HandCall = { type: HandType.STRAIGHT, highRank: '5' };
    const sixHigh: HandCall = { type: HandType.STRAIGHT, highRank: '6' };

    expect(isHigherHand(sixHigh, aceLow)).toBe(true);
    expect(isHigherHand(aceLow, sixHigh)).toBe(false);
  });

  it('cross-type comparisons always favor higher type regardless of rank', () => {
    // Pair of Aces should lose to three 2s
    const pairAces: HandCall = { type: HandType.PAIR, rank: 'A' };
    const threeTwo: HandCall = { type: HandType.THREE_OF_A_KIND, rank: '2' };
    // Note: flush is between pair and three-of-a-kind in this game
    expect(isHigherHand(threeTwo, pairAces)).toBe(true);

    // Four aces should lose to any straight flush
    const fourAces: HandCall = { type: HandType.FOUR_OF_A_KIND, rank: 'A' };
    const lowSF: HandCall = { type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '5' };
    expect(isHigherHand(lowSF, fourAces)).toBe(true);
  });
});

describe('handToString formatting', () => {
  it('formats all hand types correctly', () => {
    expect(handToString({ type: HandType.HIGH_CARD, rank: 'A' })).toBe('Ace High');
    expect(handToString({ type: HandType.PAIR, rank: '7' })).toBe('Pair of 7s');
    expect(handToString({ type: HandType.TWO_PAIR, highRank: 'J', lowRank: '4' })).toBe('Two Pair, Jacks and 4s');
    expect(handToString({ type: HandType.FLUSH, suit: 'hearts' })).toBe('Flush in hearts');
    expect(handToString({ type: HandType.THREE_OF_A_KIND, rank: '9' })).toBe('Three 9s');
    expect(handToString({ type: HandType.FULL_HOUSE, threeRank: 'Q', twoRank: '3' })).toBe('Full House, Queens over 3s');
    expect(handToString({ type: HandType.FOUR_OF_A_KIND, rank: '2' })).toBe('Four 2s');
    expect(handToString({ type: HandType.ROYAL_FLUSH, suit: 'diamonds' })).toBe('Royal Flush in diamonds');
  });

  it('formats straights with correct range', () => {
    expect(handToString({ type: HandType.STRAIGHT, highRank: '5' })).toContain('Ace');
    expect(handToString({ type: HandType.STRAIGHT, highRank: '5' })).toContain('5');
    expect(handToString({ type: HandType.STRAIGHT, highRank: 'A' })).toContain('10');
    expect(handToString({ type: HandType.STRAIGHT, highRank: 'A' })).toContain('Ace');
  });

  it('formats straight flushes with suit and range', () => {
    const sf = handToString({ type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '9' });
    expect(sf).toContain('spades');
    expect(sf).toContain('5');
    expect(sf).toContain('9');
  });
});

describe('validateHandCall comprehensive', () => {
  it('rejects straight with highRank below 5', () => {
    expect(validateHandCall({ type: HandType.STRAIGHT, highRank: '4' })).not.toBeNull();
    expect(validateHandCall({ type: HandType.STRAIGHT, highRank: '3' })).not.toBeNull();
    expect(validateHandCall({ type: HandType.STRAIGHT, highRank: '2' })).not.toBeNull();
  });

  it('accepts straight with highRank of 5 (ace-low)', () => {
    expect(validateHandCall({ type: HandType.STRAIGHT, highRank: '5' })).toBeNull();
  });

  it('rejects ace-high straight flush (must be royal flush)', () => {
    expect(validateHandCall({ type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: 'A' })).not.toBeNull();
  });

  it('accepts valid straight flush', () => {
    expect(validateHandCall({ type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: 'K' })).toBeNull();
    expect(validateHandCall({ type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '5' })).toBeNull();
  });

  it('rejects two pair with highRank <= lowRank', () => {
    expect(validateHandCall({ type: HandType.TWO_PAIR, highRank: '3', lowRank: '3' })).not.toBeNull();
    expect(validateHandCall({ type: HandType.TWO_PAIR, highRank: '3', lowRank: '5' })).not.toBeNull();
  });

  it('rejects full house with matching ranks', () => {
    expect(validateHandCall({ type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: 'K' })).not.toBeNull();
  });

  it('accepts valid full house with different ranks', () => {
    expect(validateHandCall({ type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: '2' })).toBeNull();
  });
});
