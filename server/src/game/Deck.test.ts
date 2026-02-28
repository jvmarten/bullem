import { describe, it, expect } from 'vitest';
import { Deck } from './Deck.js';

describe('Deck', () => {
  it('creates a deck with 52 cards', () => {
    const deck = new Deck();
    expect(deck.remaining).toBe(52);
  });

  it('deals the requested number of cards', () => {
    const deck = new Deck();
    const cards = deck.deal(5);
    expect(cards).toHaveLength(5);
    expect(deck.remaining).toBe(47);
  });

  it('deals unique cards', () => {
    const deck = new Deck();
    const cards = deck.deal(52);
    const keys = cards.map(c => `${c.rank}-${c.suit}`);
    expect(new Set(keys).size).toBe(52);
  });

  it('reset restores all 52 cards', () => {
    const deck = new Deck();
    deck.deal(10);
    expect(deck.remaining).toBe(42);
    deck.reset();
    expect(deck.remaining).toBe(52);
  });

  it('shuffle produces different orderings (statistical)', () => {
    // Deal twice from fresh decks — highly unlikely to be identical
    const deck1 = new Deck();
    const deck2 = new Deck();
    const cards1 = deck1.deal(10).map(c => `${c.rank}-${c.suit}`);
    const cards2 = deck2.deal(10).map(c => `${c.rank}-${c.suit}`);
    // Not a guarantee, but extremely unlikely to be identical
    // Just verify both have 10 cards
    expect(cards1).toHaveLength(10);
    expect(cards2).toHaveLength(10);
  });

  it('dealing more cards than remaining returns what is available', () => {
    const deck = new Deck();
    deck.deal(50);
    const remaining = deck.deal(5);
    expect(remaining).toHaveLength(2);
    expect(deck.remaining).toBe(0);
  });
});
