import { ALL_RANKS, ALL_SUITS } from '@bull-em/shared';
import type { Card } from '@bull-em/shared';

export class Deck {
  private cards: Card[] = [];

  constructor() {
    this.reset();
  }

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
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  deal(count: number): Card[] {
    return this.cards.splice(0, count);
  }

  get remaining(): number {
    return this.cards.length;
  }
}
