/**
 * 5 Draw CFR strategy evaluation.
 *
 * Uses pre-trained strategy data (embedded in fiveDrawStrategyData.ts)
 * to make decisions for the dealer in the 5 Draw minigame.
 *
 * Unlike the standard Bull 'Em CFR eval which handles multiple player
 * counts and game phases, this is specialized for the 2-player,
 * call-or-pass 5 Draw variant.
 */

import type { Card, HandCall } from '../types.js';
import { isHigherHand, getMinimumRaise } from '../hands.js';
import { ALL_RANKS, ALL_SUITS, RANK_VALUES } from '../constants.js';
import type { Rank, Suit } from '../types.js';
import { HandType } from '../types.js';
import {
  FiveDrawAction,
  getFiveDrawLegalActions,
  getFiveDrawInfoSetKey,
} from './fiveDrawInfoSet.js';
import { FIVE_DRAW_STRATEGY_DATA, type FiveDrawStrategyEntry } from './fiveDrawStrategyData.js';

export interface FiveDrawDecision {
  action: 'call' | 'pass';
  hand?: HandCall;
}

/**
 * Make a CFR-based decision for the 5 Draw dealer.
 *
 * @param dealerCards - The dealer's 5 cards
 * @param currentHand - The current highest call (null if dealer opens)
 * @param turnCount - Number of turns taken so far
 * @param isOpener - Whether the dealer is the opening player
 * @returns A decision: call with a hand, or pass
 */
export function decideFiveDrawCFR(
  dealerCards: Card[],
  currentHand: HandCall | null,
  turnCount: number,
  isOpener: boolean,
): FiveDrawDecision {
  const legalActions = getFiveDrawLegalActions(currentHand);
  if (legalActions.length === 0) {
    return { action: 'pass' };
  }

  const infoSetKey = getFiveDrawInfoSetKey(dealerCards, currentHand, turnCount, isOpener);
  const strategyEntry = FIVE_DRAW_STRATEGY_DATA[infoSetKey];

  let chosenAction: FiveDrawAction;

  if (strategyEntry) {
    // Sample from trained strategy
    let totalProb = 0;
    for (const action of legalActions) {
      totalProb += strategyEntry[action] ?? 0;
    }

    if (totalProb > 0) {
      const r = Math.random() * totalProb;
      let cumulative = 0;
      chosenAction = legalActions[legalActions.length - 1]!;
      for (const action of legalActions) {
        cumulative += strategyEntry[action] ?? 0;
        if (r <= cumulative) {
          chosenAction = action;
          break;
        }
      }
    } else {
      chosenAction = heuristicFallback(legalActions, dealerCards, currentHand);
    }
  } else {
    chosenAction = heuristicFallback(legalActions, dealerCards, currentHand);
  }

  return mapToDecision(chosenAction, currentHand, dealerCards);
}

// ── Heuristic fallback ──────────────────────────────────────────────

/**
 * Conservative fallback when info set is missing from trained strategy.
 * Uses card-aware heuristics specific to 5 Draw.
 */
function heuristicFallback(
  legalActions: FiveDrawAction[],
  myCards: Card[],
  currentHand: HandCall | null,
): FiveDrawAction {
  const weights = new Map<FiveDrawAction, number>();
  for (const action of legalActions) {
    weights.set(action, 1);
  }

  // If we have the hand, prefer truthful claims
  if (hasSupport(myCards, currentHand)) {
    if (legalActions.includes(FiveDrawAction.TRUTHFUL_LOW)) {
      weights.set(FiveDrawAction.TRUTHFUL_LOW, 4);
    }
    if (legalActions.includes(FiveDrawAction.TRUTHFUL_MID)) {
      weights.set(FiveDrawAction.TRUTHFUL_MID, 3);
    }
  } else if (currentHand) {
    // We don't have the hand — lean toward passing
    if (legalActions.includes(FiveDrawAction.PASS)) {
      weights.set(FiveDrawAction.PASS, 5);
    }
    // Small bluff sometimes
    if (legalActions.includes(FiveDrawAction.BLUFF_SMALL)) {
      weights.set(FiveDrawAction.BLUFF_SMALL, 2);
    }
  }

  let totalWeight = 0;
  for (const w of weights.values()) totalWeight += w;
  const r = Math.random() * totalWeight;
  let cumulative = 0;
  for (const action of legalActions) {
    cumulative += weights.get(action) ?? 1;
    if (r <= cumulative) return action;
  }
  return legalActions[legalActions.length - 1]!;
}

function hasSupport(myCards: Card[], currentHand: HandCall | null): boolean {
  if (!currentHand) return true;
  switch (currentHand.type) {
    case HandType.HIGH_CARD:
      return myCards.some(c => RANK_VALUES[c.rank] >= RANK_VALUES[currentHand.rank]);
    case HandType.PAIR:
      return myCards.filter(c => c.rank === currentHand.rank).length >= 1;
    case HandType.FLUSH:
      return myCards.filter(c => c.suit === currentHand.suit).length >= 2;
    default:
      return false;
  }
}

// ── Action mapping ──────────────────────────────────────────────────

function mapToDecision(
  action: FiveDrawAction,
  currentHand: HandCall | null,
  myCards: Card[],
): FiveDrawDecision {
  if (action === FiveDrawAction.PASS) {
    return { action: 'pass' };
  }

  const isTruthful = action === FiveDrawAction.TRUTHFUL_LOW
    || action === FiveDrawAction.TRUTHFUL_MID
    || action === FiveDrawAction.TRUTHFUL_HIGH;

  let hand: HandCall;
  if (isTruthful) {
    const tier = action === FiveDrawAction.TRUTHFUL_LOW ? 'low'
      : action === FiveDrawAction.TRUTHFUL_MID ? 'mid' : 'high';
    hand = generateTruthfulHand(tier, currentHand, myCards);
  } else {
    const magnitude = action === FiveDrawAction.BLUFF_SMALL ? 'small'
      : action === FiveDrawAction.BLUFF_MID ? 'mid' : 'big';
    hand = generateBluffHand(magnitude, currentHand, myCards);
  }

  // Validate the hand is actually higher
  if (currentHand && !isHigherHand(hand, currentHand)) {
    const minRaise = getMinimumRaise(currentHand);
    if (minRaise) {
      return { action: 'call', hand: minRaise };
    }
    return { action: 'pass' };
  }

  return { action: 'call', hand };
}

// ── Truthful hand generation ────────────────────────────────────────

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

  if (currentHand) {
    const minRaise = getMinimumRaise(currentHand);
    if (minRaise) return minRaise;
    return currentHand;
  }

  if (myCards.length > 0) {
    const bestRank = myCards.reduce(
      (best, c) => RANK_VALUES[c.rank] > RANK_VALUES[best] ? c.rank : best,
      myCards[0]!.rank,
    );
    return { type: HandType.HIGH_CARD, rank: bestRank };
  }
  return { type: HandType.HIGH_CARD, rank: '7' };
}

// ── Bluff hand generation ───────────────────────────────────────────

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
      return { type: HandType.STRAIGHT_FLUSH, suit: pickSuit(), highRank: validHighRanks[idx]! };
    }
    case HandType.ROYAL_FLUSH:
      return { type: HandType.ROYAL_FLUSH, suit: pickSuit() };
    default:
      return { type: HandType.HIGH_CARD, rank: '7' };
  }
}
