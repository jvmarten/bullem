import { describe, it, expect } from 'vitest';
import {
  classifyFiveCardHand,
  calculatePayout,
  executeDraw,
  createInitialDeckDrawStats,
  isFreeDrawAvailable,
  timeUntilFreeDraw,
  getPayoutTableEntries,
  drawFiveCards,
  buildDeck,
  shuffleDeck,
  DECK_DRAW_PAYOUTS,
  DECK_DRAW_STARTING_BALANCE,
  DECK_DRAW_FREE_DRAW_COOLDOWN_MS,
  DECK_DRAW_FREE_DRAW_BONUS,
} from './deckDraw.js';
import { HandType } from './types.js';
import type { Card } from './types.js';

describe('classifyFiveCardHand', () => {
  it('identifies a royal flush', () => {
    const cards: Card[] = [
      { rank: '10', suit: 'spades' },
      { rank: 'J', suit: 'spades' },
      { rank: 'Q', suit: 'spades' },
      { rank: 'K', suit: 'spades' },
      { rank: 'A', suit: 'spades' },
    ];
    const result = classifyFiveCardHand(cards);
    expect(result.type).toBe(HandType.ROYAL_FLUSH);
  });

  it('identifies a straight flush', () => {
    const cards: Card[] = [
      { rank: '5', suit: 'hearts' },
      { rank: '6', suit: 'hearts' },
      { rank: '7', suit: 'hearts' },
      { rank: '8', suit: 'hearts' },
      { rank: '9', suit: 'hearts' },
    ];
    const result = classifyFiveCardHand(cards);
    expect(result.type).toBe(HandType.STRAIGHT_FLUSH);
  });

  it('identifies four of a kind', () => {
    const cards: Card[] = [
      { rank: '7', suit: 'spades' },
      { rank: '7', suit: 'hearts' },
      { rank: '7', suit: 'diamonds' },
      { rank: '7', suit: 'clubs' },
      { rank: 'A', suit: 'spades' },
    ];
    const result = classifyFiveCardHand(cards);
    expect(result.type).toBe(HandType.FOUR_OF_A_KIND);
  });

  it('identifies a full house', () => {
    const cards: Card[] = [
      { rank: 'K', suit: 'spades' },
      { rank: 'K', suit: 'hearts' },
      { rank: 'K', suit: 'diamonds' },
      { rank: '3', suit: 'clubs' },
      { rank: '3', suit: 'spades' },
    ];
    const result = classifyFiveCardHand(cards);
    expect(result.type).toBe(HandType.FULL_HOUSE);
  });

  it('identifies a flush', () => {
    const cards: Card[] = [
      { rank: '2', suit: 'diamonds' },
      { rank: '5', suit: 'diamonds' },
      { rank: '8', suit: 'diamonds' },
      { rank: 'J', suit: 'diamonds' },
      { rank: 'A', suit: 'diamonds' },
    ];
    const result = classifyFiveCardHand(cards);
    expect(result.type).toBe(HandType.FLUSH);
  });

  it('identifies a straight', () => {
    const cards: Card[] = [
      { rank: '4', suit: 'spades' },
      { rank: '5', suit: 'hearts' },
      { rank: '6', suit: 'diamonds' },
      { rank: '7', suit: 'clubs' },
      { rank: '8', suit: 'spades' },
    ];
    const result = classifyFiveCardHand(cards);
    expect(result.type).toBe(HandType.STRAIGHT);
  });

  it('identifies a wheel straight (A-2-3-4-5)', () => {
    const cards: Card[] = [
      { rank: 'A', suit: 'spades' },
      { rank: '2', suit: 'hearts' },
      { rank: '3', suit: 'diamonds' },
      { rank: '4', suit: 'clubs' },
      { rank: '5', suit: 'spades' },
    ];
    const result = classifyFiveCardHand(cards);
    expect(result.type).toBe(HandType.STRAIGHT);
  });

  it('identifies three of a kind', () => {
    const cards: Card[] = [
      { rank: '9', suit: 'spades' },
      { rank: '9', suit: 'hearts' },
      { rank: '9', suit: 'diamonds' },
      { rank: '2', suit: 'clubs' },
      { rank: '5', suit: 'spades' },
    ];
    const result = classifyFiveCardHand(cards);
    expect(result.type).toBe(HandType.THREE_OF_A_KIND);
  });

  it('identifies two pair', () => {
    const cards: Card[] = [
      { rank: 'J', suit: 'spades' },
      { rank: 'J', suit: 'hearts' },
      { rank: '4', suit: 'diamonds' },
      { rank: '4', suit: 'clubs' },
      { rank: 'A', suit: 'spades' },
    ];
    const result = classifyFiveCardHand(cards);
    expect(result.type).toBe(HandType.TWO_PAIR);
  });

  it('identifies a pair', () => {
    const cards: Card[] = [
      { rank: '7', suit: 'spades' },
      { rank: '7', suit: 'hearts' },
      { rank: '2', suit: 'diamonds' },
      { rank: '5', suit: 'clubs' },
      { rank: 'A', suit: 'spades' },
    ];
    const result = classifyFiveCardHand(cards);
    expect(result.type).toBe(HandType.PAIR);
  });

  it('identifies high card', () => {
    const cards: Card[] = [
      { rank: '2', suit: 'spades' },
      { rank: '5', suit: 'hearts' },
      { rank: '8', suit: 'diamonds' },
      { rank: 'J', suit: 'clubs' },
      { rank: 'A', suit: 'spades' },
    ];
    const result = classifyFiveCardHand(cards);
    expect(result.type).toBe(HandType.HIGH_CARD);
  });

  it('throws for non-5-card hands', () => {
    expect(() => classifyFiveCardHand([])).toThrow();
    expect(() => classifyFiveCardHand([{ rank: '2', suit: 'spades' }])).toThrow();
  });
});

describe('calculatePayout', () => {
  it('returns correct payout for royal flush', () => {
    expect(calculatePayout({ type: HandType.ROYAL_FLUSH, suit: 'spades' }, 100)).toBe(25_000_000);
  });

  it('returns 0 for high card', () => {
    expect(calculatePayout({ type: HandType.HIGH_CARD, rank: 'A' }, 100)).toBe(0);
  });

  it('returns wager * 1 for pair', () => {
    expect(calculatePayout({ type: HandType.PAIR, rank: '7' }, 50)).toBe(50);
  });
});

describe('executeDraw', () => {
  // Seed RNG for deterministic results
  let callCount = 0;
  const seededRng = () => {
    callCount++;
    // Simple LCG-like determinism
    return ((callCount * 1103515245 + 12345) % 2147483648) / 2147483648;
  };

  it('executes a wagered draw and updates stats', () => {
    callCount = 0;
    const stats = createInitialDeckDrawStats();
    const { result, updatedStats } = executeDraw(stats, 100, false, seededRng);

    expect(result.cards).toHaveLength(5);
    expect(result.wager).toBe(100);
    expect(result.isFreeDraw).toBe(false);
    expect(updatedStats.totalDraws).toBe(1);
    expect(updatedStats.totalWagered).toBe(100);
    expect(updatedStats.handCounts[result.hand.type]).toBe(1);
  });

  it('executes a free draw without deducting balance', () => {
    callCount = 100; // Different seed offset
    const stats = createInitialDeckDrawStats();
    const initialBalance = stats.balance;
    const { result, updatedStats } = executeDraw(stats, 0, true, seededRng, 1000);

    expect(result.wager).toBe(0);
    expect(result.isFreeDraw).toBe(true);
    expect(updatedStats.totalWagered).toBe(0);
    expect(updatedStats.lastFreeDrawAt).toBe(new Date(1000).toISOString());
    // Balance should not decrease (free draw adds payout without deducting wager)
    expect(updatedStats.balance).toBeGreaterThanOrEqual(initialBalance);
  });
});

describe('isFreeDrawAvailable', () => {
  it('returns true when no previous free draw', () => {
    expect(isFreeDrawAvailable(null)).toBe(true);
  });

  it('returns false within cooldown period', () => {
    const recent = new Date(Date.now() - 1000).toISOString();
    expect(isFreeDrawAvailable(recent)).toBe(false);
  });

  it('returns true after cooldown expires', () => {
    const old = new Date(Date.now() - DECK_DRAW_FREE_DRAW_COOLDOWN_MS - 1000).toISOString();
    expect(isFreeDrawAvailable(old)).toBe(true);
  });
});

describe('timeUntilFreeDraw', () => {
  it('returns 0 when no previous draw', () => {
    expect(timeUntilFreeDraw(null)).toBe(0);
  });

  it('returns remaining time within cooldown', () => {
    const now = 100000;
    const lastDraw = new Date(now - 10000).toISOString();
    const remaining = timeUntilFreeDraw(lastDraw, now);
    expect(remaining).toBe(DECK_DRAW_FREE_DRAW_COOLDOWN_MS - 10000);
  });
});

describe('drawFiveCards', () => {
  it('returns exactly 5 cards', () => {
    const cards = drawFiveCards();
    expect(cards).toHaveLength(5);
  });

  it('returns unique cards', () => {
    const cards = drawFiveCards();
    const keys = cards.map(c => `${c.rank}_${c.suit}`);
    expect(new Set(keys).size).toBe(5);
  });
});

describe('buildDeck', () => {
  it('returns 52 cards', () => {
    expect(buildDeck()).toHaveLength(52);
  });
});

describe('getPayoutTableEntries', () => {
  it('returns 10 entries (one per hand type)', () => {
    expect(getPayoutTableEntries()).toHaveLength(10);
  });

  it('entries are in descending payout order', () => {
    const entries = getPayoutTableEntries();
    for (let i = 0; i < entries.length - 1; i++) {
      expect(entries[i]!.multiplier).toBeGreaterThanOrEqual(entries[i + 1]!.multiplier);
    }
  });
});

describe('createInitialDeckDrawStats', () => {
  it('starts with correct balance', () => {
    const stats = createInitialDeckDrawStats();
    expect(stats.balance).toBe(DECK_DRAW_STARTING_BALANCE);
    expect(stats.totalDraws).toBe(0);
    expect(stats.bestHandType).toBeNull();
  });
});
