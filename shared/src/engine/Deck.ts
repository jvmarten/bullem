import { ALL_RANKS, ALL_SUITS } from '../constants.js';
import { seededShuffle } from '../provablyFair.js';
import type { Card, JokerCount } from '../types.js';

/**
 * Card deck with Fisher-Yates shuffle. Supports 0, 1, or 2 joker (wild) cards.
 * Call {@link reset} between rounds to rebuild and reshuffle.
 *
 * Supports two shuffle modes:
 * - **Cryptographic** (default): uses `crypto.getRandomValues` for non-deterministic secure shuffling
 * - **Seeded** (provably fair): uses a deterministic PRNG seeded from a hex string,
 *   allowing clients to independently verify the shuffle
 */
export class Deck {
  private cards: Card[] = [];
  private jokerCount: JokerCount;

  constructor(jokerCount: JokerCount = 0) {
    this.jokerCount = jokerCount;
    this.reset();
  }

  /** Rebuild the deck (52 standard cards + jokers) and shuffle with crypto RNG. */
  reset(): void {
    this.buildDeck();
    this.shuffle();
  }

  /** Rebuild the deck and shuffle deterministically using the given hex seed (provably fair). */
  resetWithSeed(seed: string): void {
    this.buildDeck();
    seededShuffle(this.cards, seed);
  }

  /** Populate the cards array in canonical order (suits × ranks + jokers). */
  private buildDeck(): void {
    this.cards = [];
    for (const suit of ALL_SUITS) {
      for (const rank of ALL_RANKS) {
        this.cards.push({ rank, suit });
      }
    }
    // Jokers use a dummy rank/suit — the isJoker flag is what matters.
    // Suit alternates so the two jokers are distinguishable in the UI.
    const jokerSuits: Card['suit'][] = ['hearts', 'spades'];
    for (let i = 0; i < this.jokerCount; i++) {
      this.cards.push({ rank: 'A', suit: jokerSuits[i]!, isJoker: true });
    }
  }

  /** Shuffle using cryptographic RNG (non-deterministic). */
  shuffle(): void {
    const randomValues = new Uint32Array(this.cards.length - 1);
    globalThis.crypto.getRandomValues(randomValues);
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = randomValues[this.cards.length - 1 - i]! % (i + 1);
      const temp = this.cards[i]!;
      this.cards[i] = this.cards[j]!;
      this.cards[j] = temp;
    }
  }

  /** Remove and return `count` cards from the top of the deck. */
  deal(count: number): Card[] {
    return this.cards.splice(0, count);
  }

  /** Number of cards remaining in the deck. */
  get remaining(): number {
    return this.cards.length;
  }
}
