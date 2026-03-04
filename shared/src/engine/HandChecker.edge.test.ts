import { describe, it, expect } from 'vitest';
import { HandChecker } from './HandChecker.js';
import { HandType } from '../types.js';
import type { Card, HandCall, OwnedCard } from '../types.js';

// ─── Straight detection edge cases ──────────────────────────────────────────

describe('HandChecker: straight detection boundaries', () => {
  it('detects ace-low straight (A-2-3-4-5)', () => {
    const cards: Card[] = [
      { rank: 'A', suit: 'clubs' },
      { rank: '2', suit: 'hearts' },
      { rank: '3', suit: 'diamonds' },
      { rank: '4', suit: 'spades' },
      { rank: '5', suit: 'clubs' },
    ];
    expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: '5' })).toBe(true);
  });

  it('detects ace-high straight (10-J-Q-K-A)', () => {
    const cards: Card[] = [
      { rank: '10', suit: 'clubs' },
      { rank: 'J', suit: 'hearts' },
      { rank: 'Q', suit: 'diamonds' },
      { rank: 'K', suit: 'spades' },
      { rank: 'A', suit: 'clubs' },
    ];
    expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: 'A' })).toBe(true);
  });

  it('rejects wrap-around straight (Q-K-A-2-3)', () => {
    const cards: Card[] = [
      { rank: 'Q', suit: 'clubs' },
      { rank: 'K', suit: 'hearts' },
      { rank: 'A', suit: 'diamonds' },
      { rank: '2', suit: 'spades' },
      { rank: '3', suit: 'clubs' },
    ];
    // No straight with highRank '3' should work (would need A,2,3,4,5... missing 4,5)
    // And no straight with highRank 'A' should exist (needs 10,J,Q,K,A... has Q,K,A but no 10,J)
    expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: '3' })).toBe(false);
  });

  it('detects straight from cards spread across many players', () => {
    const cards: Card[] = [
      { rank: '6', suit: 'clubs' },
      { rank: '7', suit: 'hearts' },
      { rank: 'K', suit: 'diamonds' }, // noise
      { rank: '8', suit: 'spades' },
      { rank: '2', suit: 'clubs' },    // noise
      { rank: '9', suit: 'diamonds' },
      { rank: '10', suit: 'hearts' },
    ];
    expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: '10' })).toBe(true);
  });

  it('rejects straight when one rank is missing', () => {
    const cards: Card[] = [
      { rank: '6', suit: 'clubs' },
      { rank: '7', suit: 'hearts' },
      // 8 is missing
      { rank: '9', suit: 'diamonds' },
      { rank: '10', suit: 'hearts' },
    ];
    expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: '10' })).toBe(false);
  });
});

// ─── Flush detection edge cases ─────────────────────────────────────────────

describe('HandChecker: flush detection', () => {
  it('requires exactly 5 cards of the same suit', () => {
    const cards: Card[] = [
      { rank: '2', suit: 'hearts' },
      { rank: '5', suit: 'hearts' },
      { rank: '8', suit: 'hearts' },
      { rank: 'J', suit: 'hearts' },
    ];
    // Only 4 hearts → no flush
    expect(HandChecker.exists(cards, { type: HandType.FLUSH, suit: 'hearts' })).toBe(false);
  });

  it('detects flush with exactly 5 suited cards', () => {
    const cards: Card[] = [
      { rank: '2', suit: 'hearts' },
      { rank: '5', suit: 'hearts' },
      { rank: '8', suit: 'hearts' },
      { rank: 'J', suit: 'hearts' },
      { rank: 'A', suit: 'hearts' },
    ];
    expect(HandChecker.exists(cards, { type: HandType.FLUSH, suit: 'hearts' })).toBe(true);
  });

  it('detects flush with more than 5 suited cards', () => {
    const cards: Card[] = [
      { rank: '2', suit: 'spades' },
      { rank: '3', suit: 'spades' },
      { rank: '5', suit: 'spades' },
      { rank: '7', suit: 'spades' },
      { rank: '9', suit: 'spades' },
      { rank: 'J', suit: 'spades' },
      { rank: 'K', suit: 'spades' },
    ];
    expect(HandChecker.exists(cards, { type: HandType.FLUSH, suit: 'spades' })).toBe(true);
  });

  it('does not confuse suits (hearts present, checking for clubs)', () => {
    const cards: Card[] = [
      { rank: '2', suit: 'hearts' },
      { rank: '3', suit: 'hearts' },
      { rank: '5', suit: 'hearts' },
      { rank: '7', suit: 'hearts' },
      { rank: '9', suit: 'hearts' },
    ];
    expect(HandChecker.exists(cards, { type: HandType.FLUSH, suit: 'clubs' })).toBe(false);
  });
});

// ─── Straight flush edge cases ──────────────────────────────────────────────

describe('HandChecker: straight flush detection', () => {
  it('detects straight flush when all 5 suited sequential cards present', () => {
    const cards: Card[] = [
      { rank: '5', suit: 'diamonds' },
      { rank: '6', suit: 'diamonds' },
      { rank: '7', suit: 'diamonds' },
      { rank: '8', suit: 'diamonds' },
      { rank: '9', suit: 'diamonds' },
    ];
    expect(HandChecker.exists(cards, {
      type: HandType.STRAIGHT_FLUSH, suit: 'diamonds', highRank: '9',
    })).toBe(true);
  });

  it('rejects straight flush when one card is wrong suit', () => {
    const cards: Card[] = [
      { rank: '5', suit: 'diamonds' },
      { rank: '6', suit: 'diamonds' },
      { rank: '7', suit: 'hearts' },   // wrong suit
      { rank: '8', suit: 'diamonds' },
      { rank: '9', suit: 'diamonds' },
    ];
    expect(HandChecker.exists(cards, {
      type: HandType.STRAIGHT_FLUSH, suit: 'diamonds', highRank: '9',
    })).toBe(false);
  });

  it('detects ace-low straight flush (A-2-3-4-5 all same suit)', () => {
    const cards: Card[] = [
      { rank: 'A', suit: 'clubs' },
      { rank: '2', suit: 'clubs' },
      { rank: '3', suit: 'clubs' },
      { rank: '4', suit: 'clubs' },
      { rank: '5', suit: 'clubs' },
    ];
    expect(HandChecker.exists(cards, {
      type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '5',
    })).toBe(true);
  });

  it('detects royal flush (10-J-Q-K-A same suit)', () => {
    const cards: Card[] = [
      { rank: '10', suit: 'spades' },
      { rank: 'J', suit: 'spades' },
      { rank: 'Q', suit: 'spades' },
      { rank: 'K', suit: 'spades' },
      { rank: 'A', suit: 'spades' },
    ];
    expect(HandChecker.exists(cards, { type: HandType.ROYAL_FLUSH, suit: 'spades' })).toBe(true);
  });

  it('rejects royal flush when one card is wrong suit', () => {
    const cards: Card[] = [
      { rank: '10', suit: 'spades' },
      { rank: 'J', suit: 'spades' },
      { rank: 'Q', suit: 'hearts' },  // wrong suit
      { rank: 'K', suit: 'spades' },
      { rank: 'A', suit: 'spades' },
    ];
    expect(HandChecker.exists(cards, { type: HandType.ROYAL_FLUSH, suit: 'spades' })).toBe(false);
  });
});

// ─── Full house edge cases ──────────────────────────────────────────────────

describe('HandChecker: full house edge cases', () => {
  it('detects full house with exactly 3+2 of correct ranks', () => {
    const cards: Card[] = [
      { rank: 'K', suit: 'clubs' },
      { rank: 'K', suit: 'hearts' },
      { rank: 'K', suit: 'diamonds' },
      { rank: '2', suit: 'spades' },
      { rank: '2', suit: 'clubs' },
    ];
    expect(HandChecker.exists(cards, {
      type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: '2',
    })).toBe(true);
  });

  it('rejects full house when threeRank === twoRank', () => {
    const cards: Card[] = [
      { rank: 'K', suit: 'clubs' },
      { rank: 'K', suit: 'hearts' },
      { rank: 'K', suit: 'diamonds' },
      { rank: 'K', suit: 'spades' },
    ];
    expect(HandChecker.exists(cards, {
      type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: 'K',
    })).toBe(false);
  });

  it('rejects full house when only 2 of threeRank exist', () => {
    const cards: Card[] = [
      { rank: 'K', suit: 'clubs' },
      { rank: 'K', suit: 'hearts' },
      { rank: '2', suit: 'spades' },
      { rank: '2', suit: 'clubs' },
    ];
    expect(HandChecker.exists(cards, {
      type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: '2',
    })).toBe(false);
  });

  it('detects full house using cards from different players', () => {
    const cards: Card[] = [
      { rank: 'Q', suit: 'clubs' },
      { rank: 'Q', suit: 'hearts' },
      { rank: '7', suit: 'diamonds' },
      { rank: 'Q', suit: 'diamonds' },
      { rank: '7', suit: 'spades' },
      { rank: 'A', suit: 'clubs' },   // noise
    ];
    expect(HandChecker.exists(cards, {
      type: HandType.FULL_HOUSE, threeRank: 'Q', twoRank: '7',
    })).toBe(true);
  });
});

// ─── Two pair edge cases ────────────────────────────────────────────────────

describe('HandChecker: two pair edge cases', () => {
  it('detects two pair when both ranks have at least 2 cards', () => {
    const cards: Card[] = [
      { rank: 'A', suit: 'clubs' },
      { rank: 'A', suit: 'hearts' },
      { rank: 'K', suit: 'diamonds' },
      { rank: 'K', suit: 'spades' },
    ];
    expect(HandChecker.exists(cards, {
      type: HandType.TWO_PAIR, highRank: 'A', lowRank: 'K',
    })).toBe(true);
  });

  it('rejects two pair when one rank has only 1 card', () => {
    const cards: Card[] = [
      { rank: 'A', suit: 'clubs' },
      { rank: 'A', suit: 'hearts' },
      { rank: 'K', suit: 'diamonds' },
    ];
    expect(HandChecker.exists(cards, {
      type: HandType.TWO_PAIR, highRank: 'A', lowRank: 'K',
    })).toBe(false);
  });
});

// ─── Four of a kind edge cases ──────────────────────────────────────────────

describe('HandChecker: four of a kind', () => {
  it('detects four of a kind', () => {
    const cards: Card[] = [
      { rank: '7', suit: 'clubs' },
      { rank: '7', suit: 'hearts' },
      { rank: '7', suit: 'diamonds' },
      { rank: '7', suit: 'spades' },
    ];
    expect(HandChecker.exists(cards, { type: HandType.FOUR_OF_A_KIND, rank: '7' })).toBe(true);
  });

  it('rejects four of a kind with only 3', () => {
    const cards: Card[] = [
      { rank: '7', suit: 'clubs' },
      { rank: '7', suit: 'hearts' },
      { rank: '7', suit: 'diamonds' },
    ];
    expect(HandChecker.exists(cards, { type: HandType.FOUR_OF_A_KIND, rank: '7' })).toBe(false);
  });
});

// ─── findMatchingCards correctness ──────────────────────────────────────────

describe('HandChecker.findMatchingCards: returns correct card count', () => {
  it('returns exactly 1 card for high card', () => {
    const cards: Card[] = [
      { rank: 'A', suit: 'clubs' },
      { rank: 'A', suit: 'hearts' },
      { rank: '2', suit: 'diamonds' },
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.HIGH_CARD, rank: 'A' });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    expect(result![0].rank).toBe('A');
  });

  it('returns exactly 2 cards for pair', () => {
    const cards: Card[] = [
      { rank: '7', suit: 'clubs' },
      { rank: '7', suit: 'hearts' },
      { rank: '7', suit: 'diamonds' },
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.PAIR, rank: '7' });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(2);
  });

  it('returns exactly 4 cards for two pair', () => {
    const cards: Card[] = [
      { rank: 'A', suit: 'clubs' },
      { rank: 'A', suit: 'hearts' },
      { rank: 'K', suit: 'diamonds' },
      { rank: 'K', suit: 'spades' },
    ];
    const result = HandChecker.findMatchingCards(cards, {
      type: HandType.TWO_PAIR, highRank: 'A', lowRank: 'K',
    });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(4);
  });

  it('returns exactly 3 cards for three of a kind', () => {
    const cards: Card[] = [
      { rank: '9', suit: 'clubs' },
      { rank: '9', suit: 'hearts' },
      { rank: '9', suit: 'diamonds' },
      { rank: '9', suit: 'spades' },
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.THREE_OF_A_KIND, rank: '9' });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(3);
  });

  it('returns exactly 5 cards for flush', () => {
    const cards: Card[] = [
      { rank: '2', suit: 'hearts' },
      { rank: '5', suit: 'hearts' },
      { rank: '8', suit: 'hearts' },
      { rank: 'J', suit: 'hearts' },
      { rank: 'A', suit: 'hearts' },
      { rank: 'K', suit: 'hearts' },
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.FLUSH, suit: 'hearts' });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(5);
  });

  it('returns exactly 5 cards for straight', () => {
    const cards: Card[] = [
      { rank: '5', suit: 'clubs' },
      { rank: '6', suit: 'hearts' },
      { rank: '7', suit: 'diamonds' },
      { rank: '8', suit: 'spades' },
      { rank: '9', suit: 'clubs' },
      { rank: '10', suit: 'hearts' },
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.STRAIGHT, highRank: '9' });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(5);
  });

  it('returns exactly 5 cards for full house', () => {
    const cards: Card[] = [
      { rank: 'K', suit: 'clubs' },
      { rank: 'K', suit: 'hearts' },
      { rank: 'K', suit: 'diamonds' },
      { rank: '2', suit: 'spades' },
      { rank: '2', suit: 'clubs' },
    ];
    const result = HandChecker.findMatchingCards(cards, {
      type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: '2',
    });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(5);
  });

  it('returns exactly 4 cards for four of a kind', () => {
    const cards: Card[] = [
      { rank: 'J', suit: 'clubs' },
      { rank: 'J', suit: 'hearts' },
      { rank: 'J', suit: 'diamonds' },
      { rank: 'J', suit: 'spades' },
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.FOUR_OF_A_KIND, rank: 'J' });
    expect(result).not.toBeNull();
    expect(result!.length).toBe(4);
  });

  it('returns null when hand does not exist', () => {
    const cards: Card[] = [
      { rank: '2', suit: 'clubs' },
      { rank: '3', suit: 'hearts' },
    ];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.PAIR, rank: 'A' });
    expect(result).toBeNull();
  });
});

// ─── findAllRelevantCards includes all matches ──────────────────────────────

describe('HandChecker.findAllRelevantCards: returns ALL relevant cards', () => {
  it('returns all Aces for pair of Aces (even if more than 2 exist)', () => {
    const cards: OwnedCard[] = [
      { rank: 'A', suit: 'clubs', playerId: 'p1', playerName: 'Alice' },
      { rank: 'A', suit: 'hearts', playerId: 'p2', playerName: 'Bob' },
      { rank: 'A', suit: 'diamonds', playerId: 'p3', playerName: 'Charlie' },
      { rank: '2', suit: 'spades', playerId: 'p1', playerName: 'Alice' },
    ];
    const result = HandChecker.findAllRelevantCards(cards, { type: HandType.PAIR, rank: 'A' });
    expect(result.length).toBe(3); // All 3 Aces, not just 2
  });

  it('returns all suited cards for flush (even > 5)', () => {
    const cards: OwnedCard[] = Array.from({ length: 7 }, (_, i) => ({
      rank: (['2', '3', '4', '5', '6', '7', '8'] as const)[i],
      suit: 'hearts' as const,
      playerId: `p${i % 3}`,
      playerName: `Player${i % 3}`,
    }));
    const result = HandChecker.findAllRelevantCards(cards, { type: HandType.FLUSH, suit: 'hearts' });
    expect(result.length).toBe(7); // All 7 hearts
  });

  it('returns cards of both ranks for two pair', () => {
    const cards: OwnedCard[] = [
      { rank: 'K', suit: 'clubs', playerId: 'p1', playerName: 'Alice' },
      { rank: 'K', suit: 'hearts', playerId: 'p2', playerName: 'Bob' },
      { rank: 'K', suit: 'diamonds', playerId: 'p3', playerName: 'Charlie' },
      { rank: '5', suit: 'spades', playerId: 'p1', playerName: 'Alice' },
      { rank: '5', suit: 'clubs', playerId: 'p2', playerName: 'Bob' },
      { rank: '2', suit: 'hearts', playerId: 'p3', playerName: 'Charlie' },
    ];
    const result = HandChecker.findAllRelevantCards(cards, {
      type: HandType.TWO_PAIR, highRank: 'K', lowRank: '5',
    });
    // Should include all 3 Kings and both 5s = 5 cards
    expect(result.length).toBe(5);
  });

  it('returns cards within straight range for straight', () => {
    const cards: OwnedCard[] = [
      { rank: '5', suit: 'clubs', playerId: 'p1', playerName: 'Alice' },
      { rank: '6', suit: 'hearts', playerId: 'p2', playerName: 'Bob' },
      { rank: '6', suit: 'clubs', playerId: 'p1', playerName: 'Alice' }, // duplicate 6
      { rank: '7', suit: 'diamonds', playerId: 'p3', playerName: 'Charlie' },
      { rank: '8', suit: 'spades', playerId: 'p1', playerName: 'Alice' },
      { rank: '9', suit: 'clubs', playerId: 'p2', playerName: 'Bob' },
      { rank: 'K', suit: 'hearts', playerId: 'p3', playerName: 'Charlie' }, // noise
    ];
    const result = HandChecker.findAllRelevantCards(cards, {
      type: HandType.STRAIGHT, highRank: '9',
    });
    // Should include 5,6,6,7,8,9 (both 6s) but not K
    expect(result.length).toBe(6);
    expect(result.every(c => !['K'].includes(c.rank))).toBe(true);
  });
});

// ─── Empty card pool edge cases ─────────────────────────────────────────────

describe('HandChecker: empty or minimal card pools', () => {
  it('returns false for any hand with empty card pool', () => {
    const cards: Card[] = [];
    expect(HandChecker.exists(cards, { type: HandType.HIGH_CARD, rank: 'A' })).toBe(false);
    expect(HandChecker.exists(cards, { type: HandType.PAIR, rank: '2' })).toBe(false);
    expect(HandChecker.exists(cards, { type: HandType.FLUSH, suit: 'hearts' })).toBe(false);
  });

  it('returns false for pair with single card', () => {
    const cards: Card[] = [{ rank: 'A', suit: 'clubs' }];
    expect(HandChecker.exists(cards, { type: HandType.PAIR, rank: 'A' })).toBe(false);
  });

  it('returns true for high card with single card', () => {
    const cards: Card[] = [{ rank: 'A', suit: 'clubs' }];
    expect(HandChecker.exists(cards, { type: HandType.HIGH_CARD, rank: 'A' })).toBe(true);
  });
});
