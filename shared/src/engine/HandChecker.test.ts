import { describe, it, expect } from 'vitest';
import { HandChecker } from './HandChecker.js';
import { HandType } from '../types.js';
import type { Card, HandCall, OwnedCard, Rank, Suit } from '../types.js';

function card(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

function ownedCard(rank: Rank, suit: Suit, playerId: string, playerName: string): OwnedCard {
  return { rank, suit, playerId, playerName };
}

// ─── HandChecker.exists edge cases ──────────────────────────────────────────

describe('HandChecker.exists — edge cases', () => {
  describe('STRAIGHT edge cases', () => {
    it('ace-low straight (A-2-3-4-5) with cards from multiple players', () => {
      const cards = [
        card('A', 'spades'), card('2', 'hearts'), card('3', 'diamonds'),
        card('4', 'clubs'), card('5', 'spades'),
        card('K', 'hearts'), card('Q', 'diamonds'), // noise
      ];
      expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: '5' })).toBe(true);
    });

    it('rejects highRank 4 (no valid straight ends at 4)', () => {
      const cards = [
        card('A', 'spades'), card('2', 'hearts'), card('3', 'diamonds'), card('4', 'clubs'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: '4' as Rank })).toBe(false);
    });

    it('ace does NOT wrap around (Q-K-A-2-3 is not a straight)', () => {
      const cards = [
        card('Q', 'spades'), card('K', 'hearts'), card('A', 'diamonds'),
        card('2', 'clubs'), card('3', 'spades'),
      ];
      // There is no straight with highRank '3' that includes Q-K-A
      expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: '3' as Rank })).toBe(false);
    });
  });

  describe('STRAIGHT_FLUSH edge cases', () => {
    it('ace-low straight flush (A-2-3-4-5 of hearts)', () => {
      const cards = [
        card('A', 'hearts'), card('2', 'hearts'), card('3', 'hearts'),
        card('4', 'hearts'), card('5', 'hearts'),
      ];
      expect(HandChecker.exists(cards, {
        type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: '5',
      })).toBe(true);
    });

    it('rejects straight flush when one card is wrong suit', () => {
      const cards = [
        card('5', 'hearts'), card('6', 'hearts'), card('7', 'hearts'),
        card('8', 'clubs'), // wrong suit
        card('9', 'hearts'),
      ];
      expect(HandChecker.exists(cards, {
        type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: '9',
      })).toBe(false);
    });

    it('finds straight flush among extra cards', () => {
      const cards = [
        card('5', 'spades'), card('6', 'spades'), card('7', 'spades'),
        card('8', 'spades'), card('9', 'spades'),
        card('A', 'hearts'), card('K', 'clubs'), // noise
      ];
      expect(HandChecker.exists(cards, {
        type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '9',
      })).toBe(true);
    });
  });

  describe('ROYAL_FLUSH edge cases', () => {
    it('rejects royal flush with 4 of 5 cards', () => {
      const cards = [
        card('10', 'diamonds'), card('J', 'diamonds'), card('Q', 'diamonds'),
        card('K', 'diamonds'),
        // Missing Ace of diamonds
      ];
      expect(HandChecker.exists(cards, {
        type: HandType.ROYAL_FLUSH, suit: 'diamonds',
      })).toBe(false);
    });

    it('rejects royal flush in wrong suit', () => {
      const cards = [
        card('10', 'hearts'), card('J', 'hearts'), card('Q', 'hearts'),
        card('K', 'hearts'), card('A', 'hearts'),
      ];
      expect(HandChecker.exists(cards, {
        type: HandType.ROYAL_FLUSH, suit: 'spades',
      })).toBe(false);
    });
  });

  describe('FLUSH edge cases', () => {
    it('finds flush with exactly 5 cards of suit among many', () => {
      const cards = [
        card('2', 'hearts'), card('5', 'hearts'), card('8', 'hearts'),
        card('J', 'hearts'), card('A', 'hearts'),
        card('3', 'clubs'), card('K', 'spades'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.FLUSH, suit: 'hearts' })).toBe(true);
    });

    it('finds flush with more than 5 cards of suit', () => {
      const cards = [
        card('2', 'hearts'), card('3', 'hearts'), card('5', 'hearts'),
        card('8', 'hearts'), card('J', 'hearts'), card('A', 'hearts'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.FLUSH, suit: 'hearts' })).toBe(true);
    });
  });

  describe('FULL_HOUSE edge cases', () => {
    it('finds full house when more than 5 matching cards exist', () => {
      // 4 queens + 3 threes — full house Qs over 3s still valid
      const cards = [
        card('Q', 'spades'), card('Q', 'hearts'), card('Q', 'diamonds'), card('Q', 'clubs'),
        card('3', 'clubs'), card('3', 'spades'), card('3', 'hearts'),
      ];
      expect(HandChecker.exists(cards, {
        type: HandType.FULL_HOUSE, threeRank: 'Q', twoRank: '3',
      })).toBe(true);
    });
  });

  describe('empty card pool', () => {
    it('returns false for any hand with empty cards', () => {
      const cards: Card[] = [];
      expect(HandChecker.exists(cards, { type: HandType.HIGH_CARD, rank: 'A' })).toBe(false);
      expect(HandChecker.exists(cards, { type: HandType.PAIR, rank: '2' })).toBe(false);
      expect(HandChecker.exists(cards, { type: HandType.FLUSH, suit: 'hearts' })).toBe(false);
      expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: '9' })).toBe(false);
    });
  });
});

// ─── HandChecker.findMatchingCards edge cases ───────────────────────────────

describe('HandChecker.findMatchingCards — additional coverage', () => {
  it('finds flush cards (returns exactly 5)', () => {
    const cards = [
      card('2', 'hearts'), card('5', 'hearts'), card('8', 'hearts'),
      card('J', 'hearts'), card('A', 'hearts'), card('3', 'hearts'),
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.FLUSH, suit: 'hearts' });
    expect(result).toHaveLength(5);
    expect(result!.every(c => c.suit === 'hearts')).toBe(true);
  });

  it('finds four of a kind cards', () => {
    const cards = [
      card('J', 'spades'), card('J', 'hearts'), card('J', 'diamonds'), card('J', 'clubs'),
      card('2', 'spades'),
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.FOUR_OF_A_KIND, rank: 'J' });
    expect(result).toHaveLength(4);
    expect(result!.every(c => c.rank === 'J')).toBe(true);
  });

  it('finds three of a kind cards', () => {
    const cards = [
      card('9', 'spades'), card('9', 'hearts'), card('9', 'diamonds'), card('2', 'clubs'),
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.THREE_OF_A_KIND, rank: '9' });
    expect(result).toHaveLength(3);
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
      card('K', 'diamonds'), card('A', 'diamonds'),
    ];
    const result = HandChecker.findMatchingCards(cards, {
      type: HandType.ROYAL_FLUSH, suit: 'diamonds',
    });
    expect(result).toHaveLength(5);
  });

  it('finds ace-low straight cards', () => {
    const cards = [
      card('A', 'spades'), card('2', 'hearts'), card('3', 'diamonds'),
      card('4', 'clubs'), card('5', 'spades'),
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.STRAIGHT, highRank: '5' });
    expect(result).toHaveLength(5);
    expect(result!.map(c => c.rank).sort()).toEqual(['2', '3', '4', '5', 'A']);
  });

  it('returns null for non-existent straight flush', () => {
    const cards = [card('5', 'spades'), card('6', 'hearts')];
    expect(HandChecker.findMatchingCards(cards, {
      type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '9',
    })).toBeNull();
  });
});

// ─── HandChecker.findAllRelevantCards ────────────────────────────────────────

describe('HandChecker.findAllRelevantCards', () => {
  it('returns all cards of the matching rank for HIGH_CARD', () => {
    const cards = [
      ownedCard('A', 'spades', 'p1', 'Alice'),
      ownedCard('A', 'hearts', 'p2', 'Bob'),
      ownedCard('K', 'clubs', 'p3', 'Charlie'),
    ];
    const result = HandChecker.findAllRelevantCards(cards, { type: HandType.HIGH_CARD, rank: 'A' });
    expect(result).toHaveLength(2);
    expect(result.every(c => c.rank === 'A')).toBe(true);
  });

  it('returns all cards of matching ranks for TWO_PAIR', () => {
    const cards = [
      ownedCard('J', 'spades', 'p1', 'Alice'),
      ownedCard('J', 'hearts', 'p2', 'Bob'),
      ownedCard('J', 'diamonds', 'p3', 'Charlie'),
      ownedCard('4', 'diamonds', 'p1', 'Alice'),
      ownedCard('4', 'clubs', 'p2', 'Bob'),
      ownedCard('K', 'hearts', 'p3', 'Charlie'),
    ];
    const result = HandChecker.findAllRelevantCards(cards, {
      type: HandType.TWO_PAIR, highRank: 'J', lowRank: '4',
    });
    // Should return all 3 Jacks and both 4s = 5 cards
    expect(result).toHaveLength(5);
  });

  it('returns all cards of matching suit for FLUSH', () => {
    const cards = [
      ownedCard('2', 'hearts', 'p1', 'Alice'),
      ownedCard('5', 'hearts', 'p2', 'Bob'),
      ownedCard('8', 'hearts', 'p1', 'Alice'),
      ownedCard('J', 'hearts', 'p3', 'Charlie'),
      ownedCard('A', 'hearts', 'p2', 'Bob'),
      ownedCard('K', 'clubs', 'p3', 'Charlie'),
    ];
    const result = HandChecker.findAllRelevantCards(cards, { type: HandType.FLUSH, suit: 'hearts' });
    expect(result).toHaveLength(5);
    expect(result.every(c => c.suit === 'hearts')).toBe(true);
  });

  it('returns all straight-relevant cards for STRAIGHT', () => {
    const cards = [
      ownedCard('5', 'spades', 'p1', 'Alice'),
      ownedCard('5', 'hearts', 'p2', 'Bob'), // duplicate rank
      ownedCard('6', 'hearts', 'p1', 'Alice'),
      ownedCard('7', 'diamonds', 'p2', 'Bob'),
      ownedCard('8', 'clubs', 'p3', 'Charlie'),
      ownedCard('9', 'spades', 'p1', 'Alice'),
      ownedCard('K', 'hearts', 'p3', 'Charlie'), // noise
    ];
    const result = HandChecker.findAllRelevantCards(cards, { type: HandType.STRAIGHT, highRank: '9' });
    // Should return both 5s + 6, 7, 8, 9 = 6 cards
    expect(result).toHaveLength(6);
  });

  it('returns only suit-and-rank matching cards for STRAIGHT_FLUSH', () => {
    const cards = [
      ownedCard('5', 'spades', 'p1', 'Alice'),
      ownedCard('5', 'hearts', 'p2', 'Bob'), // wrong suit
      ownedCard('6', 'spades', 'p1', 'Alice'),
      ownedCard('7', 'spades', 'p2', 'Bob'),
      ownedCard('8', 'spades', 'p3', 'Charlie'),
      ownedCard('9', 'spades', 'p1', 'Alice'),
    ];
    const result = HandChecker.findAllRelevantCards(cards, {
      type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '9',
    });
    expect(result).toHaveLength(5);
    expect(result.every(c => c.suit === 'spades')).toBe(true);
  });

  it('returns only suit-and-rank matching cards for ROYAL_FLUSH', () => {
    const cards = [
      ownedCard('10', 'diamonds', 'p1', 'Alice'),
      ownedCard('J', 'diamonds', 'p2', 'Bob'),
      ownedCard('Q', 'diamonds', 'p1', 'Alice'),
      ownedCard('K', 'diamonds', 'p3', 'Charlie'),
      ownedCard('A', 'diamonds', 'p2', 'Bob'),
      ownedCard('A', 'spades', 'p1', 'Alice'), // wrong suit
    ];
    const result = HandChecker.findAllRelevantCards(cards, {
      type: HandType.ROYAL_FLUSH, suit: 'diamonds',
    });
    expect(result).toHaveLength(5);
    expect(result.every(c => c.suit === 'diamonds')).toBe(true);
  });

  it('returns all matching cards for FULL_HOUSE', () => {
    const cards = [
      ownedCard('K', 'spades', 'p1', 'Alice'),
      ownedCard('K', 'hearts', 'p2', 'Bob'),
      ownedCard('K', 'diamonds', 'p3', 'Charlie'),
      ownedCard('K', 'clubs', 'p1', 'Alice'), // 4th king
      ownedCard('5', 'clubs', 'p2', 'Bob'),
      ownedCard('5', 'spades', 'p3', 'Charlie'),
      ownedCard('5', 'hearts', 'p1', 'Alice'), // 3rd five
      ownedCard('2', 'clubs', 'p2', 'Bob'), // noise
    ];
    const result = HandChecker.findAllRelevantCards(cards, {
      type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: '5',
    });
    // All 4 kings + all 3 fives = 7
    expect(result).toHaveLength(7);
  });

  it('returns empty array for invalid straight highRank', () => {
    const cards = [ownedCard('2', 'hearts', 'p1', 'Alice')];
    const result = HandChecker.findAllRelevantCards(cards, {
      type: HandType.STRAIGHT, highRank: '3' as Rank,
    });
    expect(result).toEqual([]);
  });
});
