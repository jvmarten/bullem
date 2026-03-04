import { describe, it, expect } from 'vitest';
import { Deck } from './Deck.js';
import { ALL_RANKS, ALL_SUITS, DECK_SIZE } from '../constants.js';
import type { Card } from '../types.js';

// ─── Deck creation invariants ───────────────────────────────────────────────

describe('Deck: creation and reset', () => {
  it('creates a full 52-card deck', () => {
    const deck = new Deck();
    expect(deck.remaining).toBe(52);
  });

  it('contains every rank-suit combination exactly once', () => {
    const deck = new Deck();
    const allCards = deck.deal(52);
    expect(allCards.length).toBe(52);

    const seen = new Set<string>();
    for (const card of allCards) {
      const key = `${card.rank}-${card.suit}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(52);
  });

  it('contains all 13 ranks', () => {
    const deck = new Deck();
    const allCards = deck.deal(52);
    const ranks = new Set(allCards.map(c => c.rank));
    for (const rank of ALL_RANKS) {
      expect(ranks.has(rank)).toBe(true);
    }
  });

  it('contains all 4 suits', () => {
    const deck = new Deck();
    const allCards = deck.deal(52);
    const suits = new Set(allCards.map(c => c.suit));
    for (const suit of ALL_SUITS) {
      expect(suits.has(suit)).toBe(true);
    }
  });

  it('each rank appears exactly 4 times (once per suit)', () => {
    const deck = new Deck();
    const allCards = deck.deal(52);
    for (const rank of ALL_RANKS) {
      const count = allCards.filter(c => c.rank === rank).length;
      expect(count).toBe(4);
    }
  });

  it('each suit appears exactly 13 times (once per rank)', () => {
    const deck = new Deck();
    const allCards = deck.deal(52);
    for (const suit of ALL_SUITS) {
      const count = allCards.filter(c => c.suit === suit).length;
      expect(count).toBe(13);
    }
  });

  it('reset restores a full 52-card deck after dealing', () => {
    const deck = new Deck();
    deck.deal(20);
    expect(deck.remaining).toBe(32);

    deck.reset();
    expect(deck.remaining).toBe(52);
  });

  it('reset produces a complete deck (no missing cards)', () => {
    const deck = new Deck();
    deck.deal(52);
    deck.reset();

    const allCards = deck.deal(52);
    expect(allCards.length).toBe(52);

    const unique = new Set(allCards.map(c => `${c.rank}-${c.suit}`));
    expect(unique.size).toBe(52);
  });
});

// ─── Dealing behavior ───────────────────────────────────────────────────────

describe('Deck: dealing', () => {
  it('deal removes cards from the deck', () => {
    const deck = new Deck();
    const dealt = deck.deal(5);
    expect(dealt.length).toBe(5);
    expect(deck.remaining).toBe(47);
  });

  it('dealt cards are valid Card objects', () => {
    const deck = new Deck();
    const dealt = deck.deal(10);
    const validRanks = new Set(ALL_RANKS);
    const validSuits = new Set(ALL_SUITS);

    for (const card of dealt) {
      expect(validRanks.has(card.rank)).toBe(true);
      expect(validSuits.has(card.suit)).toBe(true);
    }
  });

  it('consecutive deals do not overlap (no duplicate cards)', () => {
    const deck = new Deck();
    const hand1 = deck.deal(5);
    const hand2 = deck.deal(5);
    const hand3 = deck.deal(5);

    const all = [...hand1, ...hand2, ...hand3];
    const unique = new Set(all.map(c => `${c.rank}-${c.suit}`));
    expect(unique.size).toBe(15);
  });

  it('deal(0) returns empty array and does not change remaining', () => {
    const deck = new Deck();
    const dealt = deck.deal(0);
    expect(dealt).toEqual([]);
    expect(deck.remaining).toBe(52);
  });

  it('deal more than remaining returns only what is left', () => {
    const deck = new Deck();
    deck.deal(50);
    expect(deck.remaining).toBe(2);

    const rest = deck.deal(10);
    expect(rest.length).toBe(2);
    expect(deck.remaining).toBe(0);
  });

  it('deal from empty deck returns empty array', () => {
    const deck = new Deck();
    deck.deal(52);
    expect(deck.remaining).toBe(0);

    const more = deck.deal(5);
    expect(more).toEqual([]);
  });
});

// ─── Shuffle randomness ─────────────────────────────────────────────────────

describe('Deck: shuffle produces different orderings', () => {
  it('two separately created decks are likely in different order', () => {
    // This test is probabilistic but the chance of two shuffled 52-card decks
    // being identical is 1/52! ≈ 0 (astronomically unlikely)
    const deck1 = new Deck();
    const deck2 = new Deck();

    const cards1 = deck1.deal(52);
    const cards2 = deck2.deal(52);

    const order1 = cards1.map(c => `${c.rank}-${c.suit}`).join(',');
    const order2 = cards2.map(c => `${c.rank}-${c.suit}`).join(',');

    // Extremely unlikely to be the same
    expect(order1).not.toBe(order2);
  });

  it('shuffle after reset produces different order', () => {
    const deck = new Deck();
    const firstOrder = deck.deal(52).map(c => `${c.rank}-${c.suit}`).join(',');

    deck.reset();
    const secondOrder = deck.deal(52).map(c => `${c.rank}-${c.suit}`).join(',');

    expect(firstOrder).not.toBe(secondOrder);
  });
});

// ─── DECK_SIZE constant consistency ─────────────────────────────────────────

describe('Deck: DECK_SIZE constant matches actual deck', () => {
  it('DECK_SIZE equals 52', () => {
    expect(DECK_SIZE).toBe(52);
  });

  it('DECK_SIZE equals ALL_RANKS * ALL_SUITS', () => {
    expect(DECK_SIZE).toBe(ALL_RANKS.length * ALL_SUITS.length);
  });
});
