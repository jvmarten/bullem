/**
 * Maps abstract CFR actions to concrete BotActions.
 *
 * Ported from training/src/cfr/actionMapper.ts — evaluation-only subset.
 * TRUTHFUL actions claim hands the player actually has.
 * BLUFF actions claim hands the player doesn't have.
 */

import type { Card, HandCall, ClientGameState, Rank, Suit } from '../types.js';
import { HandType, RoundPhase } from '../types.js';
import { isHigherHand, getMinimumRaise } from '../hands.js';
import { ALL_RANKS, ALL_SUITS, RANK_VALUES } from '../constants.js';
import type { BotAction } from '../engine/BotPlayer.js';
import { HandChecker } from '../engine/HandChecker.js';
import { AbstractAction } from './infoSet.js';

/**
 * Convert an abstract action to a concrete BotAction.
 * Raise/bluff actions always produce a valid result — never returns undefined.
 */
export function mapAbstractToConcreteAction(
  abstractAction: AbstractAction,
  state: ClientGameState,
  myCards: Card[],
): BotAction {
  switch (abstractAction) {
    case AbstractAction.BULL:
      // Sanity check: never call bull on a hand the bot can verify from its own cards.
      // If our cards alone satisfy the called hand, it provably exists — call true instead.
      if (state.currentHand && HandChecker.exists(myCards, state.currentHand)) {
        return { action: 'true' };
      }
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

  // Fallback: minimum raise
  if (currentHand) {
    const minRaise = getMinimumRaise(currentHand);
    if (minRaise) return minRaise;
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

function generateBluffHand(
  magnitude: 'small' | 'mid' | 'big',
  currentHand: HandCall | null,
  myCards: Card[],
): HandCall {
  const myRankSet = new Set(myCards.map(c => c.rank));
  const mySuitSet = new Set(myCards.map(c => c.suit));

  const nonHeldRanks = ALL_RANKS.filter(r => !myRankSet.has(r));
  const bluffRankPool = nonHeldRanks.length > 0 ? nonHeldRanks : ALL_RANKS;

  function pickBluffRank(): Rank {
    return bluffRankPool[Math.floor(Math.random() * bluffRankPool.length)]!;
  }

  const nonHeldSuits = ALL_SUITS.filter(s => !mySuitSet.has(s));
  const suitPool = nonHeldSuits.length > 0 ? nonHeldSuits : ALL_SUITS;
  function pickBluffSuit(): Suit {
    return suitPool[Math.floor(Math.random() * suitPool.length)]!;
  }

  const currentType = currentHand?.type ?? -1;
  const targetOffset = magnitude === 'small' ? 1 : magnitude === 'mid' ? 2 : 3;
  const startType = Math.min(currentType + targetOffset, HandType.ROYAL_FLUSH);

  for (let tryType = startType; tryType <= HandType.ROYAL_FLUSH; tryType++) {
    if (tryType < HandType.HIGH_CARD) continue;
    const hand = generateBluffOfType(tryType as HandType, pickBluffRank, pickBluffSuit);
    if (!currentHand || isHigherHand(hand, currentHand)) {
      return hand;
    }
  }

  // Fallback: minimum raise
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
      const idx = Math.floor(Math.random() * validHighRanks.length);
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
      const idx = Math.floor(Math.random() * validHighRanks.length);
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
