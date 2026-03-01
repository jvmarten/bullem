import { HandType, RoundPhase, BotDifficulty, TurnAction } from '../types.js';
import { RANK_VALUES, ALL_RANKS, ALL_SUITS, SUIT_ORDER } from '../constants.js';
import { isHigherHand } from '../hands.js';
import type { Card, HandCall, Rank, Suit, ClientGameState } from '../types.js';

export type BotAction =
  | { action: 'call'; hand: HandCall }
  | { action: 'bull' }
  | { action: 'true' }
  | { action: 'lastChanceRaise'; hand: HandCall }
  | { action: 'lastChancePass' };

export class BotPlayer {
  /**
   * Decide what action a bot should take given the current game state, its cards, and difficulty.
   */
  static decideAction(
    state: ClientGameState,
    botId: string,
    botCards: Card[],
    difficulty: BotDifficulty = BotDifficulty.EASY,
  ): BotAction {
    if (difficulty === BotDifficulty.HARD) {
      return this.decideHard(state, botId, botCards);
    }
    return this.decideEasy(state, botId, botCards);
  }

  // ─── EASY MODE ───────────────────────────────────────────────────────

  private static decideEasy(state: ClientGameState, botId: string, botCards: Card[]): BotAction {
    const { roundPhase, currentHand, lastCallerId } = state;

    // LAST_CHANCE phase
    if (roundPhase === RoundPhase.LAST_CHANCE && lastCallerId === botId) {
      if (currentHand) {
        const higher = this.findHandHigherThanSimple(botCards, currentHand);
        if (higher) {
          return { action: 'lastChanceRaise', hand: higher };
        }
      }
      return { action: 'lastChancePass' };
    }

    // Opening call — no current hand
    if (roundPhase === RoundPhase.CALLING && !currentHand) {
      const hand = this.findBestHandInCards(botCards);
      if (hand && Math.random() < 0.9) {
        return { action: 'call', hand };
      }
      // 10% bluff
      return { action: 'call', hand: this.makeBluffHandEasy(null) };
    }

    // Raise or bull in calling phase
    if (roundPhase === RoundPhase.CALLING && currentHand) {
      const higher = this.findHandHigherThanSimple(botCards, currentHand);
      if (higher && Math.random() < 0.6) {
        return { action: 'call', hand: higher };
      }
      // 10% bluff chance
      if (Math.random() < 0.1) {
        const bluff = this.makeBluffHandEasy(currentHand);
        if (bluff && isHigherHand(bluff, currentHand)) {
          return { action: 'call', hand: bluff };
        }
      }
      return { action: 'bull' };
    }

    // Bull phase — simple coin flip weighted by rough heuristic
    if (roundPhase === RoundPhase.BULL_PHASE && currentHand) {
      const totalCards = this.getTotalCards(state);
      const plausibility = this.estimatePlausibilitySimple(currentHand, botCards, totalCards);

      if (plausibility > 0.5) {
        return Math.random() < 0.55 ? { action: 'true' } : { action: 'bull' };
      }
      return Math.random() < 0.65 ? { action: 'bull' } : { action: 'true' };
    }

    // Fallback
    if (currentHand) return { action: 'bull' };
    return { action: 'call', hand: { type: HandType.HIGH_CARD, rank: 'A' } };
  }

  // ─── HARD MODE (Probability-Driven) ─────────────────────────────────

  private static decideHard(state: ClientGameState, botId: string, botCards: Card[]): BotAction {
    const { roundPhase, currentHand, lastCallerId } = state;
    const totalCards = this.getTotalCards(state);
    const desperate = botCards.length >= 4;

    // LAST_CHANCE phase — raise with any valid hand we can find
    if (roundPhase === RoundPhase.LAST_CHANCE && lastCallerId === botId) {
      if (currentHand) {
        // Try legitimate hand first
        const higher = this.findHandHigherThanFull(botCards, currentHand, totalCards);
        if (higher) return { action: 'lastChanceRaise', hand: higher };
        // Try plausible bluff (we're about to lose anyway)
        const bluff = this.findBestPlausibleRaise(currentHand, botCards, totalCards);
        if (bluff) return { action: 'lastChanceRaise', hand: bluff };
      }
      return { action: 'lastChancePass' };
    }

    // Opening call — start low and truthful
    if (roundPhase === RoundPhase.CALLING && !currentHand) {
      return this.handleHardOpening(botCards, totalCards);
    }

    // Calling phase — EV-driven raise vs bull
    if (roundPhase === RoundPhase.CALLING && currentHand) {
      return this.handleHardCallingPhase(currentHand, botCards, totalCards, desperate);
    }

    // Bull phase — pure probability threshold
    if (roundPhase === RoundPhase.BULL_PHASE && currentHand) {
      return this.handleHardBullPhase(currentHand, botCards, totalCards, desperate);
    }

    // Fallback
    if (currentHand) return { action: 'bull' };
    return { action: 'call', hand: { type: HandType.HIGH_CARD, rank: '2' } };
  }

  /**
   * Opening: call the LOWEST truthful hand from own cards.
   * This is optimal because it leaves room for future raises and reveals minimum info.
   */
  private static handleHardOpening(botCards: Card[], totalCards: number): BotAction {
    // Find lowest truthful hand — sort all hands from own cards by rank
    const candidates: HandCall[] = [];
    const rankCounts = this.getRankCounts(botCards);

    // All high cards we have (sorted lowest first)
    for (const c of botCards) {
      candidates.push({ type: HandType.HIGH_CARD, rank: c.rank });
    }

    // Pairs we have
    for (const [rank, count] of rankCounts) {
      if (count >= 2) candidates.push({ type: HandType.PAIR, rank });
    }

    // Sort by hand strength (lowest first) and pick the lowest
    candidates.sort((a, b) => {
      if (a.type !== b.type) return a.type - b.type;
      return this.getHandPrimaryRank(a) - this.getHandPrimaryRank(b);
    });

    if (candidates.length > 0) {
      return { action: 'call', hand: candidates[0] };
    }

    // Fallback: bluff with a low, plausible hand
    return { action: 'call', hand: this.makeBluffHandHard(null, totalCards) };
  }

  /**
   * Calling phase: Compute P(called hand exists), then decide:
   * - If P < bullThreshold: call bull (hand probably doesn't exist)
   * - If we have a legitimate raise: raise with lowest valid hand
   * - If P > raiseThreshold and we can bluff raise: bluff (calling bull is too risky)
   * - Otherwise: call bull
   */
  private static handleHardCallingPhase(
    currentHand: HandCall,
    botCards: Card[],
    totalCards: number,
    desperate: boolean,
  ): BotAction {
    const p = this.estimatePlausibilityHard(currentHand, botCards, totalCards);
    const higher = this.findHandHigherThanFull(botCards, currentHand, totalCards);

    // Confident bull: hand is very unlikely to exist
    if (p < 0.25 && !desperate) {
      return { action: 'bull' };
    }

    // We have a legitimate higher hand — raise is almost always correct
    // (avoid bull penalty by passing the decision to the next player)
    if (higher) {
      // Even with a legitimate hand, sometimes call bull on very implausible hands
      if (p < 0.15 && Math.random() < 0.3) {
        return { action: 'bull' };
      }
      return { action: 'call', hand: higher };
    }

    // No legitimate hand. Decision depends on how plausible the called hand is.
    // If P is high (hand likely real), calling bull will probably penalize us.
    // If P is low (hand likely fake), calling bull is profitable.

    if (p > 0.55) {
      // Hand is probably real — try to find a plausible bluff raise
      const bluff = this.findBestPlausibleRaise(currentHand, botCards, totalCards);
      if (bluff) return { action: 'call', hand: bluff };
      // Can't raise — calling bull is risky but our only option
      return { action: 'bull' };
    }

    if (p > 0.35) {
      // Uncertain — try bluff raise if desperate, otherwise lean bull
      if (desperate) {
        const bluff = this.findBestPlausibleRaise(currentHand, botCards, totalCards);
        if (bluff) return { action: 'call', hand: bluff };
      }
      // Lean toward bull (55/45)
      return Math.random() < 0.55 ? { action: 'bull' } : (() => {
        const bluff = this.findBestPlausibleRaise(currentHand, botCards, totalCards);
        return bluff ? { action: 'call' as const, hand: bluff } : { action: 'bull' as const };
      })();
    }

    // p <= 0.35 — hand likely doesn't exist, call bull
    return { action: 'bull' };
  }

  /**
   * Bull phase: Pure expected value decision.
   * EV(true)  = P(hand exists) × 0 + P(hand doesn't exist) × (-1) = -P(doesn't exist)
   * EV(bull)  = P(hand doesn't exist) × 0 + P(hand exists) × (-1) = -P(exists)
   * ⟹ Call true when P(exists) > 0.5, bull when P(exists) < 0.5
   * Add small noise (5%) to avoid being perfectly predictable.
   */
  private static handleHardBullPhase(
    currentHand: HandCall,
    botCards: Card[],
    totalCards: number,
    desperate: boolean,
  ): BotAction {
    const p = this.estimatePlausibilityHard(currentHand, botCards, totalCards);

    // Optional: consider raising in bull phase if we have a strong legitimate hand
    const higher = this.findHandHigherThanFull(botCards, currentHand, totalCards);
    if (higher && Math.random() < 0.15) {
      return { action: 'call', hand: higher };
    }

    // When desperate (4+ cards), shift threshold slightly toward true
    // to avoid the penalty that would eliminate us
    const threshold = desperate ? 0.4 : 0.5;
    const noise = 0.05;

    if (p > threshold + noise) {
      return { action: 'true' };
    }
    if (p < threshold - noise) {
      return { action: 'bull' };
    }
    // Within noise band — randomize
    return Math.random() < p ? { action: 'true' } : { action: 'bull' };
  }

  /**
   * Find the best plausible raise hand — used when we can't raise legitimately
   * but need to raise to avoid calling bull on a likely-real hand.
   * Returns the MOST plausible hand that is higher than currentHand.
   */
  private static findBestPlausibleRaise(
    currentHand: HandCall,
    ownCards: Card[],
    totalCards: number,
  ): HandCall | null {
    const candidates: HandCall[] = [];
    const rankCounts = this.getRankCounts(ownCards);

    // Generate candidates across hand types that are higher than current

    // Pair bluffs — use ranks we have at least 1 of (more believable)
    if (currentHand.type <= HandType.PAIR) {
      for (const [rank, count] of rankCounts) {
        if (count >= 1) {
          const hand: HandCall = { type: HandType.PAIR, rank };
          if (isHigherHand(hand, currentHand)) candidates.push(hand);
        }
      }
    }

    // Two pair bluffs
    if (currentHand.type <= HandType.TWO_PAIR && totalCards >= 6) {
      const heldRanks = [...rankCounts.keys()];
      for (let i = 0; i < heldRanks.length; i++) {
        for (let j = i + 1; j < heldRanks.length; j++) {
          const [a, b] = RANK_VALUES[heldRanks[i]] > RANK_VALUES[heldRanks[j]]
            ? [heldRanks[i], heldRanks[j]]
            : [heldRanks[j], heldRanks[i]];
          const hand: HandCall = { type: HandType.TWO_PAIR, highRank: a, lowRank: b };
          if (isHigherHand(hand, currentHand)) candidates.push(hand);
        }
      }
    }

    // Three of a kind bluffs
    if (currentHand.type <= HandType.THREE_OF_A_KIND && totalCards >= 6) {
      for (const [rank, count] of rankCounts) {
        if (count >= 1) {
          const hand: HandCall = { type: HandType.THREE_OF_A_KIND, rank };
          if (isHigherHand(hand, currentHand)) candidates.push(hand);
        }
      }
    }

    // Flush bluffs (flush can't raise flush)
    if (totalCards >= 8 && currentHand.type < HandType.FLUSH) {
      const suitCounts = this.getSuitCounts(ownCards);
      for (const [suit] of suitCounts) {
        const hand: HandCall = { type: HandType.FLUSH, suit };
        if (isHigherHand(hand, currentHand)) candidates.push(hand);
      }
    }

    // Straight bluffs
    if (totalCards >= 7 && currentHand.type <= HandType.STRAIGHT) {
      const straightHighs: Rank[] = ['5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
      for (const highRank of straightHighs) {
        const hand: HandCall = { type: HandType.STRAIGHT, highRank };
        if (isHigherHand(hand, currentHand)) {
          candidates.push(hand);
          break; // Take lowest valid straight
        }
      }
    }

    if (candidates.length === 0) return null;

    // Score each candidate by plausibility and pick the most plausible
    let best: HandCall | null = null;
    let bestScore = -1;
    for (const hand of candidates) {
      const score = this.estimatePlausibilityHard(hand, ownCards, totalCards);
      if (score > bestScore) {
        bestScore = score;
        best = hand;
      }
    }

    // Only bluff if the hand is at least somewhat plausible
    return bestScore >= 0.08 ? best : null;
  }

  // ─── HAND FINDING (SIMPLE — Easy mode) ──────────────────────────────

  /**
   * Find the best hand from bot's own cards (HIGH_CARD, PAIR, THREE_OF_A_KIND, FOUR_OF_A_KIND only).
   */
  static findBestHandInCards(cards: Card[]): HandCall | null {
    const rankCounts = this.getRankCounts(cards);

    for (const [rank, count] of rankCounts) {
      if (count >= 4) return { type: HandType.FOUR_OF_A_KIND, rank };
    }
    for (const [rank, count] of rankCounts) {
      if (count >= 3) return { type: HandType.THREE_OF_A_KIND, rank };
    }

    let bestPairRank: Rank | null = null;
    for (const [rank, count] of rankCounts) {
      if (count >= 2) {
        if (!bestPairRank || RANK_VALUES[rank] > RANK_VALUES[bestPairRank]) {
          bestPairRank = rank;
        }
      }
    }
    if (bestPairRank) return { type: HandType.PAIR, rank: bestPairRank };

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
   * Simple hand search — only checks HIGH_CARD, PAIR, THREE_OF_A_KIND candidates.
   */
  private static findHandHigherThanSimple(cards: Card[], currentHand: HandCall): HandCall | null {
    const candidates: HandCall[] = [];
    const rankCounts = this.getRankCounts(cards);

    for (const c of cards) {
      candidates.push({ type: HandType.HIGH_CARD, rank: c.rank });
    }
    for (const [rank, count] of rankCounts) {
      if (count >= 2) candidates.push({ type: HandType.PAIR, rank });
    }
    for (const [rank, count] of rankCounts) {
      if (count >= 3) candidates.push({ type: HandType.THREE_OF_A_KIND, rank });
    }

    return this.pickLowestValid(candidates, currentHand);
  }

  // ─── HAND FINDING (FULL — Hard mode) ────────────────────────────────

  /**
   * Find the best hand considering all hand types and what might exist in the full card pool.
   */
  private static findBestHandInCardsFull(cards: Card[], totalCards: number): HandCall | null {
    const rankCounts = this.getRankCounts(cards);
    const suitCounts = this.getSuitCounts(cards);

    // Four of a kind
    for (const [rank, count] of rankCounts) {
      if (count >= 4) return { type: HandType.FOUR_OF_A_KIND, rank };
    }

    // Full house — need 3+2 of different ranks
    const triples: Rank[] = [];
    const pairs: Rank[] = [];
    for (const [rank, count] of rankCounts) {
      if (count >= 3) triples.push(rank);
      else if (count >= 2) pairs.push(rank);
    }
    if (triples.length > 0 && (pairs.length > 0 || triples.length > 1)) {
      const threeRank = triples.sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a])[0];
      const twoRank = pairs.length > 0
        ? pairs.sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a])[0]
        : triples.filter(r => r !== threeRank)[0];
      if (twoRank) return { type: HandType.FULL_HOUSE, threeRank, twoRank };
    }

    // Three of a kind
    if (triples.length > 0) {
      const rank = triples.sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a])[0];
      return { type: HandType.THREE_OF_A_KIND, rank };
    }

    // Flush — check if we have 5 of a suit (unlikely with few cards, but check)
    for (const [suit, count] of suitCounts) {
      if (count >= 5) return { type: HandType.FLUSH, suit };
    }

    // Two pair
    if (pairs.length >= 2 || (pairs.length >= 1 && triples.length >= 1)) {
      const allPairs = [...pairs, ...triples].sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a]);
      return { type: HandType.TWO_PAIR, highRank: allPairs[0], lowRank: allPairs[1] };
    }

    // Pair
    if (pairs.length > 0) {
      const rank = pairs.sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a])[0];
      return { type: HandType.PAIR, rank };
    }

    // High card
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
   * Full hand search — generates candidates across ALL hand types.
   */
  static findHandHigherThan(cards: Card[], currentHand: HandCall): HandCall | null {
    return this.findHandHigherThanFull(cards, currentHand, 10);
  }

  private static findHandHigherThanFull(
    cards: Card[],
    currentHand: HandCall,
    totalCards: number,
  ): HandCall | null {
    const candidates: HandCall[] = [];
    const rankCounts = this.getRankCounts(cards);
    const suitCounts = this.getSuitCounts(cards);

    // High cards
    for (const c of cards) {
      candidates.push({ type: HandType.HIGH_CARD, rank: c.rank });
    }

    // Pairs
    for (const [rank, count] of rankCounts) {
      if (count >= 2) candidates.push({ type: HandType.PAIR, rank });
    }

    // Two pair
    const pairRanks: Rank[] = [];
    for (const [rank, count] of rankCounts) {
      if (count >= 2) pairRanks.push(rank);
    }
    if (pairRanks.length >= 2) {
      pairRanks.sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a]);
      for (let i = 0; i < pairRanks.length; i++) {
        for (let j = i + 1; j < pairRanks.length; j++) {
          candidates.push({
            type: HandType.TWO_PAIR,
            highRank: pairRanks[i],
            lowRank: pairRanks[j],
          });
        }
      }
    }

    // Three of a kind
    for (const [rank, count] of rankCounts) {
      if (count >= 3) candidates.push({ type: HandType.THREE_OF_A_KIND, rank });
    }

    // Flush (if 5+ of same suit)
    for (const [suit, count] of suitCounts) {
      if (count >= 5) candidates.push({ type: HandType.FLUSH, suit });
    }

    // Full house
    const tripleRanks: Rank[] = [];
    const pairableRanks: Rank[] = [];
    for (const [rank, count] of rankCounts) {
      if (count >= 3) tripleRanks.push(rank);
      if (count >= 2) pairableRanks.push(rank);
    }
    for (const tr of tripleRanks) {
      for (const pr of pairableRanks) {
        if (pr !== tr) {
          candidates.push({ type: HandType.FULL_HOUSE, threeRank: tr, twoRank: pr });
        }
      }
    }

    // Four of a kind
    for (const [rank, count] of rankCounts) {
      if (count >= 4) candidates.push({ type: HandType.FOUR_OF_A_KIND, rank });
    }

    return this.pickLowestValid(candidates, currentHand);
  }

  // ─── PLAUSIBILITY (SIMPLE — Easy mode) ──────────────────────────────

  private static estimatePlausibilitySimple(
    hand: HandCall,
    ownCards: Card[],
    totalCards: number,
  ): number {
    switch (hand.type) {
      case HandType.HIGH_CARD: {
        const hasIt = ownCards.some(c => c.rank === hand.rank);
        if (hasIt) return 0.95;
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
   * Public estimatePlausibility for backward compatibility (used by tests).
   */
  static estimatePlausibility(hand: HandCall, ownCards: Card[], totalCards: number): number {
    return this.estimatePlausibilitySimple(hand, ownCards, totalCards);
  }

  // ─── PLAUSIBILITY (HARD MODE) ───────────────────────────────────────

  /**
   * Hypergeometric-approximation plausibility estimation.
   * More accurate probability estimates using number of cards seen vs remaining.
   */
  private static estimatePlausibilityHard(
    hand: HandCall,
    ownCards: Card[],
    totalCards: number,
  ): number {
    const otherCards = totalCards - ownCards.length;
    const deckSize = 52;
    const unseenCards = deckSize - ownCards.length;

    switch (hand.type) {
      case HandType.HIGH_CARD: {
        // 4 copies of the rank in the deck; how many do we have?
        const ownCount = ownCards.filter(c => c.rank === hand.rank).length;
        if (ownCount >= 1) return 0.98;
        const remaining = 4 - ownCount;
        // P(at least 1 among otherCards drawn from unseenCards with `remaining` copies)
        // ≈ 1 - C(unseenCards-remaining, otherCards) / C(unseenCards, otherCards)
        const pNone = this.hypergeomNone(unseenCards, remaining, otherCards);
        return 1 - pNone;
      }

      case HandType.PAIR: {
        const ownCount = ownCards.filter(c => c.rank === hand.rank).length;
        if (ownCount >= 2) return 0.98;
        const remaining = 4 - ownCount;
        const needed = 2 - ownCount;
        return this.hypergeomAtLeast(unseenCards, remaining, otherCards, needed);
      }

      case HandType.TWO_PAIR: {
        if (totalCards < 4) return 0.01;
        const rankCounts = this.getRankCounts(ownCards);
        // Check if we already have the specific two pair called
        const highRank = (hand as { highRank: Rank }).highRank;
        const lowRank = (hand as { lowRank: Rank }).lowRank;
        const highOwn = ownCards.filter(c => c.rank === highRank).length;
        const lowOwn = ownCards.filter(c => c.rank === lowRank).length;
        // P(both pairs exist) = P(>=2 of highRank) × P(>=2 of lowRank)
        const pHigh = highOwn >= 2 ? 0.98 : this.hypergeomAtLeast(unseenCards, 4 - highOwn, otherCards, 2 - highOwn);
        const pLow = lowOwn >= 2 ? 0.98 : this.hypergeomAtLeast(unseenCards, 4 - lowOwn, otherCards, 2 - lowOwn);
        // Not perfectly independent, but a good approximation
        return pHigh * pLow;
      }

      case HandType.THREE_OF_A_KIND: {
        const ownCount = ownCards.filter(c => c.rank === hand.rank).length;
        if (ownCount >= 3) return 0.98;
        const remaining = 4 - ownCount;
        const needed = 3 - ownCount;
        return this.hypergeomAtLeast(unseenCards, remaining, otherCards, needed);
      }

      case HandType.FLUSH: {
        const suit = (hand as { type: HandType.FLUSH; suit: Suit }).suit;
        const ownSuitCount = ownCards.filter(c => c.suit === suit).length;
        if (ownSuitCount >= 5) return 0.95;
        const remaining = 13 - ownSuitCount;
        const needed = 5 - ownSuitCount;
        if (needed <= 0) return 0.95;
        return this.hypergeomAtLeast(unseenCards, remaining, otherCards, needed) * 0.8;
      }

      case HandType.STRAIGHT: {
        // P(straight) ≈ product of P(at least 1 of each required rank)
        // A straight with highRank H needs ranks H, H-1, H-2, H-3, H-4
        if (totalCards < 5) return 0.005;
        const highRank = (hand as { highRank: Rank }).highRank;
        const highVal = RANK_VALUES[highRank];
        // Get the 5 required ranks
        const requiredRanks: Rank[] = [];
        for (let v = highVal - 4; v <= highVal; v++) {
          // Ace-low straight: A-2-3-4-5 (highVal=5, so v starts at 1)
          const actualV = v < 2 ? 14 : v; // Map value 1 to Ace (14)
          const rank = ALL_RANKS.find(r => RANK_VALUES[r] === actualV);
          if (rank) requiredRanks.push(rank);
        }
        if (requiredRanks.length < 5) return 0.005;

        let pStraight = 1;
        for (const rank of requiredRanks) {
          const ownCount = ownCards.filter(c => c.rank === rank).length;
          if (ownCount >= 1) continue; // Already have it, P=1
          const remaining = 4 - ownCount;
          const pNone = this.hypergeomNone(unseenCards, remaining, otherCards);
          pStraight *= (1 - pNone);
        }
        return pStraight;
      }

      case HandType.FULL_HOUSE: {
        if (totalCards < 5) return 0.005;
        // P(full house with threeRank and twoRank) = P(>=3 of threeRank) × P(>=2 of twoRank)
        const threeRank = (hand as { threeRank: Rank }).threeRank;
        const twoRank = (hand as { twoRank: Rank }).twoRank;
        const threeOwn = ownCards.filter(c => c.rank === threeRank).length;
        const twoOwn = ownCards.filter(c => c.rank === twoRank).length;
        const pThree = threeOwn >= 3 ? 0.98 : this.hypergeomAtLeast(unseenCards, 4 - threeOwn, otherCards, 3 - threeOwn);
        const pTwo = twoOwn >= 2 ? 0.98 : this.hypergeomAtLeast(unseenCards, 4 - twoOwn, otherCards, 2 - twoOwn);
        return pThree * pTwo;
      }

      case HandType.FOUR_OF_A_KIND: {
        const ownCount = ownCards.filter(c => c.rank === hand.rank).length;
        if (ownCount >= 4) return 0.98;
        const remaining = 4 - ownCount;
        const needed = 4 - ownCount;
        return this.hypergeomAtLeast(unseenCards, remaining, otherCards, needed);
      }

      case HandType.STRAIGHT_FLUSH: {
        if (totalCards < 5) return 0.001;
        // Need 5 specific cards (rank+suit combos) — each has exactly 1 copy
        const sfSuit = (hand as { suit: Suit }).suit;
        const sfHighRank = (hand as { highRank: Rank }).highRank;
        const sfHighVal = RANK_VALUES[sfHighRank];
        let pSF = 1;
        for (let v = sfHighVal - 4; v <= sfHighVal; v++) {
          const actualV = v < 2 ? 14 : v;
          const rank = ALL_RANKS.find(r => RANK_VALUES[r] === actualV);
          if (!rank) return 0.001;
          const hasIt = ownCards.some(c => c.rank === rank && c.suit === sfSuit);
          if (hasIt) continue;
          // 1 specific card among unseenCards, otherCards drawn
          const pNone = this.hypergeomNone(unseenCards, 1, otherCards);
          pSF *= (1 - pNone);
        }
        return pSF;
      }

      case HandType.ROYAL_FLUSH: {
        if (totalCards < 5) return 0.0005;
        const rfSuit = (hand as { suit: Suit }).suit;
        const royalRanks: Rank[] = ['10', 'J', 'Q', 'K', 'A'];
        let pRF = 1;
        for (const rank of royalRanks) {
          const hasIt = ownCards.some(c => c.rank === rank && c.suit === rfSuit);
          if (hasIt) continue;
          const pNone = this.hypergeomNone(unseenCards, 1, otherCards);
          pRF *= (1 - pNone);
        }
        return pRF;
      }

      default:
        return 0.3;
    }
  }

  // ─── BLUFF GENERATION (EASY) ────────────────────────────────────────

  private static makeBluffHandEasy(currentHand: HandCall | null): HandCall {
    if (!currentHand) {
      const rank = ALL_RANKS[Math.floor(Math.random() * 8) + 5]; // 7 through A
      return { type: HandType.HIGH_CARD, rank };
    }

    if (currentHand.type === HandType.HIGH_CARD) {
      const cr = currentHand as { type: HandType.HIGH_CARD; rank: Rank };
      const nextRankVal = RANK_VALUES[cr.rank] + 1;
      const nextRank = ALL_RANKS.find(r => RANK_VALUES[r] === nextRankVal);
      if (nextRank) return { type: HandType.HIGH_CARD, rank: nextRank };
      return { type: HandType.PAIR, rank: '2' };
    }

    if (currentHand.type === HandType.PAIR) {
      const cr = currentHand as { type: HandType.PAIR; rank: Rank };
      const nextRankVal = RANK_VALUES[cr.rank] + 1;
      const nextRank = ALL_RANKS.find(r => RANK_VALUES[r] === nextRankVal);
      if (nextRank) return { type: HandType.PAIR, rank: nextRank };
      return { type: HandType.THREE_OF_A_KIND, rank: '2' };
    }

    if (currentHand.type < HandType.FLUSH) {
      return { type: HandType.FLUSH, suit: ALL_SUITS[Math.floor(Math.random() * 4)] };
    }
    if (currentHand.type < HandType.STRAIGHT) {
      return { type: HandType.STRAIGHT, highRank: '6' };
    }

    return { type: HandType.HIGH_CARD, rank: 'A' };
  }

  /**
   * Public makeBluffHand for backward compatibility.
   */
  static makeBluffHand(currentHand: HandCall | null): HandCall {
    return this.makeBluffHandEasy(currentHand);
  }

  // ─── BLUFF GENERATION (HARD) ───────────────────────────────────────

  private static makeBluffHandHard(currentHand: HandCall | null, totalCards: number): HandCall {
    if (!currentHand) {
      // Strategic opening: medium-value call that's harder to challenge
      if (totalCards >= 8) {
        // With many total cards, open with a pair (likely to exist)
        const midRanks: Rank[] = ['7', '8', '9', '10', 'J'];
        const rank = midRanks[Math.floor(Math.random() * midRanks.length)];
        return { type: HandType.PAIR, rank };
      }
      const rank = ALL_RANKS[Math.floor(Math.random() * 6) + 7]; // 9 through A
      return { type: HandType.HIGH_CARD, rank };
    }

    // One step above current, varying by hand type
    if (currentHand.type === HandType.HIGH_CARD) {
      const cr = currentHand as { type: HandType.HIGH_CARD; rank: Rank };
      const nextRankVal = RANK_VALUES[cr.rank] + 1;
      const nextRank = ALL_RANKS.find(r => RANK_VALUES[r] === nextRankVal);
      if (nextRank) return { type: HandType.HIGH_CARD, rank: nextRank };
      return { type: HandType.PAIR, rank: '2' };
    }

    if (currentHand.type === HandType.PAIR) {
      const cr = currentHand as { type: HandType.PAIR; rank: Rank };
      const nextRankVal = RANK_VALUES[cr.rank] + 1;
      const nextRank = ALL_RANKS.find(r => RANK_VALUES[r] === nextRankVal);
      if (nextRank) return { type: HandType.PAIR, rank: nextRank };
      // Escalate to two pair if plausible
      if (totalCards >= 6) {
        return { type: HandType.TWO_PAIR, highRank: 'A', lowRank: '2' };
      }
      return { type: HandType.THREE_OF_A_KIND, rank: '2' };
    }

    if (currentHand.type === HandType.TWO_PAIR) {
      return { type: HandType.THREE_OF_A_KIND, rank: '2' };
    }

    if (currentHand.type === HandType.THREE_OF_A_KIND) {
      const cr = currentHand as { type: HandType.THREE_OF_A_KIND; rank: Rank };
      const nextRankVal = RANK_VALUES[cr.rank] + 1;
      const nextRank = ALL_RANKS.find(r => RANK_VALUES[r] === nextRankVal);
      if (nextRank) return { type: HandType.THREE_OF_A_KIND, rank: nextRank };
      // Escalate to flush if enough cards
      if (totalCards >= 8) {
        return { type: HandType.FLUSH, suit: ALL_SUITS[Math.floor(Math.random() * 4)] };
      }
      return { type: HandType.FLUSH, suit: ALL_SUITS[Math.floor(Math.random() * 4)] };
    }

    if (currentHand.type === HandType.FLUSH) {
      // Flushes can't be raised with another flush — escalate to straight
      return { type: HandType.STRAIGHT, highRank: '6' };
    }

    if (currentHand.type === HandType.STRAIGHT) {
      const cr = currentHand as { type: HandType.STRAIGHT; highRank: Rank };
      const nextRankVal = RANK_VALUES[cr.highRank] + 1;
      const nextRank = ALL_RANKS.find(r => RANK_VALUES[r] === nextRankVal);
      if (nextRank) return { type: HandType.STRAIGHT, highRank: nextRank };
      return { type: HandType.FULL_HOUSE, threeRank: '2', twoRank: '3' };
    }

    if (currentHand.type === HandType.FULL_HOUSE) {
      return { type: HandType.FOUR_OF_A_KIND, rank: '2' };
    }

    if (currentHand.type === HandType.FOUR_OF_A_KIND) {
      const cr = currentHand as { type: HandType.FOUR_OF_A_KIND; rank: Rank };
      const nextRankVal = RANK_VALUES[cr.rank] + 1;
      const nextRank = ALL_RANKS.find(r => RANK_VALUES[r] === nextRankVal);
      if (nextRank) return { type: HandType.FOUR_OF_A_KIND, rank: nextRank };
      return { type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '6' };
    }

    // Fallback
    return { type: HandType.HIGH_CARD, rank: 'A' };
  }

  // ─── TURN HISTORY ANALYSIS ──────────────────────────────────────────

  /**
   * Analyze turn history to derive a bias modifier.
   * Returns -1..1 where negative = opponents seem to be bluffing more,
   * positive = opponents seem honest.
   */
  static analyzeTurnHistory(
    turnHistory: { playerId: string; action: TurnAction }[],
    botId: string,
  ): number {
    let bullCount = 0;
    let trueCount = 0;
    let callCount = 0;

    for (const entry of turnHistory) {
      if (entry.playerId === botId) continue;
      if (entry.action === TurnAction.BULL) bullCount++;
      else if (entry.action === TurnAction.TRUE) trueCount++;
      else if (entry.action === TurnAction.CALL) callCount++;
    }

    const totalReactions = bullCount + trueCount;
    if (totalReactions < 2) return 0;

    // If opponents call bull a lot, hands are probably fake → negative bias
    // If opponents call true a lot, hands are probably real → positive bias
    const ratio = trueCount / totalReactions;
    return (ratio - 0.5) * 2; // Maps 0..1 to -1..1
  }

  // ─── UTILITY METHODS ────────────────────────────────────────────────

  private static getTotalCards(state: ClientGameState): number {
    return state.players
      .filter(p => !p.isEliminated)
      .reduce((sum, p) => sum + p.cardCount, 0);
  }

  private static getRankCounts(cards: Card[]): Map<Rank, number> {
    const counts = new Map<Rank, number>();
    for (const c of cards) {
      counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
    }
    return counts;
  }

  private static getSuitCounts(cards: Card[]): Map<Suit, number> {
    const counts = new Map<Suit, number>();
    for (const c of cards) {
      counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);
    }
    return counts;
  }

  private static pickLowestValid(candidates: HandCall[], currentHand: HandCall): HandCall | null {
    const valid = candidates.filter(h => isHigherHand(h, currentHand));
    if (valid.length === 0) return null;

    valid.sort((a, b) => {
      if (a.type !== b.type) return a.type - b.type;
      // Within same type, sort by rank value
      const aRank = this.getHandPrimaryRank(a);
      const bRank = this.getHandPrimaryRank(b);
      return aRank - bRank;
    });
    return valid[0];
  }

  private static getHandPrimaryRank(hand: HandCall): number {
    switch (hand.type) {
      case HandType.HIGH_CARD:
      case HandType.PAIR:
      case HandType.THREE_OF_A_KIND:
      case HandType.FOUR_OF_A_KIND:
        return RANK_VALUES[hand.rank];
      case HandType.TWO_PAIR:
        return RANK_VALUES[hand.highRank] * 100 + RANK_VALUES[hand.lowRank];
      case HandType.FLUSH:
        return SUIT_ORDER[hand.suit];
      case HandType.STRAIGHT:
        return RANK_VALUES[hand.highRank];
      case HandType.FULL_HOUSE:
        return RANK_VALUES[hand.threeRank] * 100 + RANK_VALUES[hand.twoRank];
      case HandType.STRAIGHT_FLUSH:
        return SUIT_ORDER[hand.suit] * 100 + RANK_VALUES[hand.highRank];
      case HandType.ROYAL_FLUSH:
        return SUIT_ORDER[hand.suit];
      default:
        return 0;
    }
  }

  /**
   * Hypergeometric: P(0 successes) when drawing `draw` items from population of
   * `N` items containing `K` successes.
   * Uses logarithmic approximation for numerical stability.
   */
  private static hypergeomNone(N: number, K: number, draw: number): number {
    if (draw <= 0 || K <= 0) return 1;
    if (draw >= N) return K > 0 ? 0 : 1;
    if (K >= N) return 0;

    // P(X=0) = C(N-K, draw) / C(N, draw) = product((N-K-i)/(N-i)) for i=0..draw-1
    let logP = 0;
    const safeN = Math.max(N, 1);
    const safeK = Math.min(K, N);
    const safeDraw = Math.min(draw, N);

    for (let i = 0; i < safeDraw; i++) {
      const num = safeN - safeK - i;
      const den = safeN - i;
      if (den <= 0) return 0;
      if (num <= 0) return 0;
      logP += Math.log(num / den);
    }
    return Math.exp(logP);
  }

  /**
   * P(at least `needed` successes) using complement of cumulative hypergeometric.
   */
  private static hypergeomAtLeast(
    N: number,
    K: number,
    draw: number,
    needed: number,
  ): number {
    if (needed <= 0) return 1;
    if (K < needed) return 0;
    if (draw < needed) return 0;

    // For needed=1, use complement of P(0)
    if (needed === 1) {
      return 1 - this.hypergeomNone(N, K, draw);
    }

    // For needed=2+, approximate using product of conditional probabilities
    let p = 1;
    for (let i = 0; i < needed; i++) {
      const remainingSuccesses = K - i;
      const remainingPool = N - i;
      const remainingDraw = draw - i;
      if (remainingPool <= 0 || remainingDraw <= 0) return 0;
      // P(at least 1 more success in remaining draws from remaining pool)
      const pNone = this.hypergeomNone(remainingPool, remainingSuccesses, remainingDraw);
      p *= (1 - pNone);
    }
    return Math.max(0, Math.min(1, p));
  }
}
