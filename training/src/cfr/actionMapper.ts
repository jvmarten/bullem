/**
 * Maps abstract CFR actions to concrete BotStrategyActions.
 *
 * The key distinction: TRUTHFUL actions try to claim hands the player
 * actually has (or is close to having). BLUFF actions claim hands the
 * player doesn't have. The mapper inspects the player's cards to make
 * this distinction concrete.
 *
 * Design guarantees:
 * - mapAbstractToConcreteAction NEVER returns undefined for raise/bluff actions.
 *   If the preferred hand can't be generated, it falls back to minimum raise.
 * - Bluff generation uses varied rank/suit selection based on cards held,
 *   avoiding predictable patterns while remaining deterministic per-state.
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
 *
 * Raise/bluff actions always produce a valid result — never returns undefined
 * for actions that require a hand claim.
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
 * Always returns a valid hand — falls back to minimum raise if no
 * tier-appropriate candidate beats the current claim.
 */
function generateTruthfulHand(
  tier: 'low' | 'mid' | 'high',
  currentHand: HandCall | null,
  myCards: Card[],
): HandCall {
  const candidates: HandCall[] = [];

  if (myCards.length > 0) {
    const myRanks = myCards.map(c => c.rank);
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

    let maxGroupRank = myCards[0]!.rank;
    let maxGroupSize = 1;
    for (const [rank, count] of rankCounts) {
      if (count > maxGroupSize || (count === maxGroupSize && RANK_VALUES[rank] > RANK_VALUES[maxGroupRank])) {
        maxGroupRank = rank;
        maxGroupSize = count;
      }
    }

    let bestSuit = myCards[0]!.suit;
    let bestSuitCount = 1;
    for (const [suit, count] of suitCounts) {
      if (count > bestSuitCount) {
        bestSuit = suit;
        bestSuitCount = count;
      }
    }

    switch (tier) {
      case 'low':
        candidates.push({ type: HandType.HIGH_CARD, rank: bestRank });
        if (maxGroupSize >= 2) {
          candidates.push({ type: HandType.PAIR, rank: maxGroupRank });
        }
        for (const rank of myRanks) {
          candidates.push({ type: HandType.PAIR, rank });
        }
        break;

      case 'mid':
        if (maxGroupSize >= 2) {
          candidates.push({ type: HandType.PAIR, rank: maxGroupRank });
          candidates.push({ type: HandType.THREE_OF_A_KIND, rank: maxGroupRank });
        }
        if (rankCounts.size >= 2) {
          const ranks = [...rankCounts.keys()].sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a]);
          if (ranks.length >= 2) {
            const [hi, lo] = RANK_VALUES[ranks[0]!] > RANK_VALUES[ranks[1]!]
              ? [ranks[0]!, ranks[1]!]
              : [ranks[1]!, ranks[0]!];
            candidates.push({ type: HandType.TWO_PAIR, highRank: hi, lowRank: lo });
          }
        }
        if (bestSuitCount >= 2) {
          candidates.push({ type: HandType.FLUSH, suit: bestSuit });
        }
        // Also include low-tier candidates as fallback
        candidates.push({ type: HandType.HIGH_CARD, rank: bestRank });
        for (const rank of myRanks) {
          candidates.push({ type: HandType.PAIR, rank });
        }
        break;

      case 'high':
        if (maxGroupSize >= 2) {
          candidates.push({ type: HandType.THREE_OF_A_KIND, rank: maxGroupRank });
          candidates.push({ type: HandType.FOUR_OF_A_KIND, rank: maxGroupRank });
        }
        if (maxGroupSize >= 3) {
          for (const rank of myRanks) {
            if (rank !== maxGroupRank) {
              candidates.push({ type: HandType.FULL_HOUSE, threeRank: maxGroupRank, twoRank: rank });
            }
          }
        }
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
        // Also include mid/low-tier candidates as fallback
        if (maxGroupSize >= 2) {
          candidates.push({ type: HandType.PAIR, rank: maxGroupRank });
        }
        for (const rank of myRanks) {
          candidates.push({ type: HandType.PAIR, rank });
        }
        break;
    }
  }

  // Filter to valid raises
  const valid = currentHand
    ? candidates.filter(h => isHigherHand(h, currentHand))
    : candidates;

  if (valid.length > 0) {
    valid.sort((a, b) => {
      if (a.type !== b.type) return a.type - b.type;
      const aRank = 'rank' in a ? RANK_VALUES[a.rank as Rank] : ('highRank' in a ? RANK_VALUES[a.highRank as Rank] : 0);
      const bRank = 'rank' in b ? RANK_VALUES[b.rank as Rank] : ('highRank' in b ? RANK_VALUES[b.highRank as Rank] : 0);
      return aRank - bRank;
    });
    const idx = tier === 'low' ? 0 : tier === 'mid' ? Math.floor(valid.length / 2) : valid.length - 1;
    return valid[idx]!;
  }

  // Fallback: minimum raise (null only for royal flush — nothing higher exists)
  if (currentHand) {
    const minRaise = getMinimumRaise(currentHand);
    if (minRaise) return minRaise;
    // Royal flush is the highest possible — no valid raise exists.
    // Return the royal flush itself; the engine will reject it as
    // "not higher" but this is an unwinnable state anyway.
    return currentHand;
  }

  // Opening: high card with best rank, or fallback to 7
  if (myCards.length > 0) {
    const bestRank = myCards.reduce(
      (best, c) => RANK_VALUES[c.rank] > RANK_VALUES[best] ? c.rank : best,
      myCards[0]!.rank,
    );
    return { type: HandType.HIGH_CARD, rank: bestRank };
  }
  return { type: HandType.HIGH_CARD, rank: '7' };
}

// ── Bluff hand generation ────────────────────────────────────────────

/**
 * Derive a deterministic-per-state seed from the player's cards.
 * Varies bluff choices based on what we hold without adding randomness.
 */
function cardBasedSeed(myCards: Card[]): number {
  let hash = 0;
  for (const c of myCards) {
    hash = (hash * 31 + RANK_VALUES[c.rank] * 4 + ALL_SUITS.indexOf(c.suit)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Generate a hand claim the player does NOT hold.
 * Always returns a valid hand — falls back to minimum raise.
 *
 * Magnitude controls how far above the current claim:
 * - small: same type or next type (conservative bluff)
 * - mid: 1-2 types above
 * - big: 2+ types above (major bluff)
 *
 * Rank/suit selection varies based on held cards to avoid
 * predictable bluff patterns while staying deterministic per-state.
 */
function generateBluffHand(
  magnitude: 'small' | 'mid' | 'big',
  currentHand: HandCall | null,
  myCards: Card[],
): HandCall {
  const myRankSet = new Set(myCards.map(c => c.rank));
  const mySuitSet = new Set(myCards.map(c => c.suit));
  const seed = cardBasedSeed(myCards);

  const nonHeldRanks = ALL_RANKS.filter(r => !myRankSet.has(r));
  const bluffRankPool = nonHeldRanks.length > 0 ? nonHeldRanks : ALL_RANKS;

  // Vary rank selection based on card-derived seed + magnitude offset
  const magnitudeOffset = magnitude === 'small' ? 0 : magnitude === 'mid' ? 3 : 7;
  function pickBluffRank(): Rank {
    const idx = (seed + magnitudeOffset) % bluffRankPool.length;
    return bluffRankPool[idx]!;
  }

  // Vary suit selection — prefer suits we don't hold
  const nonHeldSuits = ALL_SUITS.filter(s => !mySuitSet.has(s));
  const suitPool = nonHeldSuits.length > 0 ? nonHeldSuits : ALL_SUITS;
  function pickBluffSuit(): Suit {
    return suitPool[seed % suitPool.length]!;
  }

  const currentType = currentHand?.type ?? -1;

  // Try progressively from target type down to find a valid bluff
  const targetOffset = magnitude === 'small' ? 1 : magnitude === 'mid' ? 2 : 3;
  const startType = Math.min(currentType + targetOffset, HandType.ROYAL_FLUSH);

  // Try target type, then scan upward for a valid hand
  for (let tryType = startType; tryType <= HandType.ROYAL_FLUSH; tryType++) {
    if (tryType < HandType.HIGH_CARD) continue;
    const hand = generateBluffOfType(tryType as HandType, pickBluffRank, pickBluffSuit);
    if (!currentHand || isHigherHand(hand, currentHand)) {
      return hand;
    }
  }

  // Fallback: minimum raise (null only for royal flush)
  if (currentHand) {
    const minRaise = getMinimumRaise(currentHand);
    if (minRaise) return minRaise;
    return currentHand;
  }

  return { type: HandType.HIGH_CARD, rank: pickBluffRank() };
}

function generateBluffOfType(
  type: HandType,
  pickRank: () => Rank,
  pickSuit: () => Suit,
): HandCall {
  switch (type) {
    case HandType.HIGH_CARD:
      return { type: HandType.HIGH_CARD, rank: pickRank() };

    case HandType.PAIR:
      return { type: HandType.PAIR, rank: pickRank() };

    case HandType.TWO_PAIR: {
      const high = pickRank();
      const highIdx = ALL_RANKS.indexOf(high);
      const low = highIdx > 0 ? ALL_RANKS[highIdx - 1]! : ALL_RANKS[highIdx + 1]!;
      const [hi, lo] = RANK_VALUES[high] > RANK_VALUES[low] ? [high, low] : [low, high];
      return { type: HandType.TWO_PAIR, highRank: hi, lowRank: lo };
    }

    case HandType.FLUSH:
      return { type: HandType.FLUSH, suit: pickSuit() };

    case HandType.THREE_OF_A_KIND:
      return { type: HandType.THREE_OF_A_KIND, rank: pickRank() };

    case HandType.STRAIGHT: {
      const validHighRanks = ALL_RANKS.filter(r => RANK_VALUES[r] >= 5);
      const idx = Math.floor(validHighRanks.length / 2);
      return { type: HandType.STRAIGHT, highRank: validHighRanks[idx]! };
    }

    case HandType.FULL_HOUSE: {
      const threeRank = pickRank();
      const threeIdx = ALL_RANKS.indexOf(threeRank);
      const twoRank = threeIdx > 0 ? ALL_RANKS[threeIdx - 1]! : ALL_RANKS[threeIdx + 1]!;
      return { type: HandType.FULL_HOUSE, threeRank, twoRank };
    }

    case HandType.FOUR_OF_A_KIND:
      return { type: HandType.FOUR_OF_A_KIND, rank: pickRank() };

    case HandType.STRAIGHT_FLUSH: {
      const validHighRanks = ALL_RANKS.filter(r => RANK_VALUES[r] >= 5 && r !== 'A');
      const idx = Math.floor(validHighRanks.length / 2);
      return {
        type: HandType.STRAIGHT_FLUSH,
        suit: pickSuit(),
        highRank: validHighRanks[idx]!,
      };
    }

    case HandType.ROYAL_FLUSH:
      return { type: HandType.ROYAL_FLUSH, suit: pickSuit() };

    default:
      return { type: HandType.HIGH_CARD, rank: '7' };
  }
}
