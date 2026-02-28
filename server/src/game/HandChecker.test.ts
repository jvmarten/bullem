import { describe, it, expect } from 'vitest';
import { HandChecker } from './HandChecker.js';
import { HandType } from '@bull-em/shared';
import type { Card, HandCall, Rank, Suit } from '@bull-em/shared';

function card(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

describe('HandChecker.exists', () => {
  describe('HIGH_CARD', () => {
    it('finds a card with matching rank', () => {
      const cards = [card('A', 'spades'), card('K', 'hearts')];
      expect(HandChecker.exists(cards, { type: HandType.HIGH_CARD, rank: 'A' })).toBe(true);
    });

    it('returns false when rank not present', () => {
      const cards = [card('2', 'spades'), card('3', 'hearts')];
      expect(HandChecker.exists(cards, { type: HandType.HIGH_CARD, rank: 'A' })).toBe(false);
    });
  });

  describe('PAIR', () => {
    it('finds a pair', () => {
      const cards = [card('7', 'spades'), card('7', 'hearts'), card('2', 'clubs')];
      expect(HandChecker.exists(cards, { type: HandType.PAIR, rank: '7' })).toBe(true);
    });

    it('one card is not a pair', () => {
      const cards = [card('7', 'spades'), card('2', 'hearts')];
      expect(HandChecker.exists(cards, { type: HandType.PAIR, rank: '7' })).toBe(false);
    });
  });

  describe('TWO_PAIR', () => {
    it('finds two distinct pairs', () => {
      const cards = [
        card('J', 'spades'), card('J', 'hearts'),
        card('4', 'diamonds'), card('4', 'clubs'),
      ];
      expect(HandChecker.exists(cards, {
        type: HandType.TWO_PAIR, highRank: 'J', lowRank: '4',
      })).toBe(true);
    });

    it('rejects when ranks are the same', () => {
      const cards = [card('J', 'spades'), card('J', 'hearts'), card('J', 'diamonds'), card('J', 'clubs')];
      expect(HandChecker.exists(cards, {
        type: HandType.TWO_PAIR, highRank: 'J', lowRank: 'J',
      })).toBe(false);
    });

    it('rejects when only one pair present', () => {
      const cards = [card('J', 'spades'), card('J', 'hearts'), card('4', 'diamonds')];
      expect(HandChecker.exists(cards, {
        type: HandType.TWO_PAIR, highRank: 'J', lowRank: '4',
      })).toBe(false);
    });
  });

  describe('THREE_OF_A_KIND', () => {
    it('finds three matching cards', () => {
      const cards = [card('9', 'spades'), card('9', 'hearts'), card('9', 'diamonds')];
      expect(HandChecker.exists(cards, { type: HandType.THREE_OF_A_KIND, rank: '9' })).toBe(true);
    });

    it('two is not enough', () => {
      const cards = [card('9', 'spades'), card('9', 'hearts')];
      expect(HandChecker.exists(cards, { type: HandType.THREE_OF_A_KIND, rank: '9' })).toBe(false);
    });
  });

  describe('FLUSH', () => {
    it('finds 5 cards of same suit', () => {
      const cards = [
        card('2', 'hearts'), card('5', 'hearts'), card('8', 'hearts'),
        card('J', 'hearts'), card('A', 'hearts'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.FLUSH, suit: 'hearts' })).toBe(true);
    });

    it('4 cards is not enough', () => {
      const cards = [
        card('2', 'hearts'), card('5', 'hearts'),
        card('8', 'hearts'), card('J', 'hearts'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.FLUSH, suit: 'hearts' })).toBe(false);
    });
  });

  describe('STRAIGHT', () => {
    it('finds a regular straight', () => {
      const cards = [
        card('5', 'spades'), card('6', 'hearts'), card('7', 'diamonds'),
        card('8', 'clubs'), card('9', 'spades'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: '9' })).toBe(true);
    });

    it('finds an ace-low straight (A-2-3-4-5)', () => {
      const cards = [
        card('A', 'spades'), card('2', 'hearts'), card('3', 'diamonds'),
        card('4', 'clubs'), card('5', 'spades'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: '5' })).toBe(true);
    });

    it('ace-high straight (10-J-Q-K-A)', () => {
      const cards = [
        card('10', 'spades'), card('J', 'hearts'), card('Q', 'diamonds'),
        card('K', 'clubs'), card('A', 'spades'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: 'A' })).toBe(true);
    });

    it('rejects invalid straight highRank', () => {
      const cards = [card('2', 'spades'), card('3', 'hearts'), card('4', 'diamonds')];
      expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: '4' })).toBe(false);
    });

    it('rejects when cards are missing', () => {
      const cards = [
        card('5', 'spades'), card('6', 'hearts'), card('8', 'clubs'), card('9', 'spades'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: '9' })).toBe(false);
    });
  });

  describe('FULL_HOUSE', () => {
    it('finds three + two of different ranks', () => {
      const cards = [
        card('Q', 'spades'), card('Q', 'hearts'), card('Q', 'diamonds'),
        card('3', 'clubs'), card('3', 'spades'),
      ];
      expect(HandChecker.exists(cards, {
        type: HandType.FULL_HOUSE, threeRank: 'Q', twoRank: '3',
      })).toBe(true);
    });

    it('rejects when three and two ranks are the same', () => {
      const cards = [card('Q', 'spades'), card('Q', 'hearts'), card('Q', 'diamonds'), card('Q', 'clubs')];
      expect(HandChecker.exists(cards, {
        type: HandType.FULL_HOUSE, threeRank: 'Q', twoRank: 'Q',
      })).toBe(false);
    });
  });

  describe('FOUR_OF_A_KIND', () => {
    it('finds four matching cards', () => {
      const cards = [
        card('2', 'spades'), card('2', 'hearts'), card('2', 'diamonds'), card('2', 'clubs'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.FOUR_OF_A_KIND, rank: '2' })).toBe(true);
    });
  });

  describe('STRAIGHT_FLUSH', () => {
    it('finds five consecutive cards of same suit', () => {
      const cards = [
        card('5', 'spades'), card('6', 'spades'), card('7', 'spades'),
        card('8', 'spades'), card('9', 'spades'),
      ];
      expect(HandChecker.exists(cards, {
        type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '9',
      })).toBe(true);
    });

    it('rejects when mixed suits', () => {
      const cards = [
        card('5', 'spades'), card('6', 'hearts'), card('7', 'spades'),
        card('8', 'spades'), card('9', 'spades'),
      ];
      expect(HandChecker.exists(cards, {
        type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '9',
      })).toBe(false);
    });
  });

  describe('ROYAL_FLUSH', () => {
    it('finds A-high straight flush', () => {
      const cards = [
        card('10', 'diamonds'), card('J', 'diamonds'), card('Q', 'diamonds'),
        card('K', 'diamonds'), card('A', 'diamonds'),
      ];
      expect(HandChecker.exists(cards, {
        type: HandType.ROYAL_FLUSH, suit: 'diamonds',
      })).toBe(true);
    });

    it('rejects when missing a card', () => {
      const cards = [
        card('10', 'diamonds'), card('J', 'diamonds'),
        card('K', 'diamonds'), card('A', 'diamonds'),
      ];
      expect(HandChecker.exists(cards, {
        type: HandType.ROYAL_FLUSH, suit: 'diamonds',
      })).toBe(false);
    });
  });
});

describe('HandChecker.findMatchingCards', () => {
  it('finds the matching card for high card', () => {
    const cards = [card('A', 'spades'), card('K', 'hearts')];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.HIGH_CARD, rank: 'A' });
    expect(result).toEqual([card('A', 'spades')]);
  });

  it('finds pair cards', () => {
    const cards = [card('7', 'spades'), card('7', 'hearts'), card('2', 'clubs')];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.PAIR, rank: '7' });
    expect(result).toHaveLength(2);
    expect(result!.every(c => c.rank === '7')).toBe(true);
  });

  it('finds two pair cards', () => {
    const cards = [
      card('J', 'spades'), card('J', 'hearts'),
      card('4', 'diamonds'), card('4', 'clubs'), card('2', 'spades'),
    ];
    const result = HandChecker.findMatchingCards(cards, {
      type: HandType.TWO_PAIR, highRank: 'J', lowRank: '4',
    });
    expect(result).toHaveLength(4);
  });

  it('finds straight cards', () => {
    const cards = [
      card('5', 'spades'), card('6', 'hearts'), card('7', 'diamonds'),
      card('8', 'clubs'), card('9', 'spades'), card('K', 'hearts'),
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.STRAIGHT, highRank: '9' });
    expect(result).toHaveLength(5);
  });

  it('returns null when hand does not exist', () => {
    const cards = [card('2', 'spades')];
    expect(HandChecker.findMatchingCards(cards, { type: HandType.PAIR, rank: '2' })).toBe(null);
  });

  it('finds full house cards (3 + 2)', () => {
    const cards = [
      card('K', 'spades'), card('K', 'hearts'), card('K', 'diamonds'),
      card('5', 'clubs'), card('5', 'spades'),
    ];
    const result = HandChecker.findMatchingCards(cards, {
      type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: '5',
    });
    expect(result).toHaveLength(5);
    expect(result!.filter(c => c.rank === 'K')).toHaveLength(3);
    expect(result!.filter(c => c.rank === '5')).toHaveLength(2);
  });

  it('finds three of a kind cards', () => {
    const cards = [
      card('9', 'spades'), card('9', 'hearts'), card('9', 'diamonds'), card('2', 'clubs'),
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.THREE_OF_A_KIND, rank: '9' });
    expect(result).toHaveLength(3);
    expect(result!.every(c => c.rank === '9')).toBe(true);
  });

  it('finds flush cards (5 of same suit)', () => {
    const cards = [
      card('2', 'hearts'), card('5', 'hearts'), card('8', 'hearts'),
      card('J', 'hearts'), card('A', 'hearts'), card('3', 'spades'),
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.FLUSH, suit: 'hearts' });
    expect(result).toHaveLength(5);
    expect(result!.every(c => c.suit === 'hearts')).toBe(true);
  });

  it('finds four of a kind cards', () => {
    const cards = [
      card('2', 'spades'), card('2', 'hearts'), card('2', 'diamonds'),
      card('2', 'clubs'), card('A', 'spades'),
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.FOUR_OF_A_KIND, rank: '2' });
    expect(result).toHaveLength(4);
    expect(result!.every(c => c.rank === '2')).toBe(true);
  });

  it('finds straight flush cards', () => {
    const cards = [
      card('5', 'spades'), card('6', 'spades'), card('7', 'spades'),
      card('8', 'spades'), card('9', 'spades'), card('K', 'hearts'),
    ];
    const result = HandChecker.findMatchingCards(cards, {
      type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '9',
    });
    expect(result).toHaveLength(5);
    expect(result!.every(c => c.suit === 'spades')).toBe(true);
  });

  it('finds royal flush cards', () => {
    const cards = [
      card('10', 'diamonds'), card('J', 'diamonds'), card('Q', 'diamonds'),
      card('K', 'diamonds'), card('A', 'diamonds'), card('2', 'clubs'),
    ];
    const result = HandChecker.findMatchingCards(cards, {
      type: HandType.ROYAL_FLUSH, suit: 'diamonds',
    });
    expect(result).toHaveLength(5);
    expect(result!.every(c => c.suit === 'diamonds')).toBe(true);
  });
});

describe('HandChecker.exists edge cases', () => {
  it('flush among many cards of mixed suits', () => {
    const cards = [
      card('2', 'hearts'), card('5', 'spades'), card('8', 'hearts'),
      card('J', 'clubs'), card('A', 'hearts'), card('3', 'hearts'),
      card('K', 'hearts'),
    ];
    expect(HandChecker.exists(cards, { type: HandType.FLUSH, suit: 'hearts' })).toBe(true);
    expect(HandChecker.exists(cards, { type: HandType.FLUSH, suit: 'spades' })).toBe(false);
  });

  it('four of a kind with only 3 cards of that rank', () => {
    const cards = [
      card('A', 'spades'), card('A', 'hearts'), card('A', 'diamonds'),
    ];
    expect(HandChecker.exists(cards, { type: HandType.FOUR_OF_A_KIND, rank: 'A' })).toBe(false);
  });

  it('straight flush ace-low (A-2-3-4-5 in same suit)', () => {
    const cards = [
      card('A', 'clubs'), card('2', 'clubs'), card('3', 'clubs'),
      card('4', 'clubs'), card('5', 'clubs'),
    ];
    expect(HandChecker.exists(cards, {
      type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '5',
    })).toBe(true);
  });

  it('royal flush requires all 5 specific cards in suit', () => {
    // Missing Q
    const cards = [
      card('10', 'spades'), card('J', 'spades'),
      card('K', 'spades'), card('A', 'spades'), card('9', 'spades'),
    ];
    expect(HandChecker.exists(cards, { type: HandType.ROYAL_FLUSH, suit: 'spades' })).toBe(false);
  });

  it('full house requires enough cards of both ranks', () => {
    const cards = [
      card('K', 'spades'), card('K', 'hearts'),
      card('5', 'clubs'), card('5', 'spades'),
    ];
    // Only 2 Kings, need 3 for full house
    expect(HandChecker.exists(cards, {
      type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: '5',
    })).toBe(false);
  });
});
