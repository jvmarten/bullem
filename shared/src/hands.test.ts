import { describe, it, expect } from 'vitest';
import { isHigherHand, handToString, getHandTypeName } from './hands.js';
import { HandType } from './types.js';
import type { HandCall, Rank, Suit } from './types.js';

describe('isHigherHand', () => {
  describe('different hand types', () => {
    it('pair beats high card', () => {
      const pair: HandCall = { type: HandType.PAIR, rank: '2' };
      const high: HandCall = { type: HandType.HIGH_CARD, rank: 'A' };
      expect(isHigherHand(pair, high)).toBe(true);
      expect(isHigherHand(high, pair)).toBe(false);
    });

    it('flush beats three of a kind (custom ranking)', () => {
      const flush: HandCall = { type: HandType.FLUSH, suit: 'clubs' };
      const three: HandCall = { type: HandType.THREE_OF_A_KIND, rank: 'A' };
      expect(isHigherHand(flush, three)).toBe(true);
    });

    it('straight beats flush (custom ranking)', () => {
      const straight: HandCall = { type: HandType.STRAIGHT, highRank: '6' };
      const flush: HandCall = { type: HandType.FLUSH, suit: 'spades' };
      expect(isHigherHand(straight, flush)).toBe(true);
    });

    it('royal flush beats straight flush', () => {
      const royal: HandCall = { type: HandType.ROYAL_FLUSH, suit: 'clubs' };
      const sf: HandCall = { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: 'K' };
      expect(isHigherHand(royal, sf)).toBe(true);
    });

    it('full ranking order is respected', () => {
      const hands: HandCall[] = [
        { type: HandType.HIGH_CARD, rank: 'A' },
        { type: HandType.PAIR, rank: '2' },
        { type: HandType.TWO_PAIR, highRank: '3', lowRank: '2' },
        { type: HandType.THREE_OF_A_KIND, rank: '2' },
        { type: HandType.FLUSH, suit: 'clubs' },
        { type: HandType.STRAIGHT, highRank: '6' },
        { type: HandType.FULL_HOUSE, threeRank: '2', twoRank: '3' },
        { type: HandType.FOUR_OF_A_KIND, rank: '2' },
        { type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '6' },
        { type: HandType.ROYAL_FLUSH, suit: 'clubs' },
      ];
      for (let i = 0; i < hands.length - 1; i++) {
        expect(isHigherHand(hands[i + 1], hands[i])).toBe(true);
        expect(isHigherHand(hands[i], hands[i + 1])).toBe(false);
      }
    });
  });

  describe('same hand type comparisons', () => {
    it('high card: higher rank wins', () => {
      const aceHigh: HandCall = { type: HandType.HIGH_CARD, rank: 'A' };
      const kingHigh: HandCall = { type: HandType.HIGH_CARD, rank: 'K' };
      expect(isHigherHand(aceHigh, kingHigh)).toBe(true);
      expect(isHigherHand(kingHigh, aceHigh)).toBe(false);
    });

    it('high card: same rank is not higher', () => {
      const a: HandCall = { type: HandType.HIGH_CARD, rank: '7' };
      const b: HandCall = { type: HandType.HIGH_CARD, rank: '7' };
      expect(isHigherHand(a, b)).toBe(false);
    });

    it('pair: higher rank wins', () => {
      expect(isHigherHand(
        { type: HandType.PAIR, rank: 'Q' },
        { type: HandType.PAIR, rank: 'J' },
      )).toBe(true);
    });

    it('two pair: higher high pair wins', () => {
      expect(isHigherHand(
        { type: HandType.TWO_PAIR, highRank: 'K', lowRank: '3' },
        { type: HandType.TWO_PAIR, highRank: 'Q', lowRank: 'J' },
      )).toBe(true);
    });

    it('two pair: same high pair, higher low pair wins', () => {
      expect(isHigherHand(
        { type: HandType.TWO_PAIR, highRank: 'K', lowRank: '5' },
        { type: HandType.TWO_PAIR, highRank: 'K', lowRank: '3' },
      )).toBe(true);
    });

    it('flush: higher suit wins', () => {
      expect(isHigherHand(
        { type: HandType.FLUSH, suit: 'spades' },
        { type: HandType.FLUSH, suit: 'hearts' },
      )).toBe(true);
      expect(isHigherHand(
        { type: HandType.FLUSH, suit: 'diamonds' },
        { type: HandType.FLUSH, suit: 'clubs' },
      )).toBe(true);
    });

    it('straight: higher top card wins', () => {
      expect(isHigherHand(
        { type: HandType.STRAIGHT, highRank: '9' },
        { type: HandType.STRAIGHT, highRank: '8' },
      )).toBe(true);
    });

    it('full house: higher three-rank wins', () => {
      expect(isHigherHand(
        { type: HandType.FULL_HOUSE, threeRank: 'A', twoRank: '2' },
        { type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: 'Q' },
      )).toBe(true);
    });

    it('full house: same three-rank, higher two-rank wins', () => {
      expect(isHigherHand(
        { type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: 'Q' },
        { type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: 'J' },
      )).toBe(true);
    });

    it('straight flush: higher suit wins first', () => {
      expect(isHigherHand(
        { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '6' },
        { type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: '9' },
      )).toBe(true);
    });

    it('straight flush: same suit, higher rank wins', () => {
      expect(isHigherHand(
        { type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: '9' },
        { type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: '8' },
      )).toBe(true);
    });

    it('royal flush: higher suit wins', () => {
      expect(isHigherHand(
        { type: HandType.ROYAL_FLUSH, suit: 'spades' },
        { type: HandType.ROYAL_FLUSH, suit: 'diamonds' },
      )).toBe(true);
    });
  });
});

describe('handToString', () => {
  it('formats high card', () => {
    expect(handToString({ type: HandType.HIGH_CARD, rank: 'K' })).toBe('King High');
  });

  it('formats pair', () => {
    expect(handToString({ type: HandType.PAIR, rank: '7' })).toBe('Pair of 7s');
  });

  it('formats two pair', () => {
    expect(handToString({ type: HandType.TWO_PAIR, highRank: 'J', lowRank: '4' }))
      .toBe('Two Pair, Jacks and 4s');
  });

  it('formats three of a kind', () => {
    expect(handToString({ type: HandType.THREE_OF_A_KIND, rank: '9' })).toBe('Three 9s');
  });

  it('formats flush', () => {
    expect(handToString({ type: HandType.FLUSH, suit: 'hearts' })).toBe('Flush in hearts');
  });

  it('formats straight', () => {
    expect(handToString({ type: HandType.STRAIGHT, highRank: '9' })).toBe('Straight, 5 to 9');
  });

  it('formats full house', () => {
    expect(handToString({ type: HandType.FULL_HOUSE, threeRank: 'Q', twoRank: '3' }))
      .toBe('Full House, Queens over 3s');
  });

  it('formats four of a kind', () => {
    expect(handToString({ type: HandType.FOUR_OF_A_KIND, rank: '2' })).toBe('Four 2s');
  });

  it('formats straight flush', () => {
    expect(handToString({ type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '9' }))
      .toBe('Straight Flush in spades, 5 to 9');
  });

  it('formats royal flush', () => {
    expect(handToString({ type: HandType.ROYAL_FLUSH, suit: 'diamonds' }))
      .toBe('Royal Flush in diamonds');
  });
});

describe('getHandTypeName', () => {
  it('returns correct names for all hand types', () => {
    expect(getHandTypeName(HandType.HIGH_CARD)).toBe('High Card');
    expect(getHandTypeName(HandType.PAIR)).toBe('Pair');
    expect(getHandTypeName(HandType.TWO_PAIR)).toBe('Two Pair');
    expect(getHandTypeName(HandType.THREE_OF_A_KIND)).toBe('Three of a Kind');
    expect(getHandTypeName(HandType.FLUSH)).toBe('Flush');
    expect(getHandTypeName(HandType.STRAIGHT)).toBe('Straight');
    expect(getHandTypeName(HandType.FULL_HOUSE)).toBe('Full House');
    expect(getHandTypeName(HandType.FOUR_OF_A_KIND)).toBe('Four of a Kind');
    expect(getHandTypeName(HandType.STRAIGHT_FLUSH)).toBe('Straight Flush');
    expect(getHandTypeName(HandType.ROYAL_FLUSH)).toBe('Royal Flush');
  });
});
