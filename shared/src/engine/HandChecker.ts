import { RANK_VALUES } from '../constants.js';
import type { Card, HandCall, OwnedCard, Rank, Suit } from '../types.js';
import { HandType } from '../types.js';

/** Reverse mapping from rank numeric value to Rank string.
 *  Pre-computed once at module load for O(1) lookups in getStraightRanks(). */
const VALUE_TO_RANK = new Map<number, Rank>(
  Object.entries(RANK_VALUES).map(([rank, val]) => [val, rank as Rank])
);

/** Separate a card pool into non-joker cards and a joker count. */
function splitJokers(cards: Card[]): { normal: Card[]; jokers: number } {
  let jokers = 0;
  const normal: Card[] = [];
  for (const c of cards) {
    if (c.isJoker) jokers++;
    else normal.push(c);
  }
  return { normal, jokers };
}

/**
 * Pure static methods for checking whether poker hands exist in a pool of cards.
 *
 * Used during round resolution to determine if the called hand can actually be
 * formed from all players' combined cards. Also provides card-finding methods
 * for the reveal overlay (showing which cards formed or disproved the hand).
 *
 * Joker support: cards with `isJoker: true` act as wildcards — they can
 * substitute for any missing card when checking hand existence.
 */
export class HandChecker {
  /** Returns true if the called hand can be formed from the given cards. */
  static exists(allCards: Card[], hand: HandCall): boolean {
    const { normal, jokers } = splitJokers(allCards);

    switch (hand.type) {
      case HandType.HIGH_CARD:
        // A joker can always be a high card
        return jokers > 0 || normal.some(c => c.rank === hand.rank);

      case HandType.PAIR:
        return countByRank(normal, hand.rank) + jokers >= 2;

      case HandType.TWO_PAIR: {
        if (hand.highRank === hand.lowRank) return false;
        const highCount = countByRank(normal, hand.highRank);
        const lowCount = countByRank(normal, hand.lowRank);
        const highNeed = Math.max(0, 2 - highCount);
        const lowNeed = Math.max(0, 2 - lowCount);
        return highNeed + lowNeed <= jokers;
      }

      case HandType.THREE_OF_A_KIND:
        return countByRank(normal, hand.rank) + jokers >= 3;

      case HandType.FLUSH:
        return countBySuit(normal, hand.suit) + jokers >= 5;

      case HandType.STRAIGHT:
        return hasStraight(normal, hand.highRank, jokers);

      case HandType.FULL_HOUSE: {
        if (hand.threeRank === hand.twoRank) return false;
        const threeCount = countByRank(normal, hand.threeRank);
        const twoCount = countByRank(normal, hand.twoRank);
        const threeNeed = Math.max(0, 3 - threeCount);
        const twoNeed = Math.max(0, 2 - twoCount);
        return threeNeed + twoNeed <= jokers;
      }

      case HandType.FOUR_OF_A_KIND:
        return countByRank(normal, hand.rank) + jokers >= 4;

      case HandType.STRAIGHT_FLUSH:
        return hasStraightFlush(normal, hand.suit, hand.highRank, jokers);

      case HandType.ROYAL_FLUSH:
        return hasStraightFlush(normal, hand.suit, 'A' as Rank, jokers);
    }
  }

  /** Returns a minimal set of cards forming the hand, or null if the hand doesn't exist. */
  static findMatchingCards(allCards: Card[], hand: HandCall): Card[] | null {
    if (!this.exists(allCards, hand)) return null;

    const jokerCards = allCards.filter(c => c.isJoker);
    const normal = allCards.filter(c => !c.isJoker);

    switch (hand.type) {
      case HandType.HIGH_CARD: {
        const match = normal.find(c => c.rank === hand.rank);
        return match ? [match] : [jokerCards[0]!];
      }

      case HandType.PAIR:
        return pickWithJokers(normal, jokerCards, c => c.rank === hand.rank, 2);

      case HandType.TWO_PAIR: {
        const highPick = pickWithJokers(normal, jokerCards, c => c.rank === hand.highRank, 2);
        if (!highPick) return null;
        const usedJokers = highPick.filter(c => c.isJoker).length;
        const remainingJokers = jokerCards.slice(usedJokers);
        const lowPick = pickWithJokers(normal, remainingJokers, c => c.rank === hand.lowRank, 2);
        if (!lowPick) return null;
        return [...highPick, ...lowPick];
      }

      case HandType.THREE_OF_A_KIND:
        return pickWithJokers(normal, jokerCards, c => c.rank === hand.rank, 3);

      case HandType.FLUSH:
        return pickWithJokers(normal, jokerCards, c => c.suit === hand.suit, 5);

      case HandType.STRAIGHT:
        return findStraightCards(normal, jokerCards, hand.highRank);

      case HandType.FULL_HOUSE: {
        const threePick = pickWithJokers(normal, jokerCards, c => c.rank === hand.threeRank, 3);
        if (!threePick) return null;
        const usedJokers = threePick.filter(c => c.isJoker).length;
        const remainingJokers = jokerCards.slice(usedJokers);
        const twoPick = pickWithJokers(normal, remainingJokers, c => c.rank === hand.twoRank, 2);
        if (!twoPick) return null;
        return [...threePick, ...twoPick];
      }

      case HandType.FOUR_OF_A_KIND:
        return pickWithJokers(normal, jokerCards, c => c.rank === hand.rank, 4);

      case HandType.STRAIGHT_FLUSH:
        return findStraightFlushCards(normal, jokerCards, hand.suit, hand.highRank);

      case HandType.ROYAL_FLUSH:
        return findStraightFlushCards(normal, jokerCards, hand.suit, 'A' as Rank);
    }
  }

  /** Returns ALL cards relevant to the hand (not just a minimal set) — used for the reveal overlay.
   *  Jokers are always included since they are relevant to any hand they help form. */
  static findAllRelevantCards(allCards: OwnedCard[], hand: HandCall): OwnedCard[] {
    const jokerCards = allCards.filter(c => c.isJoker);
    const normal = allCards.filter(c => !c.isJoker);

    let relevantNormal: OwnedCard[];
    switch (hand.type) {
      case HandType.HIGH_CARD:
        relevantNormal = normal.filter(c => c.rank === hand.rank);
        break;

      case HandType.PAIR:
        relevantNormal = normal.filter(c => c.rank === hand.rank);
        break;

      case HandType.TWO_PAIR:
        relevantNormal = normal.filter(c => c.rank === hand.highRank || c.rank === hand.lowRank);
        break;

      case HandType.THREE_OF_A_KIND:
        relevantNormal = normal.filter(c => c.rank === hand.rank);
        break;

      case HandType.FLUSH:
        relevantNormal = normal.filter(c => c.suit === hand.suit);
        break;

      case HandType.STRAIGHT: {
        const ranks = getStraightRanks(hand.highRank);
        if (!ranks) return jokerCards;
        const rankSet = new Set<Rank>(ranks);
        relevantNormal = normal.filter(c => rankSet.has(c.rank));
        break;
      }

      case HandType.FULL_HOUSE:
        relevantNormal = normal.filter(c => c.rank === hand.threeRank || c.rank === hand.twoRank);
        break;

      case HandType.FOUR_OF_A_KIND:
        relevantNormal = normal.filter(c => c.rank === hand.rank);
        break;

      case HandType.STRAIGHT_FLUSH: {
        const ranks = getStraightRanks(hand.highRank);
        if (!ranks) return jokerCards;
        const rankSet = new Set<Rank>(ranks);
        relevantNormal = normal.filter(c => c.suit === hand.suit && rankSet.has(c.rank));
        break;
      }

      case HandType.ROYAL_FLUSH: {
        const ranks = getStraightRanks('A' as Rank);
        if (!ranks) return jokerCards;
        const rankSet = new Set<Rank>(ranks);
        relevantNormal = normal.filter(c => c.suit === hand.suit && rankSet.has(c.rank));
        break;
      }
    }

    // Include jokers only when the hand requires them to exist — i.e. the
    // normal cards alone don't satisfy the requirement. Previously this checked
    // `this.exists(allCards, hand)` which is always true at resolution time and
    // incorrectly highlighted jokers even when they weren't needed.
    if (jokerCards.length > 0 && !this.exists(normal, hand)) {
      return [...relevantNormal, ...jokerCards];
    }
    return relevantNormal;
  }
}

function countByRank(cards: Card[], rank: Rank): number {
  return cards.filter(c => c.rank === rank).length;
}

function countBySuit(cards: Card[], suit: Suit): number {
  return cards.filter(c => c.suit === suit).length;
}

function getStraightRanks(highRank: Rank): Rank[] | null {
  const highVal = RANK_VALUES[highRank];
  if (highVal < 6) {
    // Ace-low straight: A-2-3-4-5 (highRank = '5')
    if (highVal === 5) {
      return ['A', '2', '3', '4', '5'] as Rank[];
    }
    return null;
  }
  const ranks: Rank[] = [];
  for (let v = highVal - 4; v <= highVal; v++) {
    const rank = VALUE_TO_RANK.get(v);
    if (!rank) return null;
    ranks.push(rank);
  }
  return ranks;
}

function hasStraight(cards: Card[], highRank: Rank, jokers: number): boolean {
  const ranks = getStraightRanks(highRank);
  if (!ranks) return false;
  let missing = 0;
  for (const r of ranks) {
    if (!cards.some(c => c.rank === r)) missing++;
  }
  return missing <= jokers;
}

function hasStraightFlush(cards: Card[], suit: Suit, highRank: Rank, jokers: number): boolean {
  const ranks = getStraightRanks(highRank);
  if (!ranks) return false;
  let missing = 0;
  for (const r of ranks) {
    if (!cards.some(c => c.rank === r && c.suit === suit)) missing++;
  }
  return missing <= jokers;
}

/** Pick `needed` cards matching `predicate` from normal cards, filling gaps with jokers. */
function pickWithJokers(normal: Card[], jokerCards: Card[], predicate: (c: Card) => boolean, needed: number): Card[] | null {
  const matching = normal.filter(predicate);
  const taken = matching.slice(0, needed);
  const gap = needed - taken.length;
  if (gap > jokerCards.length) return null;
  return [...taken, ...jokerCards.slice(0, gap)];
}

function findStraightCards(normal: Card[], jokerCards: Card[], highRank: Rank): Card[] | null {
  const ranks = getStraightRanks(highRank);
  if (!ranks) return null;
  const result: Card[] = [];
  let jokersUsed = 0;
  for (const r of ranks) {
    const card = normal.find(c => c.rank === r);
    if (card) {
      result.push(card);
    } else if (jokersUsed < jokerCards.length) {
      result.push(jokerCards[jokersUsed]!);
      jokersUsed++;
    } else {
      return null;
    }
  }
  return result;
}

function findStraightFlushCards(normal: Card[], jokerCards: Card[], suit: Suit, highRank: Rank): Card[] | null {
  const ranks = getStraightRanks(highRank);
  if (!ranks) return null;
  const result: Card[] = [];
  let jokersUsed = 0;
  for (const r of ranks) {
    const card = normal.find(c => c.rank === r && c.suit === suit);
    if (card) {
      result.push(card);
    } else if (jokersUsed < jokerCards.length) {
      result.push(jokerCards[jokersUsed]!);
      jokersUsed++;
    } else {
      return null;
    }
  }
  return result;
}
