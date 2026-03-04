import { describe, it, expect } from 'vitest';
import { HandChecker } from './HandChecker.js';
import { HandType } from '../types.js';
import type { Card, HandCall, OwnedCard, Rank, Suit } from '../types.js';
import { ALL_RANKS, ALL_SUITS } from '../constants.js';

function card(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

function ownedCard(rank: Rank, suit: Suit, playerId: string, playerName: string): OwnedCard {
  return { rank, suit, playerId, playerName };
}

// ─── HandChecker.exists — comprehensive hand type coverage ───────────────────

describe('HandChecker.exists — exhaustive hand type verification', () => {
  describe('HIGH_CARD', () => {
    it('finds card when present among many', () => {
      const cards = [card('2', 'spades'), card('5', 'hearts'), card('K', 'diamonds')];
      expect(HandChecker.exists(cards, { type: HandType.HIGH_CARD, rank: 'K' })).toBe(true);
    });

    it('rejects when specific rank not present', () => {
      const cards = [card('2', 'spades'), card('5', 'hearts')];
      expect(HandChecker.exists(cards, { type: HandType.HIGH_CARD, rank: 'A' })).toBe(false);
    });

    it('works for every rank with a full deck', () => {
      const deck: Card[] = [];
      for (const rank of ALL_RANKS) {
        for (const suit of ALL_SUITS) {
          deck.push(card(rank, suit));
        }
      }
      for (const rank of ALL_RANKS) {
        expect(HandChecker.exists(deck, { type: HandType.HIGH_CARD, rank })).toBe(true);
      }
    });
  });

  describe('PAIR', () => {
    it('finds pair when exactly 2 of same rank', () => {
      const cards = [card('7', 'spades'), card('7', 'hearts'), card('2', 'clubs')];
      expect(HandChecker.exists(cards, { type: HandType.PAIR, rank: '7' })).toBe(true);
    });

    it('rejects pair when only 1 of rank present', () => {
      const cards = [card('7', 'spades'), card('2', 'clubs')];
      expect(HandChecker.exists(cards, { type: HandType.PAIR, rank: '7' })).toBe(false);
    });

    it('finds pair even when 4 of same rank exist', () => {
      const cards = [
        card('A', 'spades'), card('A', 'hearts'), card('A', 'diamonds'), card('A', 'clubs'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.PAIR, rank: 'A' })).toBe(true);
    });
  });

  describe('TWO_PAIR', () => {
    it('finds two pair when both pairs exist', () => {
      const cards = [
        card('J', 'spades'), card('J', 'hearts'),
        card('4', 'diamonds'), card('4', 'clubs'),
        card('K', 'hearts'),
      ];
      expect(HandChecker.exists(cards, {
        type: HandType.TWO_PAIR, highRank: 'J', lowRank: '4',
      })).toBe(true);
    });

    it('rejects when one pair is missing', () => {
      const cards = [
        card('J', 'spades'), card('J', 'hearts'),
        card('4', 'diamonds'), // only one 4
        card('K', 'hearts'),
      ];
      expect(HandChecker.exists(cards, {
        type: HandType.TWO_PAIR, highRank: 'J', lowRank: '4',
      })).toBe(false);
    });

    it('rejects when highRank equals lowRank', () => {
      const cards = [
        card('J', 'spades'), card('J', 'hearts'), card('J', 'diamonds'), card('J', 'clubs'),
      ];
      expect(HandChecker.exists(cards, {
        type: HandType.TWO_PAIR, highRank: 'J', lowRank: 'J',
      })).toBe(false);
    });
  });

  describe('FLUSH', () => {
    it('rejects with exactly 4 of suit', () => {
      const cards = [
        card('2', 'hearts'), card('5', 'hearts'), card('8', 'hearts'), card('J', 'hearts'),
        card('K', 'clubs'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.FLUSH, suit: 'hearts' })).toBe(false);
    });

    it('requires exactly 5 or more of the suit', () => {
      const cards = [
        card('2', 'hearts'), card('5', 'hearts'), card('8', 'hearts'),
        card('J', 'hearts'), card('A', 'hearts'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.FLUSH, suit: 'hearts' })).toBe(true);
    });
  });

  describe('THREE_OF_A_KIND', () => {
    it('finds three of a kind', () => {
      const cards = [card('9', 'spades'), card('9', 'hearts'), card('9', 'diamonds')];
      expect(HandChecker.exists(cards, { type: HandType.THREE_OF_A_KIND, rank: '9' })).toBe(true);
    });

    it('rejects with only 2 of rank', () => {
      const cards = [card('9', 'spades'), card('9', 'hearts'), card('2', 'clubs')];
      expect(HandChecker.exists(cards, { type: HandType.THREE_OF_A_KIND, rank: '9' })).toBe(false);
    });
  });

  describe('STRAIGHT', () => {
    it('finds standard straight (6 through 10)', () => {
      const cards = [
        card('6', 'spades'), card('7', 'hearts'), card('8', 'diamonds'),
        card('9', 'clubs'), card('10', 'spades'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: '10' })).toBe(true);
    });

    it('finds ace-high straight (10-J-Q-K-A)', () => {
      const cards = [
        card('10', 'spades'), card('J', 'hearts'), card('Q', 'diamonds'),
        card('K', 'clubs'), card('A', 'spades'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: 'A' })).toBe(true);
    });

    it('finds ace-low straight (A-2-3-4-5)', () => {
      const cards = [
        card('A', 'spades'), card('2', 'hearts'), card('3', 'diamonds'),
        card('4', 'clubs'), card('5', 'spades'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: '5' })).toBe(true);
    });

    it('rejects with one missing card in sequence', () => {
      const cards = [
        card('6', 'spades'), card('7', 'hearts'), /* missing 8 */
        card('9', 'clubs'), card('10', 'spades'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: '10' })).toBe(false);
    });

    it('handles cards from multiple players forming a straight', () => {
      const cards = [
        card('5', 'spades'), card('6', 'hearts'), card('7', 'diamonds'),
        card('8', 'clubs'), card('9', 'spades'), card('K', 'hearts'), card('2', 'diamonds'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: '9' })).toBe(true);
    });
  });

  describe('FULL_HOUSE', () => {
    it('finds full house with exact counts', () => {
      const cards = [
        card('K', 'spades'), card('K', 'hearts'), card('K', 'diamonds'),
        card('5', 'clubs'), card('5', 'spades'),
      ];
      expect(HandChecker.exists(cards, {
        type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: '5',
      })).toBe(true);
    });

    it('rejects when three-rank only has 2', () => {
      const cards = [
        card('K', 'spades'), card('K', 'hearts'),
        card('5', 'clubs'), card('5', 'spades'), card('5', 'diamonds'),
      ];
      expect(HandChecker.exists(cards, {
        type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: '5',
      })).toBe(false);
    });

    it('rejects when threeRank equals twoRank', () => {
      const cards = [
        card('K', 'spades'), card('K', 'hearts'), card('K', 'diamonds'),
        card('K', 'clubs'), card('2', 'spades'),
      ];
      expect(HandChecker.exists(cards, {
        type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: 'K',
      })).toBe(false);
    });
  });

  describe('FOUR_OF_A_KIND', () => {
    it('finds four of a kind', () => {
      const cards = [
        card('J', 'spades'), card('J', 'hearts'), card('J', 'diamonds'), card('J', 'clubs'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.FOUR_OF_A_KIND, rank: 'J' })).toBe(true);
    });

    it('rejects with only 3 of rank', () => {
      const cards = [
        card('J', 'spades'), card('J', 'hearts'), card('J', 'diamonds'), card('2', 'clubs'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.FOUR_OF_A_KIND, rank: 'J' })).toBe(false);
    });
  });

  describe('STRAIGHT_FLUSH', () => {
    it('finds straight flush in specific suit', () => {
      const cards = [
        card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts'),
        card('8', 'hearts'), card('9', 'hearts'),
      ];
      expect(HandChecker.exists(cards, {
        type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: '9',
      })).toBe(true);
    });

    it('rejects when cards are in different suits (straight but not flush)', () => {
      const cards = [
        card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts'),
        card('8', 'clubs'), card('9', 'hearts'),
      ];
      expect(HandChecker.exists(cards, {
        type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: '9',
      })).toBe(false);
    });
  });

  describe('ROYAL_FLUSH', () => {
    it('finds royal flush (10-J-Q-K-A of same suit)', () => {
      const cards = [
        card('10', 'spades'), card('J', 'spades'), card('Q', 'spades'),
        card('K', 'spades'), card('A', 'spades'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.ROYAL_FLUSH, suit: 'spades' })).toBe(true);
    });

    it('rejects royal flush in wrong suit', () => {
      const cards = [
        card('10', 'spades'), card('J', 'spades'), card('Q', 'spades'),
        card('K', 'spades'), card('A', 'spades'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.ROYAL_FLUSH, suit: 'hearts' })).toBe(false);
    });

    it('rejects incomplete royal flush', () => {
      const cards = [
        card('10', 'spades'), card('J', 'spades'), card('Q', 'spades'),
        card('K', 'spades'), // missing A
      ];
      expect(HandChecker.exists(cards, { type: HandType.ROYAL_FLUSH, suit: 'spades' })).toBe(false);
    });
  });
});

// ─── HandChecker.findMatchingCards — null returns ────────────────────────────

describe('HandChecker.findMatchingCards — null/empty edge cases', () => {
  it('returns null for non-existent high card', () => {
    expect(HandChecker.findMatchingCards([], { type: HandType.HIGH_CARD, rank: 'A' })).toBeNull();
  });

  it('returns null for non-existent pair', () => {
    const cards = [card('2', 'spades')];
    expect(HandChecker.findMatchingCards(cards, { type: HandType.PAIR, rank: '2' })).toBeNull();
  });

  it('returns null for non-existent two pair', () => {
    const cards = [card('K', 'spades'), card('K', 'hearts')];
    expect(HandChecker.findMatchingCards(cards, {
      type: HandType.TWO_PAIR, highRank: 'K', lowRank: '4',
    })).toBeNull();
  });

  it('returns null for non-existent full house', () => {
    const cards = [card('K', 'spades'), card('K', 'hearts')];
    expect(HandChecker.findMatchingCards(cards, {
      type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: '3',
    })).toBeNull();
  });

  it('returns null for non-existent straight', () => {
    const cards = [card('2', 'spades'), card('4', 'hearts')];
    expect(HandChecker.findMatchingCards(cards, {
      type: HandType.STRAIGHT, highRank: '6',
    })).toBeNull();
  });

  it('returns null for non-existent flush', () => {
    const cards = [
      card('2', 'hearts'), card('5', 'hearts'), card('8', 'hearts'), card('J', 'hearts'),
    ];
    expect(HandChecker.findMatchingCards(cards, {
      type: HandType.FLUSH, suit: 'hearts',
    })).toBeNull();
  });

  it('returns null for non-existent four of a kind', () => {
    const cards = [card('A', 'spades'), card('A', 'hearts'), card('A', 'diamonds')];
    expect(HandChecker.findMatchingCards(cards, {
      type: HandType.FOUR_OF_A_KIND, rank: 'A',
    })).toBeNull();
  });

  it('returns null for non-existent royal flush', () => {
    const cards = [
      card('10', 'diamonds'), card('J', 'diamonds'), card('Q', 'diamonds'), card('K', 'diamonds'),
    ];
    expect(HandChecker.findMatchingCards(cards, {
      type: HandType.ROYAL_FLUSH, suit: 'diamonds',
    })).toBeNull();
  });
});

// ─── HandChecker.findMatchingCards — correct count ───────────────────────────

describe('HandChecker.findMatchingCards — returns correct number of cards', () => {
  it('HIGH_CARD returns exactly 1 card', () => {
    const cards = [card('A', 'spades'), card('A', 'hearts'), card('2', 'clubs')];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.HIGH_CARD, rank: 'A' });
    expect(result).toHaveLength(1);
    expect(result![0].rank).toBe('A');
  });

  it('PAIR returns exactly 2 cards', () => {
    const cards = [card('7', 'spades'), card('7', 'hearts'), card('7', 'diamonds')];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.PAIR, rank: '7' });
    expect(result).toHaveLength(2);
  });

  it('TWO_PAIR returns exactly 4 cards', () => {
    const cards = [
      card('J', 'spades'), card('J', 'hearts'),
      card('4', 'diamonds'), card('4', 'clubs'),
    ];
    const result = HandChecker.findMatchingCards(cards, {
      type: HandType.TWO_PAIR, highRank: 'J', lowRank: '4',
    });
    expect(result).toHaveLength(4);
  });

  it('THREE_OF_A_KIND returns exactly 3 cards', () => {
    const cards = [card('9', 'spades'), card('9', 'hearts'), card('9', 'diamonds'), card('2', 'clubs')];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.THREE_OF_A_KIND, rank: '9' });
    expect(result).toHaveLength(3);
  });

  it('FLUSH returns exactly 5 cards', () => {
    const cards = [
      card('2', 'hearts'), card('5', 'hearts'), card('8', 'hearts'),
      card('J', 'hearts'), card('A', 'hearts'), card('3', 'hearts'),
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.FLUSH, suit: 'hearts' });
    expect(result).toHaveLength(5);
  });

  it('STRAIGHT returns exactly 5 cards', () => {
    const cards = [
      card('5', 'spades'), card('6', 'hearts'), card('7', 'diamonds'),
      card('8', 'clubs'), card('9', 'spades'),
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.STRAIGHT, highRank: '9' });
    expect(result).toHaveLength(5);
  });

  it('FULL_HOUSE returns exactly 5 cards', () => {
    const cards = [
      card('K', 'spades'), card('K', 'hearts'), card('K', 'diamonds'),
      card('5', 'clubs'), card('5', 'spades'),
    ];
    const result = HandChecker.findMatchingCards(cards, {
      type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: '5',
    });
    expect(result).toHaveLength(5);
  });

  it('FOUR_OF_A_KIND returns exactly 4 cards', () => {
    const cards = [
      card('J', 'spades'), card('J', 'hearts'), card('J', 'diamonds'), card('J', 'clubs'),
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.FOUR_OF_A_KIND, rank: 'J' });
    expect(result).toHaveLength(4);
  });

  it('STRAIGHT_FLUSH returns exactly 5 cards', () => {
    const cards = [
      card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts'),
      card('8', 'hearts'), card('9', 'hearts'),
    ];
    const result = HandChecker.findMatchingCards(cards, {
      type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: '9',
    });
    expect(result).toHaveLength(5);
  });

  it('ROYAL_FLUSH returns exactly 5 cards', () => {
    const cards = [
      card('10', 'diamonds'), card('J', 'diamonds'), card('Q', 'diamonds'),
      card('K', 'diamonds'), card('A', 'diamonds'),
    ];
    const result = HandChecker.findMatchingCards(cards, {
      type: HandType.ROYAL_FLUSH, suit: 'diamonds',
    });
    expect(result).toHaveLength(5);
  });
});
