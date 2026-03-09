/**
 * Maps abstract CFR actions to concrete BotStrategyActions.
 *
 * The key distinction: TRUTHFUL actions try to claim hands the player
 * actually has (or is close to having). BLUFF actions claim hands the
 * player doesn't have. The mapper inspects the player's cards to make
 * this distinction concrete.
 */

import type { Card, HandCall, ClientGameState, Rank, Suit } from '@bull-em/shared';
import { HandType, RoundPhase } from '@bull-em/shared';
import { getMinimumRaise, isHigherHand } from '@bull-em/shared';
import { ALL_RANKS, ALL_SUITS, RANK_VALUES } from '@bull-em/shared';
import type { BotStrategyAction } from '../types.js';
import { AbstractAction } from './infoSet.js';

/**
 * Convert an abstract action to a concrete BotStrategyAction.
 *
 * For TRUTHFUL_* actions, generates hands based on what the player holds.
 * For BLUFF_* actions, generates hands the player doesn't hold.
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

    case AbstractAction.PASS:
      return { action: 'lastChancePass' };

    case AbstractAction.TRUTHFUL_LOW:
    case AbstractAction.TRUTHFUL_MID:
    case AbstractAction.TRUTHFUL_HIGH: {
      const tier = abstractAction === AbstractAction.TRUTHFUL_LOW ? 'low'
        : abstractAction === AbstractAction.TRUTHFUL_MID ? 'mid' : 'high';
      const hand = generateTruthfulHand(tier, state.currentHand, myCards);
      if (!hand) return undefined;
      if (state.roundPhase === RoundPhase.LAST_CHANCE) {
        return { action: 'lastChanceRaise', hand };
      }
      return { action: 'call', hand };
    }

    case AbstractAction.BLUFF_SMALL:
    case AbstractAction.BLUFF_MID:
    case AbstractAction.BLUFF_BIG: {
      const magnitude = abstractAction === AbstractAction.BLUFF_SMALL ? 'small'
        : abstractAction === AbstractAction.BLUFF_MID ? 'mid' : 'big';
      const hand = generateBluffHand(magnitude, state.currentHand, myCards);
      if (!hand) return undefined;
      if (state.roundPhase === RoundPhase.LAST_CHANCE) {
        return { action: 'lastChanceRaise', hand };
      }
      return { action: 'call', hand };
    }
  }
}

// ── Truthful hand generation ─────────────────────────────────────────

/**
 * Generate a hand claim based on cards the player actually holds.
 * Tiers control how ambitious the claim is:
 * - low: claim something very close to what we have (high card, pair we hold)
 * - mid: claim something we partially support (pair from our rank, trips from our pair)
 * - high: claim the strongest hand type we can justify with our cards
 */
function generateTruthfulHand(
  tier: 'low' | 'mid' | 'high',
  currentHand: HandCall | null,
  myCards: Card[],
): HandCall | null {
  if (myCards.length === 0) return null;

  const myRanks = myCards.map(c => c.rank);
  const mySuits = myCards.map(c => c.suit);
  const rankCounts = new Map<Rank, number>();
  const suitCounts = new Map<Suit, number>();

  for (const c of myCards) {
    rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
    suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
  }

  const bestRank = myCards.reduce(
    (best, c) => RANK_VALUES[c.rank] > RANK_VALUES[best] ? c.rank : best,
    myCards[0]!.rank,
  );

  // Find max rank group
  let maxGroupRank = myCards[0]!.rank;
  let maxGroupSize = 1;
  for (const [rank, count] of rankCounts) {
    if (count > maxGroupSize || (count === maxGroupSize && RANK_VALUES[rank] > RANK_VALUES[maxGroupRank])) {
      maxGroupRank = rank;
      maxGroupSize = count;
    }
  }

  // Find dominant suit
  let bestSuit = myCards[0]!.suit;
  let bestSuitCount = 1;
  for (const [suit, count] of suitCounts) {
    if (count > bestSuitCount) {
      bestSuit = suit;
      bestSuitCount = count;
    }
  }

  // Generate candidates based on tier
  const candidates: HandCall[] = [];

  switch (tier) {
    case 'low':
      // High card using our best rank
      candidates.push({ type: HandType.HIGH_CARD, rank: bestRank });
      // If we have a pair, claim it
      if (maxGroupSize >= 2) {
        candidates.push({ type: HandType.PAIR, rank: maxGroupRank });
      }
      // Pair of a rank we hold (claiming there's another out there)
      for (const rank of myRanks) {
        candidates.push({ type: HandType.PAIR, rank });
      }
      break;

    case 'mid':
      // Pair or trips if we have support
      if (maxGroupSize >= 2) {
        candidates.push({ type: HandType.PAIR, rank: maxGroupRank });
        candidates.push({ type: HandType.THREE_OF_A_KIND, rank: maxGroupRank });
      }
      // Two pair using ranks we hold
      if (rankCounts.size >= 2) {
        const ranks = [...rankCounts.keys()].sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a]);
        if (ranks.length >= 2) {
          const [hi, lo] = RANK_VALUES[ranks[0]!] > RANK_VALUES[ranks[1]!]
            ? [ranks[0]!, ranks[1]!]
            : [ranks[1]!, ranks[0]!];
          candidates.push({ type: HandType.TWO_PAIR, highRank: hi, lowRank: lo });
        }
      }
      // Flush if we have suit support
      if (bestSuitCount >= 2) {
        candidates.push({ type: HandType.FLUSH, suit: bestSuit });
      }
      break;

    case 'high':
      // Trips or better if we have support
      if (maxGroupSize >= 2) {
        candidates.push({ type: HandType.THREE_OF_A_KIND, rank: maxGroupRank });
        candidates.push({ type: HandType.FOUR_OF_A_KIND, rank: maxGroupRank });
      }
      if (maxGroupSize >= 3) {
        // Full house: we have trips, pair with something else
        for (const rank of myRanks) {
          if (rank !== maxGroupRank) {
            candidates.push({ type: HandType.FULL_HOUSE, threeRank: maxGroupRank, twoRank: rank });
          }
        }
      }
      // Straight from our best cards
      {
        const vals = [...new Set(myCards.map(c => RANK_VALUES[c.rank]))].sort((a, b) => a - b);
        if (vals.length >= 2) {
          const highVal = Math.min(vals[vals.length - 1]! + 2, 14);
          if (highVal >= 5) {
            const highRank = ALL_RANKS.find(r => RANK_VALUES[r] === highVal);
            if (highRank) {
              candidates.push({ type: HandType.STRAIGHT, highRank });
            }
          }
        }
      }
      break;
  }

  // Filter to only valid raises above current hand
  const valid = currentHand
    ? candidates.filter(h => isHigherHand(h, currentHand))
    : candidates;

  if (valid.length > 0) {
    return valid[Math.floor(Math.random() * valid.length)]!;
  }

  // Fallback: minimum raise if we have any truthful candidate at all
  if (currentHand) {
    const minRaise = getMinimumRaise(currentHand);
    if (minRaise) return minRaise;
  }

  // Opening fallback
  if (!currentHand) {
    return { type: HandType.HIGH_CARD, rank: bestRank };
  }

  return null;
}

// ── Bluff hand generation ────────────────────────────────────────────

/**
 * Generate a hand claim the player does NOT hold.
 * Magnitude controls how far above the current claim:
 * - small: just above current claim, same or next type
 * - mid: 1-2 types above
 * - big: 2+ types above (major bluff)
 */
function generateBluffHand(
  magnitude: 'small' | 'mid' | 'big',
  currentHand: HandCall | null,
  myCards: Card[],
): HandCall | null {
  const myRankSet = new Set(myCards.map(c => c.rank));
  const mySuitSet = new Set(myCards.map(c => c.suit));

  // Pick ranks/suits we DON'T hold (true bluffs)
  function pickBluffRank(): Rank {
    const nonHeldRanks = ALL_RANKS.filter(r => !myRankSet.has(r));
    if (nonHeldRanks.length > 0) {
      return nonHeldRanks[Math.floor(Math.random() * nonHeldRanks.length)]!;
    }
    return ALL_RANKS[Math.floor(Math.random() * ALL_RANKS.length)]!;
  }

  function pickBluffSuit(): typeof ALL_SUITS[number] {
    // For flush bluffs, pick any suit — having 1-2 of a suit doesn't make the flush
    return ALL_SUITS[Math.floor(Math.random() * ALL_SUITS.length)]!;
  }

  const currentType = currentHand?.type ?? -1;

  let targetType: HandType;
  switch (magnitude) {
    case 'small':
      // Same type or next type
      targetType = Math.min(currentType + 1, HandType.ROYAL_FLUSH) as HandType;
      if (targetType < HandType.HIGH_CARD) targetType = HandType.HIGH_CARD;
      break;
    case 'mid':
      // 1-2 types above
      targetType = Math.min(currentType + 1 + Math.floor(Math.random() * 2), HandType.ROYAL_FLUSH) as HandType;
      if (targetType < HandType.PAIR) targetType = HandType.PAIR;
      break;
    case 'big':
      // 2-4 types above
      targetType = Math.min(currentType + 2 + Math.floor(Math.random() * 3), HandType.ROYAL_FLUSH) as HandType;
      if (targetType < HandType.THREE_OF_A_KIND) targetType = HandType.THREE_OF_A_KIND;
      break;
  }

  const hand = generateBluffOfType(targetType, pickBluffRank, pickBluffSuit);

  // Verify it's actually higher
  if (currentHand && !isHigherHand(hand, currentHand)) {
    // Fallback: use minimum raise
    const minRaise = getMinimumRaise(currentHand);
    return minRaise;
  }

  return hand;
}

function generateBluffOfType(
  type: HandType,
  pickRank: () => Rank,
  pickSuit: () => typeof ALL_SUITS[number],
): HandCall {
  switch (type) {
    case HandType.HIGH_CARD:
      return { type: HandType.HIGH_CARD, rank: pickRank() };

    case HandType.PAIR:
      return { type: HandType.PAIR, rank: pickRank() };

    case HandType.TWO_PAIR: {
      let high = pickRank();
      let low = pickRank();
      if (RANK_VALUES[high] <= RANK_VALUES[low]) [high, low] = [low, high];
      if (high === low) {
        const idx = ALL_RANKS.indexOf(high);
        high = idx < ALL_RANKS.length - 1 ? ALL_RANKS[idx + 1]! : ALL_RANKS[idx - 1]!;
        if (RANK_VALUES[high] <= RANK_VALUES[low]) [high, low] = [low, high];
      }
      return { type: HandType.TWO_PAIR, highRank: high, lowRank: low };
    }

    case HandType.FLUSH:
      return { type: HandType.FLUSH, suit: pickSuit() };

    case HandType.THREE_OF_A_KIND:
      return { type: HandType.THREE_OF_A_KIND, rank: pickRank() };

    case HandType.STRAIGHT: {
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
