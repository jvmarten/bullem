import { ALL_RANKS, ALL_SUITS } from '../constants.js';
import type { Card } from '../types.js';

/**
 * Standard 52-card deck with Fisher-Yates shuffle.
 * Call {@link reset} between rounds to rebuild and reshuffle.
 */
export class Deck {
  private cards: Card[] = [];

  constructor() {
    this.reset();
  }

  /** Rebuild the full 52-card deck and shuffle it. */
  reset(): void {
    this.cards = [];
    for (const suit of ALL_SUITS) {
      for (const rank of ALL_RANKS) {
        this.cards.push({ rank, suit });
      }
    }
    this.shuffle();
  }

  shuffle(): void {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
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
