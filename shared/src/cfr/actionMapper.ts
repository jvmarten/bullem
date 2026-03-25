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
import { AbstractAction, MIN_CARDS_FOR_PLAUSIBLE } from './infoSet.js';

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
 * Get the maximum hand type that is plausible to claim given total cards.
 * Returns the highest HandType where totalCards >= minimum threshold.
 *
 * Uses canonical MIN_CARDS_FOR_PLAUSIBLE from infoSet.ts — shared between
 * training and eval to prevent behavioral mismatch.
 */
function maxPlausibleHandType(totalCards: number): HandType {
  // Walk from highest to lowest type
  for (let t = HandType.ROYAL_FLUSH; t >= HandType.HIGH_CARD; t--) {
    if (totalCards >= (MIN_CARDS_FOR_PLAUSIBLE[t] ?? 999)) {
      return t as HandType;
    }
  }
  return HandType.HIGH_CARD;
}

/**
 * Convert an abstract action to a concrete BotAction.
 * Raise/bluff actions always produce a valid result — never returns undefined.
 *
 * @param totalCards - Total cards across all active players. Used to cap
 *   hand claims at plausible levels (e.g., don't claim two-pair with 7 cards).
 */
export function mapAbstractToConcreteAction(
  abstractAction: AbstractAction,
  state: ClientGameState,
  myCards: Card[],
  totalCards: number = 52,
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
      const maxType = maxPlausibleHandType(totalCards);
      const hand = generateTruthfulHand(tier, state.currentHand, myCards, maxType);
      // null means no meaningful raise available — convert to bull/pass
      if (!hand || hand.type > maxType) {
        if (state.roundPhase === RoundPhase.LAST_CHANCE) {
          return { action: 'lastChancePass' };
        }
        return fallbackToBull(state, myCards);
      }
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
      // null means no meaningful bluff available — convert to bull/pass
      if (!hand || hand.type > maxType) {
        if (state.roundPhase === RoundPhase.LAST_CHANCE) {
          return { action: 'lastChancePass' };
        }
        return fallbackToBull(state, myCards);
      }
      if (state.roundPhase === RoundPhase.LAST_CHANCE) {
        return { action: 'lastChanceRaise', hand };
      }
      return { action: 'call', hand };
    }
  }
}

// ── Bull fallback with safety check ──────────────────────────────────

/**
 * When a raise action can't produce a valid hand, fall back to bull.
 * Applies the same HandChecker safety check as the direct BULL case:
 * if the bot's own cards provably satisfy the current claim, return
 * true instead of bull to avoid self-sabotage.
 */
function fallbackToBull(state: ClientGameState, myCards: Card[]): BotAction {
  if (state.currentHand && HandChecker.exists(myCards, state.currentHand)) {
    return { action: 'true' };
  }
  return { action: 'bull' };
}

// ── Truthful hand generation ─────────────────────────────────────────

function generateTruthfulHand(
  tier: 'low' | 'mid' | 'high',
  currentHand: HandCall | null,
  myCards: Card[],
  maxType: HandType = HandType.ROYAL_FLUSH,
): HandCall | null {
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

  // Filter to valid raises that are within plausibility cap
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

  // No valid candidates beat the current call.
  // Only allow cross-type minimum raises (e.g., Pair of Aces → Two Pair).
  // Same-type minimum raises (e.g., Full House 2s over 4s → 2s over 5s)
  // are degenerate and cause infinite escalation spirals — return null
  // so the caller converts to bull.
  if (currentHand) {
    const minRaise = getMinimumRaise(currentHand);
    if (minRaise && minRaise.type > currentHand.type && minRaise.type <= maxType) {
      return minRaise;
    }
    return null;
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
 * V5: Bluff magnitude is RAISE DISTANCE, not hand type jumps.
 *
 * - small: Same hand type, slightly higher rank. Only jumps type if
 *   no same-type raise exists. "7 high" → "Jack high" not "pair of 5s".
 * - mid: Top of current type or jump one type. "7 high" → "Ace high" or "pair of 5s".
 * - big: Jump 1-2 types aggressively. "7 high" → "pair of Jacks".
 *
 * This fixes the fundamental problem where BLUFF_SMALL forced type jumps,
 * making bots unable to make small incremental bluffs — the most common
 * and natural play in the game.
 */
function generateBluffHand(
  magnitude: 'small' | 'mid' | 'big',
  currentHand: HandCall | null,
  myCards: Card[],
  historyContext?: { mentionedRanks: Set<Rank>; mentionedSuits: Set<Suit> },
  maxType: HandType = HandType.ROYAL_FLUSH,
): HandCall | null {
  const mentionedRanks = historyContext?.mentionedRanks ?? new Set<Rank>();
  const mentionedSuits = historyContext?.mentionedSuits ?? new Set<Suit>();
  const mySuitSet = new Set(myCards.map(c => c.suit));

  // Plausibility-weighted rank selection: mid-high ranks are more believable.
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

  function pickSpacedRank(exclude: Rank): Rank {
    const excludeVal = RANK_VALUES[exclude];
    const spacedWeights = rankWeights.filter(
      ([r]) => Math.abs(RANK_VALUES[r] - excludeVal) >= 2,
    );
    if (spacedWeights.length === 0) {
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

  // ── BLUFF_SMALL: Try same-type raise first, then minimal type jump ──
  if (magnitude === 'small') {
    // First: try same-type raise with a higher rank
    if (currentHand && currentType >= HandType.HIGH_CARD) {
      const sameTypeHand = generateSameTypeBluff(currentHand, pickWeightedRank, pickBluffSuit);
      if (sameTypeHand && isHigherHand(sameTypeHand, currentHand) && sameTypeHand.type <= maxType) {
        return sameTypeHand;
      }
    }
    // Fallback: minimum type jump (+1)
    const nextType = Math.min(currentType + 1, maxType);
    for (let tryType = nextType; tryType <= maxType; tryType++) {
      if (tryType < HandType.HIGH_CARD) continue;
      const hand = generateBluffOfType(tryType as HandType, pickWeightedRank, pickSpacedRank, pickBluffSuit);
      if (!currentHand || isHigherHand(hand, currentHand)) return hand;
    }
  }

  // ── BLUFF_MID: Top of current type or jump one type ──
  if (magnitude === 'mid') {
    // Try a high same-type bluff (pick high rank)
    if (currentHand && currentType >= HandType.HIGH_CARD) {
      const highRankHand = generateHighSameTypeBluff(currentHand, pickBluffSuit);
      if (highRankHand && isHigherHand(highRankHand, currentHand) && highRankHand.type <= maxType) {
        return highRankHand;
      }
    }
    // Then try type+1
    const targetType = Math.min(currentType + 1, maxType);
    for (let tryType = targetType; tryType <= maxType; tryType++) {
      if (tryType < HandType.HIGH_CARD) continue;
      const hand = generateBluffOfType(tryType as HandType, pickWeightedRank, pickSpacedRank, pickBluffSuit);
      if (!currentHand || isHigherHand(hand, currentHand)) return hand;
    }
  }

  // ── BLUFF_BIG: Jump 1-2 types aggressively ──
  if (magnitude === 'big') {
    const targetType = Math.min(currentType + 2, maxType);
    for (let tryType = targetType; tryType <= maxType; tryType++) {
      if (tryType < HandType.HIGH_CARD) continue;
      const hand = generateBluffOfType(tryType as HandType, pickWeightedRank, pickSpacedRank, pickBluffSuit);
      if (!currentHand || isHigherHand(hand, currentHand)) return hand;
    }
    // If target+2 doesn't work, try target+1
    const fallbackType = Math.min(currentType + 1, maxType);
    for (let tryType = fallbackType; tryType < targetType; tryType++) {
      if (tryType < HandType.HIGH_CARD) continue;
      const hand = generateBluffOfType(tryType as HandType, pickWeightedRank, pickSpacedRank, pickBluffSuit);
      if (!currentHand || isHigherHand(hand, currentHand)) return hand;
    }
  }

  // No bluff found — allow cross-type minimum raise only
  if (currentHand) {
    const minRaise = getMinimumRaise(currentHand);
    if (minRaise && minRaise.type > currentHand.type && minRaise.type <= maxType) {
      return minRaise;
    }
    return null;
  }

  return { type: HandType.HIGH_CARD, rank: pickWeightedRank() };
}

/**
 * Generate a same-type bluff with a random higher rank.
 * For HIGH_CARD: pick a random rank higher than current.
 * For PAIR: pick a random rank different from current.
 * For FLUSH: same suit (only one possible).
 * Returns null if no same-type raise is possible.
 */
function generateSameTypeBluff(
  currentHand: HandCall,
  pickRank: () => Rank,
  pickSuit: () => Suit,
): HandCall | null {
  switch (currentHand.type) {
    case HandType.HIGH_CARD: {
      // Pick a rank higher than current — try up to 5 times to get one
      const currentVal = RANK_VALUES[currentHand.rank];
      const higherRanks = ALL_RANKS.filter(r => RANK_VALUES[r] > currentVal);
      if (higherRanks.length === 0) return null;
      // Bias toward mid ranks (not always Ace)
      const idx = Math.floor(Math.random() * higherRanks.length);
      return { type: HandType.HIGH_CARD, rank: higherRanks[idx]! };
    }
    case HandType.PAIR: {
      const currentVal = RANK_VALUES[currentHand.rank];
      const higherRanks = ALL_RANKS.filter(r => RANK_VALUES[r] > currentVal);
      if (higherRanks.length === 0) return null;
      const idx = Math.floor(Math.random() * higherRanks.length);
      return { type: HandType.PAIR, rank: higherRanks[idx]! };
    }
    case HandType.THREE_OF_A_KIND: {
      const currentVal = RANK_VALUES[currentHand.rank];
      const higherRanks = ALL_RANKS.filter(r => RANK_VALUES[r] > currentVal);
      if (higherRanks.length === 0) return null;
      const idx = Math.floor(Math.random() * higherRanks.length);
      return { type: HandType.THREE_OF_A_KIND, rank: higherRanks[idx]! };
    }
    case HandType.FOUR_OF_A_KIND: {
      const currentVal = RANK_VALUES[currentHand.rank];
      const higherRanks = ALL_RANKS.filter(r => RANK_VALUES[r] > currentVal);
      if (higherRanks.length === 0) return null;
      const idx = Math.floor(Math.random() * higherRanks.length);
      return { type: HandType.FOUR_OF_A_KIND, rank: higherRanks[idx]! };
    }
    // FLUSH, TWO_PAIR, STRAIGHT, etc. — harder to do same-type increments
    default:
      return null;
  }
}

/**
 * Generate a high same-type bluff — picks near the top of the current type.
 * Used by BLUFF_MID to claim a strong version of the current hand type
 * before jumping to the next type.
 */
function generateHighSameTypeBluff(
  currentHand: HandCall,
  pickSuit: () => Suit,
): HandCall | null {
  switch (currentHand.type) {
    case HandType.HIGH_CARD: {
      // Claim Ace or King high
      const highRanks: Rank[] = ['A', 'K', 'Q'];
      const valid = highRanks.filter(r => RANK_VALUES[r] > RANK_VALUES[currentHand.rank]);
      if (valid.length === 0) return null;
      return { type: HandType.HIGH_CARD, rank: valid[0]! };
    }
    case HandType.PAIR: {
      const highRanks: Rank[] = ['A', 'K', 'Q'];
      const valid = highRanks.filter(r => RANK_VALUES[r] > RANK_VALUES[currentHand.rank]);
      if (valid.length === 0) return null;
      return { type: HandType.PAIR, rank: valid[0]! };
    }
    case HandType.THREE_OF_A_KIND: {
      const highRanks: Rank[] = ['A', 'K', 'Q'];
      const valid = highRanks.filter(r => RANK_VALUES[r] > RANK_VALUES[currentHand.rank]);
      if (valid.length === 0) return null;
      return { type: HandType.THREE_OF_A_KIND, rank: valid[0]! };
    }
    default:
      return null;
  }
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
      // Pick two independent ranks with spacing. Bias toward mid-high ranks
      // for the three-of-a-kind component — low-rank full houses (2s/3s) are
      // instant tells and were a major observed regression pattern.
      const threeRank = pickRank();
      let twoRank = pickSpacedRank(threeRank);
      // If both ranks are very low (<=5), re-roll the three-rank once to
      // push toward more believable territory.
      if (RANK_VALUES[threeRank] <= 5 && RANK_VALUES[twoRank] <= 5) {
        const reroll = pickRank();
        if (RANK_VALUES[reroll] > RANK_VALUES[threeRank]) {
          return { type: HandType.FULL_HOUSE, threeRank: reroll, twoRank: pickSpacedRank(reroll) };
        }
      }
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
