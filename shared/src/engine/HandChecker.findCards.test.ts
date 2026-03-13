import { describe, it, expect } from 'vitest';
import { HandChecker } from './HandChecker.js';
import { HandType } from '../types.js';
import type { Card, OwnedCard } from '../types.js';

/**
 * Tests for HandChecker.findMatchingCards and findAllRelevantCards
 * focused on gaps: joker handling, owned cards, edge cases in
 * card selection and reveal logic.
 */

function ownedCard(rank: Card['rank'], suit: Card['suit'], playerId: string, isJoker = false): OwnedCard {
  return { rank, suit, playerId, playerName: `Player ${playerId}`, ...(isJoker ? { isJoker: true } : {}) };
}

function card(rank: Card['rank'], suit: Card['suit'], isJoker = false): Card {
  return { rank, suit, ...(isJoker ? { isJoker: true } : {}) };
}

// ── findMatchingCards with jokers ───────────────────────────────────────────

describe('HandChecker.findMatchingCards: joker substitution', () => {
  it('uses joker to complete a pair when only 1 natural card exists', () => {
    const cards: Card[] = [
      card('A', 'spades'),
      card('A', 'hearts', true), // joker
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.PAIR, rank: 'A' });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(2);
    expect(result!.some(c => c.isJoker)).toBe(true);
  });

  it('uses joker for high card when no natural card of that rank exists', () => {
    const cards: Card[] = [
      card('2', 'hearts'),
      card('A', 'hearts', true), // joker
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.HIGH_CARD, rank: 'K' });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    expect(result![0]!.isJoker).toBe(true);
  });

  it('uses joker to fill gap in straight', () => {
    const cards: Card[] = [
      card('5', 'clubs'),
      card('6', 'hearts'),
      // 7 is missing → joker fills
      card('8', 'diamonds'),
      card('9', 'spades'),
      card('A', 'hearts', true), // joker
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.STRAIGHT, highRank: '9' });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(5);
    expect(result!.some(c => c.isJoker)).toBe(true);
  });

  it('uses joker to fill gap in straight flush', () => {
    const cards: Card[] = [
      card('5', 'diamonds'),
      card('6', 'diamonds'),
      // 7 diamonds is missing
      card('8', 'diamonds'),
      card('9', 'diamonds'),
      card('A', 'hearts', true), // joker
    ];
    const result = HandChecker.findMatchingCards(cards, {
      type: HandType.STRAIGHT_FLUSH, suit: 'diamonds', highRank: '9',
    });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(5);
  });

  it('uses jokers to complete a flush when less than 5 of suit exist', () => {
    const cards: Card[] = [
      card('2', 'hearts'),
      card('5', 'hearts'),
      card('8', 'hearts'),
      card('J', 'hearts'),
      // Only 4 hearts + 1 joker
      card('A', 'spades', true), // joker
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.FLUSH, suit: 'hearts' });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(5);
  });

  it('uses joker for full house when threeRank needs help', () => {
    const cards: Card[] = [
      card('K', 'clubs'),
      card('K', 'hearts'),
      // Only 2 Kings + joker → 3
      card('2', 'spades'),
      card('2', 'clubs'),
      card('A', 'hearts', true), // joker
    ];
    const result = HandChecker.findMatchingCards(cards, {
      type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: '2',
    });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(5);
  });

  it('uses two jokers when needed for two pair', () => {
    // Need: 2 Aces + 2 Kings. Have: 1 Ace + 1 King + 2 jokers.
    // High pair picks 1 Ace + 1 joker. Low pair picks 1 King + 1 joker.
    const cards: Card[] = [
      card('A', 'clubs'),
      card('K', 'diamonds'),
      card('A', 'hearts', true), // joker 1
      card('A', 'spades', true), // joker 2
    ];
    const result = HandChecker.findMatchingCards(cards, {
      type: HandType.TWO_PAIR, highRank: 'A', lowRank: 'K',
    });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(4);
  });
});

// ── findMatchingCards returns null correctly ─────────────────────────────────

describe('HandChecker.findMatchingCards: returns null for impossible hands', () => {
  it('null when insufficient jokers for straight', () => {
    const cards: Card[] = [
      card('5', 'clubs'),
      // Missing 6, 7, 8 — would need 3 jokers but only have 1
      card('9', 'spades'),
      card('A', 'hearts', true),
    ];
    expect(HandChecker.findMatchingCards(cards, { type: HandType.STRAIGHT, highRank: '9' })).toBeNull();
  });

  it('null for royal flush with insufficient cards even with jokers', () => {
    const cards: Card[] = [
      card('10', 'spades'),
      card('J', 'spades'),
      // Missing Q, K, A — would need 3 jokers but only have 2
      card('A', 'hearts', true),
      card('A', 'clubs', true),
    ];
    expect(HandChecker.findMatchingCards(cards, { type: HandType.ROYAL_FLUSH, suit: 'spades' })).toBeNull();
  });

  it('null for empty card pool', () => {
    expect(HandChecker.findMatchingCards([], { type: HandType.HIGH_CARD, rank: 'A' })).toBeNull();
  });
});

// ── findAllRelevantCards with jokers ─────────────────────────────────────────

describe('HandChecker.findAllRelevantCards: joker handling in reveal', () => {
  it('includes jokers when natural cards alone do not satisfy hand', () => {
    const cards: OwnedCard[] = [
      ownedCard('A', 'clubs', 'p1'),
      ownedCard('A', 'hearts', 'p2', true), // joker needed for pair
    ];
    const result = HandChecker.findAllRelevantCards(cards, { type: HandType.PAIR, rank: 'A' });
    // 1 natural Ace + joker = 2 cards, joker included because natural cards alone don't make pair
    expect(result.some(c => c.isJoker)).toBe(true);
  });

  it('excludes jokers when natural cards alone satisfy hand', () => {
    const cards: OwnedCard[] = [
      ownedCard('A', 'clubs', 'p1'),
      ownedCard('A', 'hearts', 'p2'),
      ownedCard('A', 'diamonds', 'p3', true), // joker not needed
    ];
    const result = HandChecker.findAllRelevantCards(cards, { type: HandType.PAIR, rank: 'A' });
    // 2 natural Aces exist → joker not needed → excluded
    expect(result.every(c => !c.isJoker)).toBe(true);
    expect(result.length).toBe(2);
  });

  it('returns all relevant normal cards plus jokers for straight when needed', () => {
    const cards: OwnedCard[] = [
      ownedCard('5', 'clubs', 'p1'),
      ownedCard('6', 'hearts', 'p2'),
      // 7 missing — joker fills
      ownedCard('8', 'diamonds', 'p1'),
      ownedCard('9', 'spades', 'p2'),
      ownedCard('A', 'hearts', 'p3', true), // joker
    ];
    const result = HandChecker.findAllRelevantCards(cards, { type: HandType.STRAIGHT, highRank: '9' });
    // Should include 5,6,8,9 (normal) + joker
    expect(result.length).toBe(5);
    expect(result.some(c => c.isJoker)).toBe(true);
  });
});

// ── findAllRelevantCards: straight with duplicates ──────────────────────────

describe('HandChecker.findAllRelevantCards: duplicates in straight', () => {
  it('includes duplicate ranks within straight range', () => {
    const cards: OwnedCard[] = [
      ownedCard('5', 'clubs', 'p1'),
      ownedCard('5', 'hearts', 'p2'), // duplicate 5
      ownedCard('6', 'diamonds', 'p1'),
      ownedCard('7', 'spades', 'p2'),
      ownedCard('8', 'clubs', 'p3'),
      ownedCard('9', 'hearts', 'p1'),
    ];
    const result = HandChecker.findAllRelevantCards(cards, { type: HandType.STRAIGHT, highRank: '9' });
    // Both 5s should be included (all relevant cards)
    expect(result.length).toBe(6);
  });
});

// ── findAllRelevantCards: full house includes all relevant ──────────────────

describe('HandChecker.findAllRelevantCards: full house', () => {
  it('includes all cards of both ranks, not just 3+2', () => {
    const cards: OwnedCard[] = [
      ownedCard('K', 'clubs', 'p1'),
      ownedCard('K', 'hearts', 'p2'),
      ownedCard('K', 'diamonds', 'p3'),
      ownedCard('K', 'spades', 'p1'), // 4th King — still relevant
      ownedCard('2', 'clubs', 'p2'),
      ownedCard('2', 'hearts', 'p3'),
      ownedCard('2', 'diamonds', 'p1'), // 3rd 2 — still relevant
      ownedCard('7', 'spades', 'p2'), // noise
    ];
    const result = HandChecker.findAllRelevantCards(cards, {
      type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: '2',
    });
    // All 4 Kings + all 3 2s = 7 (not just 5)
    expect(result.length).toBe(7);
  });
});

// ── findAllRelevantCards: straight flush only counts suited cards ───────────

describe('HandChecker.findAllRelevantCards: straight flush', () => {
  it('only includes cards of correct suit within straight range', () => {
    const cards: OwnedCard[] = [
      ownedCard('5', 'diamonds', 'p1'),
      ownedCard('6', 'diamonds', 'p2'),
      ownedCard('6', 'hearts', 'p3'), // right rank, wrong suit
      ownedCard('7', 'diamonds', 'p1'),
      ownedCard('8', 'diamonds', 'p2'),
      ownedCard('9', 'diamonds', 'p3'),
    ];
    const result = HandChecker.findAllRelevantCards(cards, {
      type: HandType.STRAIGHT_FLUSH, suit: 'diamonds', highRank: '9',
    });
    // Only diamond cards in the 5-9 range: 5d, 6d, 7d, 8d, 9d
    expect(result.length).toBe(5);
    expect(result.every(c => c.suit === 'diamonds')).toBe(true);
  });
});

// ── exists: boundary straight highRank values ───────────────────────────────

describe('HandChecker.exists: all valid straight highRank values', () => {
  const allStraightHighRanks = ['5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;

  for (const highRank of allStraightHighRanks) {
    it(`detects ${highRank}-high straight when cards exist`, () => {
      const rankValues: Record<string, number> = {
        '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
        '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
      };
      const valueToRank = new Map(Object.entries(rankValues).map(([r, v]) => [v, r]));
      const highVal = rankValues[highRank]!;

      let ranks: string[];
      if (highVal === 5) {
        ranks = ['A', '2', '3', '4', '5'];
      } else {
        ranks = [];
        for (let v = highVal - 4; v <= highVal; v++) {
          ranks.push(valueToRank.get(v)!);
        }
      }

      const suits = ['clubs', 'hearts', 'diamonds', 'spades'] as const;
      const cards: Card[] = ranks.map((r, i) => ({ rank: r as Card['rank'], suit: suits[i % 4]! }));

      expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: highRank as Card['rank'] })).toBe(true);
    });
  }

  it('rejects highRank=4 (impossible straight)', () => {
    const cards: Card[] = [
      card('A', 'clubs'), card('2', 'hearts'), card('3', 'diamonds'), card('4', 'spades'),
    ];
    expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: '4' })).toBe(false);
  });

  it('rejects highRank=3 (impossible straight)', () => {
    expect(HandChecker.exists([], { type: HandType.STRAIGHT, highRank: '3' })).toBe(false);
  });
});
