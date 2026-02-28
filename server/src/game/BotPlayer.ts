import {
  HandType, RoundPhase, RANK_VALUES, ALL_RANKS, ALL_SUITS,
  isHigherHand,
} from '@bull-em/shared';
import type {
  Card, HandCall, Rank, Suit, ClientGameState,
} from '@bull-em/shared';

export type BotAction =
  | { action: 'call'; hand: HandCall }
  | { action: 'bull' }
  | { action: 'true' }
  | { action: 'lastChanceRaise'; hand: HandCall }
  | { action: 'lastChancePass' };

export class BotPlayer {
  /**
   * Decide what action a bot should take given the current game state and its cards.
   */
  static decideAction(state: ClientGameState, botId: string, botCards: Card[]): BotAction {
    const { roundPhase, currentHand, lastCallerId } = state;

    // LAST_CHANCE phase — bot is the caller who got bull'd by everyone
    if (roundPhase === RoundPhase.LAST_CHANCE && lastCallerId === botId) {
      if (currentHand) {
        const higher = this.findHandHigherThan(botCards, currentHand);
        if (higher) {
          return { action: 'lastChanceRaise', hand: higher };
        }
      }
      return { action: 'lastChancePass' };
    }

    // CALLING phase, no current hand — bot makes the opening call
    if (roundPhase === RoundPhase.CALLING && !currentHand) {
      const hand = this.findBestHandInCards(botCards);
      if (hand && Math.random() < 0.8) {
        return { action: 'call', hand };
      }
      // Bluff: call a low hand
      return { action: 'call', hand: this.makeBluffHand(null) };
    }

    // CALLING phase with current hand — bot must raise or this shouldn't happen
    // (Only the next player after a call lands here)
    if (roundPhase === RoundPhase.CALLING && currentHand) {
      const totalCards = state.players
        .filter(p => !p.isEliminated)
        .reduce((sum, p) => sum + p.cardCount, 0);

      // Try to find a legit higher hand
      const higher = this.findHandHigherThan(botCards, currentHand);
      if (higher && Math.random() < 0.6) {
        return { action: 'call', hand: higher };
      }

      // Bluff raise if the call seems plausible
      const plausibility = this.estimatePlausibility(currentHand, botCards, totalCards);
      if (plausibility > 0.3 && Math.random() < 0.3) {
        const bluff = this.makeBluffHand(currentHand);
        if (bluff && isHigherHand(bluff, currentHand)) {
          return { action: 'call', hand: bluff };
        }
      }

      // Call bull
      return { action: 'bull' };
    }

    // BULL_PHASE — bot must call bull or true
    if (roundPhase === RoundPhase.BULL_PHASE && currentHand) {
      const totalCards = state.players
        .filter(p => !p.isEliminated)
        .reduce((sum, p) => sum + p.cardCount, 0);
      const plausibility = this.estimatePlausibility(currentHand, botCards, totalCards);

      // Also allow raise in bull phase
      if (Math.random() < 0.15) {
        const higher = this.findHandHigherThan(botCards, currentHand);
        if (higher) {
          return { action: 'call', hand: higher };
        }
      }

      if (plausibility > 0.5) {
        return Math.random() < 0.6 ? { action: 'true' } : { action: 'bull' };
      }
      return Math.random() < 0.7 ? { action: 'bull' } : { action: 'true' };
    }

    // Fallback — call bull if there's a hand, otherwise make an opening call
    if (currentHand) {
      return { action: 'bull' };
    }
    return { action: 'call', hand: { type: HandType.HIGH_CARD, rank: 'A' } };
  }

  /**
   * Find the best hand that actually exists in the bot's own cards.
   */
  static findBestHandInCards(cards: Card[]): HandCall | null {
    // Check from highest to lowest hand types (within reason for own cards)

    // Pairs — most likely with few cards
    const rankCounts = new Map<Rank, number>();
    for (const c of cards) {
      rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
    }

    // Four of a kind
    for (const [rank, count] of rankCounts) {
      if (count >= 4) return { type: HandType.FOUR_OF_A_KIND, rank };
    }

    // Three of a kind
    for (const [rank, count] of rankCounts) {
      if (count >= 3) return { type: HandType.THREE_OF_A_KIND, rank };
    }

    // Pair — find highest pair
    let bestPairRank: Rank | null = null;
    for (const [rank, count] of rankCounts) {
      if (count >= 2) {
        if (!bestPairRank || RANK_VALUES[rank] > RANK_VALUES[bestPairRank]) {
          bestPairRank = rank;
        }
      }
    }
    if (bestPairRank) return { type: HandType.PAIR, rank: bestPairRank };

    // High card — highest card
    if (cards.length > 0) {
      let bestRank: Rank = cards[0].rank;
      for (const c of cards) {
        if (RANK_VALUES[c.rank] > RANK_VALUES[bestRank]) {
          bestRank = c.rank;
        }
      }
      return { type: HandType.HIGH_CARD, rank: bestRank };
    }

    return null;
  }

  /**
   * Find a valid hand that is higher than the given current hand, based on bot's cards.
   * Returns null if no higher hand can be found.
   */
  static findHandHigherThan(cards: Card[], currentHand: HandCall): HandCall | null {
    // Try same type first, then higher types
    const candidates: HandCall[] = [];

    // Generate candidate hands from own cards
    const rankCounts = new Map<Rank, number>();
    const suitCounts = new Map<Suit, number>();
    for (const c of cards) {
      rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
      suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
    }

    // High cards
    for (const c of cards) {
      candidates.push({ type: HandType.HIGH_CARD, rank: c.rank });
    }

    // Pairs
    for (const [rank, count] of rankCounts) {
      if (count >= 2) candidates.push({ type: HandType.PAIR, rank });
    }

    // Three of a kind
    for (const [rank, count] of rankCounts) {
      if (count >= 3) candidates.push({ type: HandType.THREE_OF_A_KIND, rank });
    }

    // Filter to those that beat the current hand
    const valid = candidates.filter(h => isHigherHand(h, currentHand));
    if (valid.length > 0) {
      // Pick the lowest valid hand to be conservative
      valid.sort((a, b) => {
        if (a.type !== b.type) return a.type - b.type;
        return 0;
      });
      return valid[0];
    }

    return null;
  }

  /**
   * Estimate how plausible a called hand is, given the bot's own cards and total card count.
   * Returns 0..1 where higher = more plausible.
   */
  static estimatePlausibility(hand: HandCall, ownCards: Card[], totalCards: number): number {
    switch (hand.type) {
      case HandType.HIGH_CARD: {
        // Almost always plausible if there are many cards
        const hasIt = ownCards.some(c => c.rank === hand.rank);
        if (hasIt) return 0.95;
        // Probability of at least one in remaining cards
        return Math.min(0.9, totalCards * 0.07);
      }
      case HandType.PAIR: {
        const count = ownCards.filter(c => c.rank === hand.rank).length;
        if (count >= 2) return 0.95;
        if (count === 1) return Math.min(0.7, totalCards * 0.05);
        return Math.min(0.4, totalCards * 0.02);
      }
      case HandType.TWO_PAIR:
        return totalCards >= 6 ? 0.35 : 0.15;
      case HandType.THREE_OF_A_KIND: {
        const count = ownCards.filter(c => c.rank === hand.rank).length;
        if (count >= 3) return 0.95;
        if (count >= 2) return 0.4;
        return totalCards >= 8 ? 0.2 : 0.1;
      }
      case HandType.FLUSH:
        return totalCards >= 10 ? 0.3 : 0.1;
      case HandType.STRAIGHT:
        return totalCards >= 8 ? 0.25 : 0.08;
      case HandType.FULL_HOUSE:
        return totalCards >= 10 ? 0.15 : 0.05;
      case HandType.FOUR_OF_A_KIND:
        return totalCards >= 12 ? 0.1 : 0.03;
      case HandType.STRAIGHT_FLUSH:
        return 0.02;
      case HandType.ROYAL_FLUSH:
        return 0.01;
      default:
        return 0.3;
    }
  }

  /**
   * Generate a bluff hand that is higher than the current hand.
   */
  static makeBluffHand(currentHand: HandCall | null): HandCall {
    if (!currentHand) {
      // Opening bluff: random low hand
      const rank = ALL_RANKS[Math.floor(Math.random() * 8) + 5]; // 7 through A
      return { type: HandType.HIGH_CARD, rank };
    }

    // Try to make a hand one step above current
    if (currentHand.type === HandType.HIGH_CARD) {
      const cr = currentHand as { type: HandType.HIGH_CARD; rank: Rank };
      const nextRankVal = RANK_VALUES[cr.rank] + 1;
      const nextRank = ALL_RANKS.find(r => RANK_VALUES[r] === nextRankVal);
      if (nextRank) return { type: HandType.HIGH_CARD, rank: nextRank };
      // Escalate to pair of 2s
      return { type: HandType.PAIR, rank: '2' };
    }

    if (currentHand.type === HandType.PAIR) {
      const cr = currentHand as { type: HandType.PAIR; rank: Rank };
      const nextRankVal = RANK_VALUES[cr.rank] + 1;
      const nextRank = ALL_RANKS.find(r => RANK_VALUES[r] === nextRankVal);
      if (nextRank) return { type: HandType.PAIR, rank: nextRank };
      return { type: HandType.THREE_OF_A_KIND, rank: '2' };
    }

    // For higher hand types, just bump to next type with low values
    if (currentHand.type < HandType.FLUSH) {
      return { type: HandType.FLUSH, suit: ALL_SUITS[Math.floor(Math.random() * 4)] };
    }
    if (currentHand.type < HandType.STRAIGHT) {
      return { type: HandType.STRAIGHT, highRank: '6' };
    }

    // Fallback: just return a high card ace (shouldn't normally reach here)
    return { type: HandType.HIGH_CARD, rank: 'A' };
  }
}
