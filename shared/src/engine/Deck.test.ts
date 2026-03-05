import { describe, it, expect } from 'vitest';
import { Deck } from './Deck.js';
import { ALL_RANKS, ALL_SUITS } from '../constants.js';
import type { Card, Rank, Suit } from '../types.js';

describe('Deck', () => {
  describe('construction and reset', () => {
    it('starts with 52 cards', () => {
      const deck = new Deck();
      expect(deck.remaining).toBe(52);
    });

    it('contains all 52 unique cards after construction', () => {
      const deck = new Deck();
      const cards = deck.deal(52);
      expect(cards).toHaveLength(52);

      // Verify every rank-suit combination exists exactly once
      const seen = new Set<string>();
      for (const card of cards) {
        const key = `${card.rank}-${card.suit}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      expect(seen.size).toBe(52);
    });

    it('reset restores full 52-card deck', () => {
      const deck = new Deck();
      deck.deal(10);
      expect(deck.remaining).toBe(42);

      deck.reset();
      expect(deck.remaining).toBe(52);

      const cards = deck.deal(52);
      expect(cards).toHaveLength(52);
    });

    it('contains all 4 suits', () => {
      const deck = new Deck();
      const cards = deck.deal(52);
      const suits = new Set(cards.map(c => c.suit));
      expect(suits.size).toBe(4);
      for (const suit of ALL_SUITS) {
        expect(suits.has(suit)).toBe(true);
      }
    });

    it('contains all 13 ranks', () => {
      const deck = new Deck();
      const cards = deck.deal(52);
      const ranks = new Set(cards.map(c => c.rank));
      expect(ranks.size).toBe(13);
      for (const rank of ALL_RANKS) {
        expect(ranks.has(rank)).toBe(true);
      }
    });

    it('has exactly 4 cards per rank', () => {
      const deck = new Deck();
      const cards = deck.deal(52);
      const rankCounts = new Map<string, number>();
      for (const card of cards) {
        rankCounts.set(card.rank, (rankCounts.get(card.rank) ?? 0) + 1);
      }
      for (const rank of ALL_RANKS) {
        expect(rankCounts.get(rank)).toBe(4);
      }
    });

    it('has exactly 13 cards per suit', () => {
      const deck = new Deck();
      const cards = deck.deal(52);
      const suitCounts = new Map<string, number>();
      for (const card of cards) {
        suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1);
      }
      for (const suit of ALL_SUITS) {
        expect(suitCounts.get(suit)).toBe(13);
      }
    });
  });

  describe('deal', () => {
    it('removes dealt cards from the deck', () => {
      const deck = new Deck();
      const dealt = deck.deal(5);
      expect(dealt).toHaveLength(5);
      expect(deck.remaining).toBe(47);
    });

    it('dealing 0 cards returns empty array', () => {
      const deck = new Deck();
      const dealt = deck.deal(0);
      expect(dealt).toEqual([]);
      expect(deck.remaining).toBe(52);
    });

    it('deals from the top (first cards are removed)', () => {
      const deck = new Deck();
      const first5 = deck.deal(5);
      const next5 = deck.deal(5);
      expect(deck.remaining).toBe(42);

      // First and next should not overlap
      for (const c1 of first5) {
        for (const c2 of next5) {
          expect(c1.rank === c2.rank && c1.suit === c2.suit).toBe(false);
        }
      }
    });

    it('deals all 52 cards without duplicates', () => {
      const deck = new Deck();
      const allCards: Card[] = [];

      // Deal in batches
      allCards.push(...deck.deal(10));
      allCards.push(...deck.deal(10));
      allCards.push(...deck.deal(10));
      allCards.push(...deck.deal(10));
      allCards.push(...deck.deal(10));
      allCards.push(...deck.deal(2));

      expect(allCards).toHaveLength(52);
      expect(deck.remaining).toBe(0);

      const seen = new Set(allCards.map(c => `${c.rank}-${c.suit}`));
      expect(seen.size).toBe(52);
    });

    it('deals fewer cards when deck has less than requested', () => {
      const deck = new Deck();
      deck.deal(50); // 2 remaining
      const dealt = deck.deal(5); // asks for 5, gets 2
      expect(dealt).toHaveLength(2);
      expect(deck.remaining).toBe(0);
    });

    it('deals empty array from exhausted deck', () => {
      const deck = new Deck();
      deck.deal(52);
      const dealt = deck.deal(1);
      expect(dealt).toEqual([]);
      expect(deck.remaining).toBe(0);
    });
  });

  describe('shuffle', () => {
    it('preserves all 52 cards after shuffle', () => {
      const deck = new Deck();
      deck.shuffle();
      const cards = deck.deal(52);
      expect(cards).toHaveLength(52);

      const seen = new Set(cards.map(c => `${c.rank}-${c.suit}`));
      expect(seen.size).toBe(52);
    });

    it('produces different orderings on consecutive resets (statistical)', () => {
      // Run 10 resets and check that at least one produces a different order.
      // The probability of getting the exact same order is astronomically small.
      const deck = new Deck();
      const orders: string[] = [];

      for (let i = 0; i < 10; i++) {
        deck.reset();
        const cards = deck.deal(52);
        orders.push(cards.map(c => `${c.rank}${c.suit}`).join(','));
        deck.reset(); // for next iteration
      }

      const uniqueOrders = new Set(orders);
      // Expect at least 2 different orderings out of 10 (extremely likely)
      expect(uniqueOrders.size).toBeGreaterThan(1);
    });

    it('shuffle of a partial deck preserves remaining card count', () => {
      const deck = new Deck();
      deck.deal(20);
      expect(deck.remaining).toBe(32);

      deck.shuffle();
      expect(deck.remaining).toBe(32);
    });
  });

  describe('multiple rounds simulation', () => {
    it('simulates 3 rounds of dealing to 4 players', () => {
      const deck = new Deck();

      for (let round = 0; round < 3; round++) {
        deck.reset();
        const allDealt: Card[] = [];

        for (let player = 0; player < 4; player++) {
          const hand = deck.deal(round + 1); // 1, 2, 3 cards per round
          expect(hand).toHaveLength(round + 1);
          allDealt.push(...hand);
        }

        // No duplicates within a round
        const seen = new Set(allDealt.map(c => `${c.rank}-${c.suit}`));
        expect(seen.size).toBe(allDealt.length);
      }
    });

    it('handles maximum players scenario (12 players x 5 cards = 60 > 52)', () => {
      const deck = new Deck();
      deck.reset();

      let totalDealt = 0;
      for (let p = 0; p < 12; p++) {
        const needed = 5;
        const available = Math.min(needed, deck.remaining);
        const hand = deck.deal(available);
        totalDealt += hand.length;

        // Early players get full hands
        if (p < 10) {
          expect(hand.length).toBe(5);
        }
      }

      // Should have dealt all 52 cards (can't deal more than exist)
      expect(totalDealt).toBe(52);
      expect(deck.remaining).toBe(0);
    });
  });
});
