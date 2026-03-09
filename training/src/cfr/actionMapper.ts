/**
 * Maps abstract CFR actions to concrete BotStrategyActions.
 *
 * The CFR engine works with abstract actions (BULL, RAISE_SAME, etc.)
 * but the game simulator needs concrete HandCall objects. This module
 * bridges that gap.
 */

import type { Card, HandCall, ClientGameState } from '@bull-em/shared';
import { HandType, RoundPhase } from '@bull-em/shared';
import { getMinimumRaise, isHigherHand } from '@bull-em/shared';
import { ALL_RANKS, ALL_SUITS, RANK_VALUES } from '@bull-em/shared';
import type { BotStrategyAction } from '../types.js';
import { AbstractAction } from './infoSet.js';

/**
 * Convert an abstract action to a concrete BotStrategyAction.
 * Uses randomization within the abstract category to avoid being predictable.
 */
export function mapAbstractToConcreteAction(
  abstractAction: AbstractAction,
  state: ClientGameState,
  myCards: Card[],
): BotStrategyAction | undefined {
  switch (abstractAction) {
    case AbstractAction.BULL:
      return { action: 'bull' };

    case AbstractAction.TRUE:
      return { action: 'true' };

    case AbstractAction.LAST_CHANCE_PASS:
      return { action: 'lastChancePass' };

    case AbstractAction.LAST_CHANCE_RAISE: {
      const hand = generateRaise(state.currentHand, 'next', myCards);
      if (!hand) return { action: 'lastChancePass' }; // Can't raise, fallback
      return { action: 'lastChanceRaise', hand };
    }

    case AbstractAction.OPEN_LOW:
      return { action: 'call', hand: generateOpeningHand('low', myCards) };

    case AbstractAction.OPEN_MID:
      return { action: 'call', hand: generateOpeningHand('mid', myCards) };

    case AbstractAction.OPEN_HIGH:
      return { action: 'call', hand: generateOpeningHand('high', myCards) };

    case AbstractAction.RAISE_SAME: {
      const hand = generateRaise(state.currentHand, 'same', myCards);
      if (!hand) return undefined; // Let heuristic fallback handle it
      return { action: 'call', hand };
    }

    case AbstractAction.RAISE_NEXT: {
      const hand = generateRaise(state.currentHand, 'next', myCards);
      if (!hand) return undefined;
      return { action: 'call', hand };
    }

    case AbstractAction.RAISE_BIG: {
      const hand = generateRaise(state.currentHand, 'big', myCards);
      if (!hand) return undefined;
      return { action: 'call', hand };
    }
  }
}

/** Generate an opening hand call at the specified tier. */
function generateOpeningHand(tier: 'low' | 'mid' | 'high', myCards: Card[]): HandCall {
  switch (tier) {
    case 'low': {
      // High card or pair — pick something plausible from our cards
      if (myCards.length > 0) {
        const bestRank = myCards.reduce(
          (best, c) => RANK_VALUES[c.rank] > RANK_VALUES[best] ? c.rank : best,
          myCards[0]!.rank,
        );
        // 50% chance of calling our actual high card, 50% pair of a card we have
        if (Math.random() < 0.5) {
          return { type: HandType.HIGH_CARD, rank: bestRank };
        }
        const pairRank = myCards[Math.floor(Math.random() * myCards.length)]!.rank;
        return { type: HandType.PAIR, rank: pairRank };
      }
      return { type: HandType.HIGH_CARD, rank: '7' };
    }

    case 'mid': {
      // Two pair, flush, three of a kind, or straight
      const midTypes = [HandType.TWO_PAIR, HandType.FLUSH, HandType.THREE_OF_A_KIND, HandType.STRAIGHT];
      const chosen = midTypes[Math.floor(Math.random() * midTypes.length)]!;
      return generateHandOfType(chosen, myCards);
    }

    case 'high': {
      // Full house or above
      const highTypes = [HandType.FULL_HOUSE, HandType.FOUR_OF_A_KIND];
      const chosen = highTypes[Math.floor(Math.random() * highTypes.length)]!;
      return generateHandOfType(chosen, myCards);
    }
  }
}

/** Generate a specific hand type, biased toward cards we actually hold. */
function generateHandOfType(type: HandType, myCards: Card[]): HandCall {
  const myRanks = myCards.map(c => c.rank);
  const mySuits = myCards.map(c => c.suit);

  function pickRank(): typeof ALL_RANKS[number] {
    // Prefer ranks we have, but sometimes bluff
    if (myRanks.length > 0 && Math.random() < 0.6) {
      return myRanks[Math.floor(Math.random() * myRanks.length)]!;
    }
    return ALL_RANKS[Math.floor(Math.random() * ALL_RANKS.length)]!;
  }

  function pickSuit(): typeof ALL_SUITS[number] {
    if (mySuits.length > 0 && Math.random() < 0.6) {
      return mySuits[Math.floor(Math.random() * mySuits.length)]!;
    }
    return ALL_SUITS[Math.floor(Math.random() * ALL_SUITS.length)]!;
  }

  switch (type) {
    case HandType.HIGH_CARD:
      return { type: HandType.HIGH_CARD, rank: pickRank() };

    case HandType.PAIR:
      return { type: HandType.PAIR, rank: pickRank() };

    case HandType.TWO_PAIR: {
      let high = pickRank();
      let low = pickRank();
      // Ensure high > low and they differ
      if (RANK_VALUES[high] <= RANK_VALUES[low]) {
        [high, low] = [low, high];
      }
      if (high === low) {
        // Pick different ranks
        const idx = ALL_RANKS.indexOf(high);
        if (idx < ALL_RANKS.length - 1) {
          high = ALL_RANKS[idx + 1]!;
        } else {
          low = ALL_RANKS[idx - 1]!;
        }
      }
      // Final safety: ensure highRank > lowRank
      if (RANK_VALUES[high] <= RANK_VALUES[low]) {
        [high, low] = [low, high];
      }
      return { type: HandType.TWO_PAIR, highRank: high, lowRank: low };
    }

    case HandType.FLUSH:
      return { type: HandType.FLUSH, suit: pickSuit() };

    case HandType.THREE_OF_A_KIND:
      return { type: HandType.THREE_OF_A_KIND, rank: pickRank() };

    case HandType.STRAIGHT: {
      // Valid highRank: 5 through A (rank value 5-14)
      const validHighRanks = ALL_RANKS.filter(r => RANK_VALUES[r] >= 5);
      return { type: HandType.STRAIGHT, highRank: validHighRanks[Math.floor(Math.random() * validHighRanks.length)]! };
    }

    case HandType.FULL_HOUSE: {
      let threeRank = pickRank();
      let twoRank = pickRank();
      if (threeRank === twoRank) {
        const idx = ALL_RANKS.indexOf(threeRank);
        twoRank = idx > 0 ? ALL_RANKS[idx - 1]! : ALL_RANKS[idx + 1]!;
      }
      return { type: HandType.FULL_HOUSE, threeRank, twoRank };
    }

    case HandType.FOUR_OF_A_KIND:
      return { type: HandType.FOUR_OF_A_KIND, rank: pickRank() };

    case HandType.STRAIGHT_FLUSH: {
      const validHighRanks = ALL_RANKS.filter(r => RANK_VALUES[r] >= 5 && r !== 'A');
      return {
        type: HandType.STRAIGHT_FLUSH,
        suit: pickSuit(),
        highRank: validHighRanks[Math.floor(Math.random() * validHighRanks.length)]!,
      };
    }

    case HandType.ROYAL_FLUSH:
      return { type: HandType.ROYAL_FLUSH, suit: pickSuit() };

    default:
      return { type: HandType.HIGH_CARD, rank: '7' };
  }
}

/**
 * Generate a raise relative to the current hand.
 * - 'same': raise within the same hand type (e.g., pair of 7s → pair of 9s)
 * - 'next': raise to the next hand type category
 * - 'big': raise 2+ categories above
 */
function generateRaise(
  currentHand: HandCall | null,
  magnitude: 'same' | 'next' | 'big',
  myCards: Card[],
): HandCall | null {
  if (!currentHand) return null;

  const minRaise = getMinimumRaise(currentHand);
  if (!minRaise) return null; // Current hand is royal flush — can't raise

  switch (magnitude) {
    case 'same': {
      // Stay in the same hand type if possible
      if (minRaise.type === currentHand.type) {
        return minRaise;
      }
      // Min raise already jumped type — just use it
      return minRaise;
    }

    case 'next': {
      // Jump to next hand type
      const targetType = currentHand.type + 1;
      if (targetType > HandType.ROYAL_FLUSH) return null;
      const hand = generateHandOfType(targetType as HandType, myCards);
      // Verify it's actually higher
      if (isHigherHand(hand, currentHand)) return hand;
      // Fallback to minimum raise
      return minRaise;
    }

    case 'big': {
      // Jump 2+ types
      const targetType = Math.min(currentHand.type + 2 + Math.floor(Math.random() * 2), HandType.ROYAL_FLUSH);
      const hand = generateHandOfType(targetType as HandType, myCards);
      if (isHigherHand(hand, currentHand)) return hand;
      // Fallback
      const nextType = currentHand.type + 2;
      if (nextType <= HandType.ROYAL_FLUSH) {
        const fallback = generateHandOfType(nextType as HandType, myCards);
        if (isHigherHand(fallback, currentHand)) return fallback;
      }
      return minRaise;
    }
  }
}
