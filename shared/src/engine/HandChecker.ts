import { RANK_VALUES } from '../constants.js';
import type { Card, HandCall, Rank, Suit } from '../types.js';
import { HandType } from '../types.js';

export class HandChecker {
  static exists(allCards: Card[], hand: HandCall): boolean {
    switch (hand.type) {
      case HandType.HIGH_CARD:
        return allCards.some(c => c.rank === hand.rank);

      case HandType.PAIR:
        return countByRank(allCards, hand.rank) >= 2;

      case HandType.TWO_PAIR:
        return countByRank(allCards, hand.highRank) >= 2
          && countByRank(allCards, hand.lowRank) >= 2
          && hand.highRank !== hand.lowRank;

      case HandType.THREE_OF_A_KIND:
        return countByRank(allCards, hand.rank) >= 3;

      case HandType.FLUSH:
        return countBySuit(allCards, hand.suit) >= 5;

      case HandType.STRAIGHT:
        return hasStraight(allCards, hand.highRank);

      case HandType.FULL_HOUSE:
        return hand.threeRank !== hand.twoRank
          && countByRank(allCards, hand.threeRank) >= 3
          && countByRank(allCards, hand.twoRank) >= 2;

      case HandType.FOUR_OF_A_KIND:
        return countByRank(allCards, hand.rank) >= 4;

      case HandType.STRAIGHT_FLUSH:
        return hasStraightFlush(allCards, hand.suit, hand.highRank);

      case HandType.ROYAL_FLUSH:
        return hasStraightFlush(allCards, hand.suit, 'A' as Rank);
    }
  }

  static findMatchingCards(allCards: Card[], hand: HandCall): Card[] | null {
    if (!this.exists(allCards, hand)) return null;

    switch (hand.type) {
      case HandType.HIGH_CARD:
        return [allCards.find(c => c.rank === hand.rank)!];

      case HandType.PAIR:
        return allCards.filter(c => c.rank === hand.rank).slice(0, 2);

      case HandType.TWO_PAIR:
        return [
          ...allCards.filter(c => c.rank === hand.highRank).slice(0, 2),
          ...allCards.filter(c => c.rank === hand.lowRank).slice(0, 2),
        ];

      case HandType.THREE_OF_A_KIND:
        return allCards.filter(c => c.rank === hand.rank).slice(0, 3);

      case HandType.FLUSH:
        return allCards.filter(c => c.suit === hand.suit).slice(0, 5);

      case HandType.STRAIGHT:
        return findStraightCards(allCards, hand.highRank);

      case HandType.FULL_HOUSE:
        return [
          ...allCards.filter(c => c.rank === hand.threeRank).slice(0, 3),
          ...allCards.filter(c => c.rank === hand.twoRank).slice(0, 2),
        ];

      case HandType.FOUR_OF_A_KIND:
        return allCards.filter(c => c.rank === hand.rank).slice(0, 4);

      case HandType.STRAIGHT_FLUSH:
        return findStraightFlushCards(allCards, hand.suit, hand.highRank);

      case HandType.ROYAL_FLUSH:
        return findStraightFlushCards(allCards, hand.suit, 'A' as Rank);
    }
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
    const rank = Object.entries(RANK_VALUES).find(([, val]) => val === v)?.[0] as Rank;
    if (!rank) return null;
    ranks.push(rank);
  }
  return ranks;
}

function hasStraight(cards: Card[], highRank: Rank): boolean {
  const ranks = getStraightRanks(highRank);
  if (!ranks) return false;
  return ranks.every(r => cards.some(c => c.rank === r));
}

function hasStraightFlush(cards: Card[], suit: Suit, highRank: Rank): boolean {
  const ranks = getStraightRanks(highRank);
  if (!ranks) return false;
  return ranks.every(r => cards.some(c => c.rank === r && c.suit === suit));
}

function findStraightCards(cards: Card[], highRank: Rank): Card[] | null {
  const ranks = getStraightRanks(highRank);
  if (!ranks) return null;
  const result: Card[] = [];
  for (const r of ranks) {
    const card = cards.find(c => c.rank === r);
    if (!card) return null;
    result.push(card);
  }
  return result;
}

function findStraightFlushCards(cards: Card[], suit: Suit, highRank: Rank): Card[] | null {
  const ranks = getStraightRanks(highRank);
  if (!ranks) return null;
  const result: Card[] = [];
  for (const r of ranks) {
    const card = cards.find(c => c.rank === r && c.suit === suit);
    if (!card) return null;
    result.push(card);
  }
  return result;
}
