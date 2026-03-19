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
/**
 * Extract ranks and suits mentioned in the turn history.
 * Used to generate more believable bluffs by "continuing the narrative"
 * of what other players have claimed.
 */
function extractHistoryContext(state: ClientGameState): { mentionedRanks: Set<Rank>; mentionedSuits: Set<Suit> } {
  const mentionedRanks = new Set<Rank>();
  const mentionedSuits = new Set<Suit>();
  for (const entry of state.turnHistory) {
    if (!entry.hand) continue;
    const h = entry.hand;
    if ('rank' in h && h.rank) mentionedRanks.add(h.rank as Rank);
    if ('highRank' in h && h.highRank) mentionedRanks.add(h.highRank as Rank);
    if ('lowRank' in h && h.lowRank) mentionedRanks.add(h.lowRank as Rank);
    if ('threeRank' in h && h.threeRank) mentionedRanks.add(h.threeRank as Rank);
    if ('twoRank' in h && h.twoRank) mentionedRanks.add(h.twoRank as Rank);
    if ('suit' in h && h.suit) mentionedSuits.add(h.suit as Suit);
  }
  return { mentionedRanks, mentionedSuits };
}

// ── Plausibility capping ──────────────────────────────────────────────

/**
 * Minimum total cards needed for each hand type to be plausible as a claim.
 * Mirrors shared/src/cfr/actionMapper.ts thresholds.
 */
const MIN_CARDS_FOR_PLAUSIBLE_CLAIM: Record<number, number> = {
  [HandType.HIGH_CARD]: 1,
  [HandType.PAIR]: 3,
  [HandType.TWO_PAIR]: 8,
  [HandType.FLUSH]: 10,
  [HandType.THREE_OF_A_KIND]: 8,
  [HandType.STRAIGHT]: 12,
  [HandType.FULL_HOUSE]: 14,
  [HandType.FOUR_OF_A_KIND]: 18,
  [HandType.STRAIGHT_FLUSH]: 22,
  [HandType.ROYAL_FLUSH]: 26,
};

function maxPlausibleHandType(totalCards: number): HandType {
  for (let t = HandType.ROYAL_FLUSH; t >= HandType.HIGH_CARD; t--) {
    if (totalCards >= (MIN_CARDS_FOR_PLAUSIBLE_CLAIM[t] ?? 999)) {
      return t as HandType;
    }
  }
  return HandType.HIGH_CARD;
}

export function mapAbstractToConcreteAction(
  abstractAction: AbstractAction,
  state: ClientGameState,
  myCards: Card[],
  totalCards: number = 52,
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
      const maxType = maxPlausibleHandType(totalCards);
      const hand = generateTruthfulHand(tier, state.currentHand, myCards, maxType);
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
      const context = extractHistoryContext(state);
      const maxType = maxPlausibleHandType(totalCards);
      const hand = generateBluffHand(magnitude, state.currentHand, myCards, context, maxType);
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
  maxType: HandType = HandType.ROYAL_FLUSH,
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

  // Filter to valid raises within plausibility cap
  const plausible = candidates.filter(h => h.type <= maxType);
  const valid = currentHand
    ? plausible.filter(h => isHigherHand(h, currentHand))
    : plausible;

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

  // Fallback: minimum raise, capped at plausible types
  if (currentHand) {
    const minRaise = getMinimumRaise(currentHand);
    if (minRaise && minRaise.type <= maxType) return minRaise;
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

/**
 * Generate a hand claim the player does NOT hold.
 * Always returns a valid hand — falls back to minimum raise.
 *
 * Magnitude controls how far above the current claim:
 * - small: same type or next type (conservative bluff)
 * - mid: 1-2 types above
 * - big: 2+ types above (major bluff)
 *
 * Rank/suit selection uses plausibility-weighted randomness:
 * - Mid-high ranks (6-A) are preferred over low ranks (2-5) since
 *   claims like "pair of 2s" are unusual and suspicious
 * - Two-pair and full-house pick two INDEPENDENT ranks with spacing,
 *   avoiding the adjacent-rank pattern (e.g., "3s and 2s") that is
 *   an instant tell for experienced players
 */
function generateBluffHand(
  magnitude: 'small' | 'mid' | 'big',
  currentHand: HandCall | null,
  myCards: Card[],
  historyContext?: { mentionedRanks: Set<Rank>; mentionedSuits: Set<Suit> },
  maxType: HandType = HandType.ROYAL_FLUSH,
): HandCall {
  const mySuitSet = new Set(myCards.map(c => c.suit));
  const mentionedRanks = historyContext?.mentionedRanks ?? new Set<Rank>();
  const mentionedSuits = historyContext?.mentionedSuits ?? new Set<Suit>();

  // Plausibility-weighted rank selection: mid-high ranks are more believable.
  // Weights: 2-5 get weight 1, 6-9 get weight 3, 10-A get weight 4.
  // Ranks mentioned in previous calls get a 2x boost — "continuing the
  // narrative" of what others claimed makes the bluff more believable.
  const rankWeights: [Rank, number][] = ALL_RANKS.map(r => {
    const val = RANK_VALUES[r];
    let weight: number;
    if (val <= 5) weight = 1;
    else if (val <= 9) weight = 3;
    else weight = 4;
    if (mentionedRanks.has(r)) weight *= 2;
    return [r, weight];
  });
  const totalRankWeight = rankWeights.reduce((s, [, w]) => s + w, 0);

  function pickWeightedRank(): Rank {
    const roll = Math.random() * totalRankWeight;
    let cumulative = 0;
    for (const [rank, weight] of rankWeights) {
      cumulative += weight;
      if (roll <= cumulative) return rank;
    }
    return rankWeights[rankWeights.length - 1]![0];
  }

  /** Pick a rank that is different from `exclude` and at least 2 apart in value. */
  function pickSpacedRank(exclude: Rank): Rank {
    const excludeVal = RANK_VALUES[exclude];
    const spacedWeights = rankWeights.filter(
      ([r]) => Math.abs(RANK_VALUES[r] - excludeVal) >= 2,
    );
    if (spacedWeights.length === 0) {
      // Fallback: just pick any different rank
      const diff = ALL_RANKS.filter(r => r !== exclude);
      return diff[Math.floor(Math.random() * diff.length)]!;
    }
    const totalW = spacedWeights.reduce((s, [, w]) => s + w, 0);
    const roll = Math.random() * totalW;
    let cumulative = 0;
    for (const [rank, weight] of spacedWeights) {
      cumulative += weight;
      if (roll <= cumulative) return rank;
    }
    return spacedWeights[spacedWeights.length - 1]![0];
  }

  // Suit selection: prefer suits mentioned in call history (more believable),
  // then non-held suits, then any suit.
  const suitWeights: [Suit, number][] = ALL_SUITS.map(s => {
    let weight = 1;
    if (mentionedSuits.has(s)) weight += 3;
    if (!mySuitSet.has(s)) weight += 1;
    return [s, weight];
  });
  const totalSuitWeight = suitWeights.reduce((s, [, w]) => s + w, 0);
  function pickBluffSuit(): Suit {
    const roll = Math.random() * totalSuitWeight;
    let cumulative = 0;
    for (const [suit, weight] of suitWeights) {
      cumulative += weight;
      if (roll <= cumulative) return suit;
    }
    return suitWeights[suitWeights.length - 1]![0];
  }

  const currentType = currentHand?.type ?? -1;

  // Try progressively from target type, capped at plausible maximum
  const targetOffset = magnitude === 'small' ? 1 : magnitude === 'mid' ? 2 : 3;
  const startType = Math.min(currentType + targetOffset, maxType);

  // Scan from target up to maxType (not beyond — implausible types are banned)
  for (let tryType = startType; tryType <= maxType; tryType++) {
    if (tryType < HandType.HIGH_CARD) continue;
    const hand = generateBluffOfType(
      tryType as HandType, pickWeightedRank, pickSpacedRank, pickBluffSuit,
    );
    if (!currentHand || isHigherHand(hand, currentHand)) {
      return hand;
    }
  }

  // Fallback: minimum raise, capped at plausible types
  if (currentHand) {
    const minRaise = getMinimumRaise(currentHand);
    if (minRaise && minRaise.type <= maxType) return minRaise;
    if (minRaise) return minRaise;
    return currentHand;
  }

  return { type: HandType.HIGH_CARD, rank: pickWeightedRank() };
}

function generateBluffOfType(
  type: HandType,
  pickRank: () => Rank,
  pickSpacedRank: (exclude: Rank) => Rank,
  pickSuit: () => Suit,
): HandCall {
  switch (type) {
    case HandType.HIGH_CARD:
      return { type: HandType.HIGH_CARD, rank: pickRank() };

    case HandType.PAIR:
      return { type: HandType.PAIR, rank: pickRank() };

    case HandType.TWO_PAIR: {
      // Pick two independent ranks with spacing — avoids the adjacent-rank
      // pattern (e.g. "3s and 2s") that is an instant tell.
      const first = pickRank();
      const second = pickSpacedRank(first);
      const [hi, lo] = RANK_VALUES[first] > RANK_VALUES[second]
        ? [first, second] : [second, first];
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
      // Pick two independent ranks with spacing — same rationale as two-pair.
      const threeRank = pickRank();
      const twoRank = pickSpacedRank(threeRank);
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
